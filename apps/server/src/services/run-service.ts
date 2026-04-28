import type { Run, Spec } from "@loom/core";
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

/**
 * Compose the final prompt that reaches the CLI.
 *
 *   [agentPrompt — system / role instructions]
 *   [Skill blocks — agent's assigned skills + per-run attached]
 *   [userPrompt — the task]
 *
 * Any of the three sections is optional; only non-empty sections are included.
 *
 * Skill bodies are inlined here as a deliberate baseline. Smarter delivery
 * (per-agent disk folder, lazy file-read, etc.) is a v0.x design discussion
 * we haven't decided on yet — keeping it dumb until we agree.
 */
export function composePrompt(
  userPrompt: string,
  skills: Spec[],
  agentPrompt: string = "",
): string {
  const sections: string[] = [];
  const trimmedAgent = agentPrompt.trim();
  if (trimmedAgent) {
    sections.push(`=== Agent Instructions ===\n${trimmedAgent}\n=== End Instructions ===`);
  }
  for (const s of skills) {
    sections.push(`=== Skill: ${s.name} ===\n${s.content}\n=== End Skill ===`);
  }
  sections.push(userPrompt);
  return sections.join("\n\n");
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

  // cwd resolution: explicit input > agent's override > project's path > server cwd.
  const project = getProject(agent.projectId);
  const cwd =
    input.cwd ?? agent.defaultCwd ?? project?.path ?? process.cwd();
  const composedPrompt = composePrompt(input.prompt, allSkills, agent.prompt);

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
