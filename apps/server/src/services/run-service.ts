import type { Agent, Project, Run, Spec } from "@loom/core";
import { getAdapter } from "../adapters/registry.js";
import { getAgent } from "../db/agents.js";
import { getProject } from "../db/projects.js";
import {
  createRun,
  getRun,
  markRunFinished,
  markRunRunning,
  setRunLogPath,
} from "../db/runs.js";
import { getSpecsByIds } from "../db/specs.js";
import { appendChunk, finishLog, startLog } from "./log-store.js";
import {
  buildManifestEntries,
  syncAgentSkills,
} from "./skill-sync.js";

/**
 * Compose the final prompt that reaches the CLI.
 *
 *   [agentPrompt — system / role instructions]
 *   [Skill manifest — file paths + summaries, NOT the bodies]
 *   [userPrompt — the task]
 *
 * The skill *bodies* live on disk under the agent's private skills folder,
 * mirrored from the DB. This keeps the prompt small (manifest is dozens of
 * bytes per skill, not kilobytes) and lets the LLM read each skill on demand
 * with its standard file-read tool.
 */
export function composePrompt(args: {
  userPrompt: string;
  skills: Spec[];
  agentPrompt?: string;
  /** When provided, manifest lists actual on-disk paths the LLM can Read. */
  project?: Project | null;
  agent?: Agent | null;
}): string {
  const sections: string[] = [];
  const trimmedAgent = (args.agentPrompt ?? "").trim();
  if (trimmedAgent) {
    sections.push(
      `=== Agent Instructions ===\n${trimmedAgent}\n=== End Instructions ===`,
    );
  }

  if (args.skills.length > 0 && args.project && args.agent) {
    const entries = buildManifestEntries(args.project, args.agent, args.skills);
    const lines: string[] = [];
    lines.push("=== Available Skills (read on demand) ===");
    lines.push(
      "These reference docs are mirrored from the loom database to disk.",
    );
    lines.push("Open them with your file-read tool only when relevant.");
    lines.push("");
    for (const e of entries) {
      lines.push(`  ${e.fullPath}  (${formatBytes(e.size)})`);
      if (e.summary) lines.push(`    ${e.summary}`);
    }
    lines.push("=== End Skills ===");
    sections.push(lines.join("\n"));
  }

  sections.push(args.userPrompt);
  return sections.join("\n\n");
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  return `${(n / 1024).toFixed(1)}KB`;
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
  attachedSpecIds?: string[];
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

  // Per-run attached skills must (a) exist and (b) already be assigned to
  // the agent. Skills only reach the CLI through the agent's mirrored disk
  // folder, so a spec that isn't part of agent.skillIds has no on-disk file
  // and would produce a manifest pointing at nothing. We surface that as a
  // clear error rather than silently dropping it.
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
  const assignedIds = new Set(agent.skillIds);
  const notAssigned = perRunSkillIds.filter((id) => !assignedIds.has(id));
  if (notAssigned.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `spec_not_assigned_to_agent: ${notAssigned.join(",")}`,
    };
  }

  // Use the order of input.attachedSpecIds when supplied, otherwise the
  // agent's full assigned set in its stored order.
  const orderedIds =
    perRunSkillIds.length > 0 ? perRunSkillIds : agent.skillIds;
  const allSkills = getSpecsByIds(orderedIds);

  // cwd resolution: explicit input > agent's override > project's path > server cwd.
  const project = getProject(agent.projectId);
  const cwd =
    input.cwd ?? agent.defaultCwd ?? project?.path ?? process.cwd();

  // Defensive: ensure the on-disk skill folder reflects current assignments
  // before the CLI starts reading it. CRUD hooks already do this on every
  // edit, but this guards against folders deleted out-of-band.
  syncAgentSkills(agent.id);

  const composedPrompt = composePrompt({
    userPrompt: input.prompt,
    skills: allSkills,
    agentPrompt: agent.prompt,
    project,
    agent,
  });

  const pendingRun = createRun({
    agentId: agent.id,
    parentRunId: input.parentRunId ?? null,
    prompt: input.prompt,
    // Snapshot every skill that participated in this run for later auditing.
    attachedSpecIds: allSkills.map((s) => s.id),
    cwd,
  });

  const logPath = startLog(pendingRun.id);
  setRunLogPath(pendingRun.id, logPath);

  const abort = new AbortController();
  activeRuns.set(pendingRun.id, { abort });

  void executeRun(pendingRun.id, agent, adapter, composedPrompt, cwd, abort);

  return { ok: true, run: getRun(pendingRun.id)! };
}

async function executeRun(
  runId: string,
  agent: ReturnType<typeof getAgent>,
  adapter: NonNullable<ReturnType<typeof getAdapter>>,
  composedPrompt: string,
  cwd: string,
  abort: AbortController,
): Promise<void> {
  if (!agent) return;

  let pid: number | null = null;
  try {
    const handle = await adapter.spawn(
      {
        prompt: composedPrompt,
        cwd,
        env: {},
        signal: abort.signal,
        onStdout: (chunk) => appendChunk(runId, "stdout", chunk),
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
