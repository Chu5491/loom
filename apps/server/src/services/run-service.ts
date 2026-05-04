// Run 라이프사이클 오케스트레이터. 책임 단위 모듈은 ./run/ 디렉토리에:
//   - prompt-composer: 최종 프롬프트 조립
//   - thread-resolver: 스레드 결정 (explicit > inherit > new)
//   - run-tappers:    stdout 스트림에서 비용/세션id/touches 추출
//   - active-runs:    인메모리 활성 run 맵 + cancel
//
// 이 파일은 startRun/executeRun 흐름만 — 각 단계는 위 모듈에 위임.

import type { Run, Spec } from "@loom/core";
import { getAdapter } from "../adapters/registry.js";
import { getAgent } from "../db/agents.js";
import { getProject } from "../db/projects.js";
import { listProjectEnv } from "../db/project-env.js";
import {
  createRun,
  getLatestSessionId,
  getRun,
  markRunFinished,
  markRunRunning,
  setRunAfterRef,
  setRunBeforeRef,
  setRunLogPath,
} from "../db/runs.js";
import { replaceRunChanges } from "../db/run-changes.js";
import { getMcpServersByIds } from "../db/mcp-servers.js";
import { getSpecsByIds } from "../db/specs.js";
import { getThread, touchThread } from "../db/threads.js";
import { runLogger } from "../logger.js";
import { startTracking, stopTracking } from "./active-touches.js";
import {
  startToolTracking,
  stopToolTracking,
} from "./active-tools.js";
import { diffStat, snapshotWorkTree } from "./git-snapshot.js";
import { appendChunk, finishLog, startLog } from "./log-store.js";
import { trackActiveRun, untrackActiveRun } from "./run/active-runs.js";
import {
  materializeAgentLoadout,
  type AgentLoadout,
} from "./run/agent-loadout.js";
import { composePrompt } from "./run/prompt-composer.js";
import {
  makeCostTapper,
  makeSessionIdTapper,
  makeToolsTapper,
  makeTouchesTapper,
} from "./run/run-tappers.js";
import { resolveThreadForRun } from "./run/thread-resolver.js";

// 백워드 호환 재내보내기 — 기존 import 경로를 깨지 않도록.
export { composePrompt } from "./run/prompt-composer.js";
export {
  cancelRun,
  isRunActive,
  _activeRunIds,
  type CancelResult,
} from "./run/active-runs.js";

export interface StartRunInput {
  agentId: string;
  prompt: string;
  cwd?: string;
  parentRunId?: string | null;
  /**
   * 명시 attach할 thread. 미지정 시 우선순위:
   *   1. 부모 run의 thread 상속 (parentRunId 있을 때)
   *   2. 새 thread 생성 (이 프롬프트로 이름)
   * 명시 전달은 "broadcast — 같은 thread에 N개 run" 경로용.
   */
  threadId?: string | null;
  attachedSpecIds?: string[];
  /** opt-in: thread.contextBundle을 *이 run의* 프롬프트 앞에 붙임. 자동 주입 절대 안 함. */
  includeContext?: boolean;
  /** true면 이번 run에 `--resume <session_id>`를 안 붙임. CLI가 fresh
   *  session id를 새로 발행하고, 다음 run부터는 그걸 이어가게 됨. */
  freshSession?: boolean;
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

  // run별 첨부 스킬은 반드시 존재해야 함. 에이전트 기본 스킬은 별도 로드 후 dedup 머지.
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

  // 스레드 결정 (explicit > inherit-from-parent > create-fresh).
  const threadId = resolveThreadForRun({
    explicitThreadId: input.threadId ?? null,
    parentRunId: input.parentRunId ?? null,
    prompt: input.prompt,
    projectId: agent.projectId,
  });
  if (threadId.kind === "error") {
    return { ok: false, status: threadId.status, error: threadId.error };
  }

  // cwd 우선순위:
  //   1. 명시 input.cwd
  //   2. thread의 격리 worktree (스레드별 병렬 안전)
  //   3. agent.defaultCwd 오버라이드
  //   4. project 메인 path
  //   5. 서버 cwd
  // 스레드 worktree가 agent.defaultCwd 위에 — 격리는 스레드 레벨 의도이므로
  // 에이전트 오버라이드가 sandbox를 벗어나면 안 됨.
  const thread = getThread(threadId.id);
  const cwd =
    input.cwd ??
    thread?.worktreePath ??
    agent.defaultCwd ??
    project?.path ??
    process.cwd();

  // 프롬프트는 스레드 결정 후 조립 — 컨텍스트 번들이 필요할 수 있어서.
  const threadContext =
    input.includeContext && thread?.contextBundle
      ? thread.contextBundle
      : "";

  // Loadout — 스킬 파일 + (해당하면) MCP 설정을 ~/.loom/data/agents/<id>/에
  // 펼쳐 두고, 그 경로를 프롬프트에 짧게 안내. 에이전트가 필요할 때 Read.
  const mcpServers = getMcpServersByIds(agent.mcpServerIds ?? []);
  const loadout: AgentLoadout = materializeAgentLoadout(
    agent,
    allSkills,
    mcpServers,
  );

  const composedPrompt = composePrompt({
    userPrompt: input.prompt,
    agentPrompt: agent.prompt,
    threadContext,
    loadout,
  });

  // 이 thread+agent에서 가장 최근 CLI session id (poison된 건 자동 스킵).
  // freshSession=true면 명시적으로 새로 시작 — 이전 컨텍스트가 엉킨 경우의 탈출구.
  const resumeSessionId =
    !input.freshSession && threadId.id
      ? getLatestSessionId({ threadId: threadId.id, agentId: agent.id }) ??
        undefined
      : undefined;

  const pendingRun = createRun({
    agentId: agent.id,
    threadId: threadId.id,
    parentRunId: input.parentRunId ?? null,
    prompt: input.prompt,
    attachedSpecIds: allSkills.map((s) => s.id),
    cwd,
    resumedSessionId: resumeSessionId ?? null,
  });

  // 사이드바 정렬은 updated_at 기준 — 활성 대화가 위로 올라옴.
  if (threadId.id) touchThread(threadId.id);

  const logPath = startLog(pendingRun.id);
  setRunLogPath(pendingRun.id, logPath);

  const abort = new AbortController();
  trackActiveRun(pendingRun.id, abort);

  void executeRun(
    pendingRun.id,
    agent,
    adapter,
    composedPrompt,
    cwd,
    resumeSessionId,
    loadout,
    mcpServers,
    abort,
  );

  return { ok: true, run: getRun(pendingRun.id)! };
}

async function executeRun(
  runId: string,
  agent: NonNullable<ReturnType<typeof getAgent>>,
  adapter: NonNullable<ReturnType<typeof getAdapter>>,
  composedPrompt: string,
  cwd: string,
  resumeSessionId: string | undefined,
  loadout: AgentLoadout,
  mcpServers: ReturnType<typeof getMcpServersByIds>,
  abort: AbortController,
): Promise<void> {
  const log = runLogger(runId, {
    agentId: agent.id,
    adapter: agent.adapterKind,
  });
  log.info({ cwd, resumeSessionId }, "run starting");
  try {
    const beforeRef = await snapshotWorkTree(cwd).catch(() => null);
    if (beforeRef) setRunBeforeRef(runId, beforeRef);

    const tapCost = makeCostTapper(runId);
    const tapSessionId = makeSessionIdTapper(runId, adapter);
    const tapTouches = makeTouchesTapper(runId, adapter);
    const tapTools = makeToolsTapper(runId, adapter);

    if (agent.projectId) {
      startTracking({
        runId,
        agentId: agent.id,
        projectId: agent.projectId,
        cwd,
      });
      startToolTracking({
        runId,
        agentId: agent.id,
        projectId: agent.projectId,
      });
    }

    // 프로젝트 단위 env — 모든 에이전트가 공통으로 받는 KV. 에이전트의
    // adapterConfig.env가 더 높은 우선순위 (define.ts spawn 합성 참고).
    const projectEnv = agent.projectId ? listProjectEnv(agent.projectId) : {};

    const handle = await adapter.spawn(
      {
        prompt: composedPrompt,
        cwd,
        env: projectEnv,
        signal: abort.signal,
        resumeSessionId,
        // MCP 주입 — 어댑터가 자기 CLI에 맞게 처리:
        //   claude-code → --mcp-config <path> --strict-mcp-config
        //   gemini      → --allowed-mcp-server-names ...
        //   codex       → -c mcp_servers.X.{command|args|env|...}=...
        //   opencode    → 미지원 (런타임 override 없음 — 카탈로그 ref만)
        mcpConfigPath: loadout.mcpConfigPath ?? undefined,
        mcpServers,
        onStdout: (chunk) => {
          appendChunk(runId, "stdout", chunk);
          tapCost(chunk);
          tapSessionId(chunk);
          tapTouches(chunk);
          tapTools(chunk);
        },
        onStderr: (chunk) => appendChunk(runId, "stderr", chunk),
      },
      agent.adapterConfig,
    );

    markRunRunning(runId, handle.pid);

    const result = await handle.promise;

    const status = abort.signal.aborted
      ? "cancelled"
      : result.exitCode === 0
        ? "succeeded"
        : "failed";
    markRunFinished(runId, status, result.exitCode);
    finishLog(runId, {
      ts: new Date().toISOString(),
      status,
      exitCode: result.exitCode,
    });
    log[status === "failed" ? "warn" : "info"](
      { status, exitCode: result.exitCode },
      "run finished",
    );
  } catch (err) {
    log.error({ err }, "adapter threw");
    appendChunk(
      runId,
      "stderr",
      `[loom] adapter error: ${(err as Error).message}\n`,
    );
    markRunFinished(runId, "failed", null);
    finishLog(runId, {
      ts: new Date().toISOString(),
      status: "failed",
      exitCode: null,
    });
  } finally {
    // after-snapshot은 모든 종료 경로 커버 — success/failure/cancel/throw —
    // diff baseline이 일관되게 유지됨.
    const afterRef = await snapshotWorkTree(cwd).catch(() => null);
    if (afterRef) setRunAfterRef(runId, afterRef);

    // run_changes 영속화. file-history 쿼리가 SQL join으로 답할 수 있게.
    try {
      const run = getRun(runId);
      const changes = await diffStat(run?.beforeRef ?? null, afterRef, cwd);
      if (changes.length > 0) replaceRunChanges(runId, changes);
    } catch {
      // best-effort. 변경 영속화 실패가 run을 실패시키면 안 됨.
    }
    stopTracking(runId);
    stopToolTracking(runId);
    untrackActiveRun(runId);
  }
}
