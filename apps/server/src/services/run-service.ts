import type { Run, Spec } from "@loom/core";
import { getAdapter } from "../adapters/registry.js";
import { getAgent } from "../db/agents.js";
import { threadNameFromPrompt } from "../db/client.js";
import { getProject } from "../db/projects.js";
import {
  createRun,
  getLatestSessionId,
  getRun,
  markRunFinished,
  markRunRunning,
  setRunAfterRef,
  setRunBeforeRef,
  setRunCostUsd,
  setRunLogPath,
  setRunSessionId,
} from "../db/runs.js";
import { replaceRunChanges } from "../db/run-changes.js";
import { getSpecsByIds } from "../db/specs.js";
import {
  createThread,
  getThread,
  touchThread,
} from "../db/threads.js";
import {
  recordEdits,
  recordPaths,
  startTracking,
  stopTracking,
} from "./active-touches.js";
import { diffStat, snapshotWorkTree } from "./git-snapshot.js";
import { appendChunk, finishLog, startLog } from "./log-store.js";

/**
 * Compose the final prompt that reaches the CLI.
 *
 *   [agentPrompt    — system / role instructions, per-agent baseline]
 *   [threadContext  — optional thread bundle, only when user opted in]
 *   [Skill blocks   — agent's assigned skills + per-run attached]
 *   [userPrompt     — the task as typed]
 *
 * Any of the four sections is optional; only non-empty ones are
 * included. Section ordering matters for downstream readability:
 * agent identity → conversation context → reusable skills → the
 * actual task.
 *
 * `threadContext` is opt-in per send (the composer's "attach context"
 * toggle). We never auto-inject — the user's choice to include the
 * bundle is the signal, not its mere existence.
 *
 * Skill bodies are inlined here as a deliberate baseline. Smarter delivery
 * (per-agent disk folder, lazy file-read, etc.) is a v0.x design discussion
 * we haven't decided on yet — keeping it dumb until we agree.
 */
export function composePrompt(
  userPrompt: string,
  skills: Spec[],
  agentPrompt: string = "",
  threadContext: string = "",
): string {
  const sections: string[] = [];
  const trimmedAgent = agentPrompt.trim();
  if (trimmedAgent) {
    sections.push(`=== Agent Instructions ===\n${trimmedAgent}\n=== End Instructions ===`);
  }
  const trimmedContext = threadContext.trim();
  if (trimmedContext) {
    sections.push(`=== Thread Context ===\n${trimmedContext}\n=== End Context ===`);
  }
  for (const s of skills) {
    sections.push(`=== Skill: ${s.name} ===\n${s.content}\n=== End Skill ===`);
  }
  sections.push(userPrompt);
  return sections.join("\n\n");
}

/**
 * Pick the thread a new run will land in. Three paths:
 *
 *   - explicit threadId from the caller (broadcast / re-using a thread)
 *   - inherit from the parent run (Reply / Hand-off)
 *   - create a brand-new thread, named from the prompt
 *
 * In all branches we enforce the thread belongs to the same project as
 * the agent — cross-project posts would be a bug, not a feature.
 */
type ThreadResolution =
  | { kind: "ok"; id: string }
  | { kind: "error"; status: 400 | 404; error: string };

function resolveThreadForRun(args: {
  explicitThreadId: string | null;
  parentRunId: string | null;
  prompt: string;
  projectId: string;
}): ThreadResolution {
  if (args.explicitThreadId) {
    const t = getThread(args.explicitThreadId);
    if (!t) return { kind: "error", status: 404, error: "thread_not_found" };
    if (t.projectId !== args.projectId) {
      return { kind: "error", status: 400, error: "thread_project_mismatch" };
    }
    return { kind: "ok", id: t.id };
  }
  if (args.parentRunId) {
    const parent = getRun(args.parentRunId);
    if (!parent) {
      return { kind: "error", status: 404, error: "parent_run_not_found" };
    }
    if (parent.threadId) {
      // Inherit. (We don't re-validate the project — the parent run's
      // agent is in the same project as the new run's agent only when
      // the caller wired things correctly. Sub-agent delegation across
      // projects isn't a flow we support.)
      return { kind: "ok", id: parent.threadId };
    }
    // Parent has no thread (legacy data). Fall through to create one.
  }
  const fresh = createThread({
    projectId: args.projectId,
    name: threadNameFromPrompt(args.prompt),
  });
  return { kind: "ok", id: fresh.id };
}

interface ActiveRun {
  abort: AbortController;
}

const activeRuns = new Map<string, ActiveRun>();

export interface StartRunInput {
  agentId: string;
  prompt: string;
  cwd?: string;
  parentRunId?: string | null;
  /**
   * Explicit thread to attach to. If unset, we resolve in this priority:
   *   1. inherit the parent run's thread (when parentRunId is set)
   *   2. create a fresh thread named from this prompt
   * Passing it explicitly is the "broadcast: every run shares a thread"
   * path — the composer creates/picks the thread, then fires N runs
   * with the same threadId so they all land in the same conversation.
   */
  threadId?: string | null;
  attachedSpecIds?: string[];
  /**
   * Opt-in: prepend the thread's contextBundle to the composed prompt
   * for *this run*. We never auto-inject; the user's explicit toggle
   * is the only path. Empty bundle or false flag → omitted entirely.
   */
  includeContext?: boolean;
}

export type StartRunResult =
  | { ok: true; run: Run }
  | { ok: false; status: 400 | 404; error: string };

export async function startRun(input: StartRunInput): Promise<StartRunResult> {
  const agent = getAgent(input.agentId);
  if (!agent) return { ok: false, status: 404, error: "agent_not_found" };

  const adapter = getAdapter(agent.adapterKind);
  if (!adapter) {
    return {
      ok: false,
      status: 400,
      error: `adapter_not_registered: ${agent.adapterKind}`,
    };
  }

  // Per-run attached skills must exist; agent-assigned skills are loaded
  // separately and merged in after de-duplication.
  const perRunSkillIds = input.attachedSpecIds ?? [];
  const perRunSkills = getSpecsByIds(perRunSkillIds);
  if (perRunSkills.length !== perRunSkillIds.length) {
    const found = new Set(perRunSkills.map((s) => s.id));
    const missing = perRunSkillIds.filter((id) => !found.has(id));
    return {
      ok: false,
      status: 404,
      error: `spec_not_found: ${missing.join(",")}`,
    };
  }

  const agentSkills = getSpecsByIds(agent.skillIds);
  const skillsById = new Map<string, Spec>();
  for (const s of agentSkills) skillsById.set(s.id, s);
  for (const s of perRunSkills) skillsById.set(s.id, s);
  const allSkills = [...skillsById.values()];

  const project = getProject(agent.projectId);

  // Thread resolution: explicit > inherit-from-parent > create-fresh.
  // Validate that anything we end up with is in the same project as the
  // agent — agents can't post into another project's threads.
  const threadId = resolveThreadForRun({
    explicitThreadId: input.threadId ?? null,
    parentRunId: input.parentRunId ?? null,
    prompt: input.prompt,
    projectId: agent.projectId,
  });
  if (threadId.kind === "error") {
    return { ok: false, status: threadId.status, error: threadId.error };
  }

  // cwd resolution. Priority:
  //   1. explicit input.cwd
  //   2. thread's isolated worktree (per-thread parallel-safe)
  //   3. agent.defaultCwd override
  //   4. project's main path
  //   5. server cwd
  // The thread worktree slot sits *above* agent.defaultCwd because
  // isolation is a thread-level intent — the user opted in for this
  // conversation, and the agent's per-agent override shouldn't break
  // out of that sandbox.
  const thread = getThread(threadId.id);
  const cwd =
    input.cwd ??
    thread?.worktreePath ??
    agent.defaultCwd ??
    project?.path ??
    process.cwd();

  // Compose the prompt only after we've resolved the thread, so we
  // can splice in the thread's context bundle when the user opted
  // into "attach context" for this send.
  const threadContext =
    input.includeContext && thread?.contextBundle
      ? thread.contextBundle
      : "";
  const composedPrompt = composePrompt(
    input.prompt,
    allSkills,
    agent.prompt,
    threadContext,
  );

  // Pull the most recent CLI session id captured in this thread for
  // this agent. The lookup skips poisoned ids — sessions that some
  // earlier failed run already tried to resume — so we never hand the
  // CLI a session it has just rejected.
  const resumeSessionId = threadId.id
    ? getLatestSessionId({ threadId: threadId.id, agentId: agent.id }) ??
      undefined
    : undefined;

  const pendingRun = createRun({
    agentId: agent.id,
    threadId: threadId.id,
    parentRunId: input.parentRunId ?? null,
    prompt: input.prompt,
    // Snapshot every skill that participated in this run for later auditing.
    attachedSpecIds: allSkills.map((s) => s.id),
    cwd,
    // Persist what we're attempting to resume so getLatestSessionId
    // can poison this id on a future call if this run ends up failing.
    resumedSessionId: resumeSessionId ?? null,
  });
  // Bump the thread's updated_at — the sidebar orders by recent
  // activity, not creation time, so the active conversation stays
  // pinned to the top.
  if (threadId.id) touchThread(threadId.id);

  const logPath = startLog(pendingRun.id);
  setRunLogPath(pendingRun.id, logPath);

  const abort = new AbortController();
  activeRuns.set(pendingRun.id, { abort });

  void executeRun(
    pendingRun.id,
    agent,
    adapter,
    composedPrompt,
    cwd,
    resumeSessionId,
    abort,
  );

  return { ok: true, run: getRun(pendingRun.id)! };
}

async function executeRun(
  runId: string,
  agent: ReturnType<typeof getAgent>,
  adapter: NonNullable<ReturnType<typeof getAdapter>>,
  composedPrompt: string,
  cwd: string,
  resumeSessionId: string | undefined,
  abort: AbortController,
): Promise<void> {
  if (!agent) return;

  let pid: number | null = null;
  try {
    // Snapshot the work tree before the agent runs so we can later show
    // exactly which files this run touched. Best-effort — non-git cwds
    // and snapshot failures simply leave before_ref NULL and the UI
    // hides the diff badge for this run.
    const beforeRef = await snapshotWorkTree(cwd).catch(() => null);
    if (beforeRef) setRunBeforeRef(runId, beforeRef);

    // Tap stdout as it streams — the CLI emits a JSON `result` event
    // near the end carrying `total_cost_usd`. We persist that whenever
    // we see it so per-run cost is available in the chat without
    // re-reading the log file post-finish. Adapters that don't speak
    // stream-json simply never produce a match and `cost_usd` stays
    // NULL — that's the signal for "cost unknown" downstream.
    let stdoutBuf = "";
    const tapCost = (chunk: string) => {
      stdoutBuf += chunk;
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line || !line.includes("\"total_cost_usd\"")) continue;
        try {
          const j = JSON.parse(line) as {
            type?: string;
            total_cost_usd?: number;
          };
          if (j.type === "result" && typeof j.total_cost_usd === "number") {
            setRunCostUsd(runId, j.total_cost_usd);
          }
        } catch {
          // skip malformed JSON
        }
      }
    };

    // Capture the CLI session id once, the first time the adapter
    // surfaces one. The same id appears in multiple events (init,
    // assistant, result), so latching on first sight keeps the DB
    // write count down without needing a debounce.
    let sessionLatched = false;
    const tapSessionId = (chunk: string) => {
      if (sessionLatched || !adapter.extractSessionId) return;
      const sid = adapter.extractSessionId(chunk);
      if (sid) {
        setRunSessionId(runId, sid);
        sessionLatched = true;
      }
    };

    // Live "agent is editing this file" tracking. We feed every stdout
    // chunk through the adapter's tool-use parser; the in-memory store
    // surfaces the result via /api/projects/:id/active-touches so the
    // file tree pulses on the relevant rows in real time.
    if (agent.projectId) {
      startTracking({
        runId,
        agentId: agent.id,
        projectId: agent.projectId,
        cwd,
      });
    }
    const tapTouches = (chunk: string) => {
      // Prefer the richer "edits" parser when the adapter has one —
      // it gives us a target string we can grep for, so the file-tree
      // badge can drill down to "@agent in main.py:42" instead of
      // just "@agent in main.py".
      if (adapter.extractTouchedEdits) {
        const edits = adapter.extractTouchedEdits(chunk);
        if (edits.length > 0) recordEdits(runId, edits);
        return;
      }
      if (adapter.extractTouchedPaths) {
        const paths = adapter.extractTouchedPaths(chunk);
        if (paths.length > 0) recordPaths(runId, paths);
      }
    };

    const handle = await adapter.spawn(
      {
        prompt: composedPrompt,
        cwd,
        env: {},
        signal: abort.signal,
        resumeSessionId,
        onStdout: (chunk) => {
          appendChunk(runId, "stdout", chunk);
          tapCost(chunk);
          tapSessionId(chunk);
          tapTouches(chunk);
        },
        onStderr: (chunk) => appendChunk(runId, "stderr", chunk),
      },
      agent.adapterConfig,
    );

    pid = handle.pid;
    markRunRunning(runId, pid);

    const result = await handle.promise;

    if (abort.signal.aborted) {
      markRunFinished(runId, "cancelled", result.exitCode);
      finishLog(runId, {
        ts: new Date().toISOString(),
        status: "cancelled",
        exitCode: result.exitCode,
      });
    } else if (result.exitCode === 0) {
      markRunFinished(runId, "succeeded", 0);
      finishLog(runId, {
        ts: new Date().toISOString(),
        status: "succeeded",
        exitCode: 0,
      });
    } else {
      markRunFinished(runId, "failed", result.exitCode);
      finishLog(runId, {
        ts: new Date().toISOString(),
        status: "failed",
        exitCode: result.exitCode,
      });
    }
  } catch (err) {
    appendChunk(runId, "stderr", `[loom] adapter error: ${(err as Error).message}\n`);
    markRunFinished(runId, "failed", null);
    finishLog(runId, {
      ts: new Date().toISOString(),
      status: "failed",
      exitCode: null,
    });
  } finally {
    // After-snapshot covers all exit paths — success, failure, cancel,
    // adapter throw — so the diff is always against the same baseline
    // even if the agent left the work tree in a partial state.
    const afterRef = await snapshotWorkTree(cwd).catch(() => null);
    if (afterRef) setRunAfterRef(runId, afterRef);

    // Persist per-file changes to run_changes. We compute against
    // before/after refs once, here, and store — so file-history queries
    // can answer "which runs touched src/auth.ts?" with a SQL join,
    // not by walking dangling git commits that may eventually be gc'd.
    try {
      const run = getRun(runId);
      const changes = await diffStat(
        run?.beforeRef ?? null,
        afterRef,
        cwd,
      );
      if (changes.length > 0) replaceRunChanges(runId, changes);
    } catch {
      // Best-effort. Failing to persist changes shouldn't fail the run.
    }
    // run_changes now owns the post-mortem record of what was touched,
    // so we drop the live in-memory map entry here.
    stopTracking(runId);
    activeRuns.delete(runId);
  }
}

export type CancelResult =
  | { ok: true }
  | { ok: false; status: 404 | 409; error: string };

export function cancelRun(runId: string): CancelResult {
  const active = activeRuns.get(runId);
  if (!active) {
    const run = getRun(runId);
    if (!run) return { ok: false, status: 404, error: "not_found" };
    return { ok: false, status: 409, error: `not_active: ${run.status}` };
  }
  active.abort.abort();
  return { ok: true };
}

export function isRunActive(runId: string): boolean {
  return activeRuns.has(runId);
}

/** For tests. */
export function _activeRunIds(): string[] {
  return [...activeRuns.keys()];
}
