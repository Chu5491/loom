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
  setRunSessionId,
} from "../db/runs.js";
import { replaceRunChanges } from "../db/run-changes.js";
import { getMcpServersByIds } from "../db/mcp-servers.js";
import { getGlobalRule } from "../db/settings.js";
import { getSpecsByIds } from "../db/specs.js";
import { getThread, touchThread } from "../db/threads.js";
import { listEdgesFromAgentInProject } from "../db/harness-edges.js";
import { runLogger } from "../logger.js";
import {
  buildHandoffPrompt,
  resolveAutoEdges,
  MAX_HARNESS_HOPS,
  type RunOutcome,
} from "./harness.js";
import { extractRunResultText } from "./run/run-result.js";
import { startTracking, stopTracking } from "./active-touches.js";
import {
  startToolTracking,
  stopToolTracking,
} from "./active-tools.js";
import { config } from "../config.js";
import { autoCommitAll } from "./git.js";
import { diffStat, snapshotWorkTree } from "./git-snapshot.js";
import { appendChunk, finishLog, startLog } from "./log-store.js";
import { activeRunCount, trackActiveRun, untrackActiveRun, reserveRunSlot, releaseRunSlot } from "./run/active-runs.js";
import {
  materializeAgentLoadout,
  type AgentLoadout,
} from "./run/agent-loadout.js";
import { composePrompt } from "./run/prompt-composer.js";
import {
  makeCostTapper,
  makeDelegationTapper,
  makeSessionIdTapper,
  makeToolsTapper,
  makeTouchesTapper,
} from "./run/run-tappers.js";
import { resolveThreadForRun } from "./run/thread-resolver.js";

// 백워드 호환 재내보내기 — 기존 import 경로를 깨지 않도록.
export { composePrompt } from "./run/prompt-composer.js";
export {
  activeRunCount,
  cancelRun,
  isRunActive,
  _activeRunIds,
  reserveRunSlot,
  releaseRunSlot,
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
  /** 새 thread 를 만들 프로젝트(전역 에이전트가 *어느 팀에서* 도는지). 미지정 시
   *  agent 의 origin 프로젝트로 폴백. 기존 thread/parent 가 있으면 그 thread 의
   *  프로젝트가 우선. */
  projectId?: string | null;
  attachedSpecIds?: string[];
  /** opt-in: thread.contextBundle을 *이 run의* 프롬프트 앞에 붙임. 자동 주입 절대 안 함. */
  includeContext?: boolean;
  /** true면 이번 run에 `--resume <session_id>`를 안 붙임. CLI가 fresh
   *  session id를 새로 발행하고, 다음 run부터는 그걸 이어가게 됨. */
  freshSession?: boolean;
}

export type StartRunResult =
  | { ok: true; run: Run }
  | { ok: false; status: 400 | 404 | 429; error: string };

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

  if (activeRunCount() >= config.maxConcurrentRuns) {
    return {
      ok: false,
      status: 429,
      error: `concurrent_limit: max ${config.maxConcurrentRuns} runs`,
    };
  }

  // Reserve slot synchronously before any await — closes the race window
  // where N concurrent requests all read the same activeRunCount() snapshot.
  reserveRunSlot();

  try {
    return await startRunInner(input, agent, adapter);
  } finally {
    releaseRunSlot();
  }
}

async function startRunInner(
  input: StartRunInput,
  agent: NonNullable<ReturnType<typeof getAgent>>,
  adapter: NonNullable<ReturnType<typeof getAdapter>>,
): Promise<StartRunResult> {
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

  // 스레드 결정 (explicit > inherit-from-parent > create-fresh).
  // git-first: 새 thread 생성 시 worktree 도 자동 할당 (async).
  const threadId = await resolveThreadForRun({
    explicitThreadId: input.threadId ?? null,
    parentRunId: input.parentRunId ?? null,
    prompt: input.prompt,
    projectId: input.projectId ?? agent.projectId,
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
  // run 의 프로젝트 = thread 의 프로젝트(전역 에이전트가 어느 팀에서 도는지).
  // 명시 input.projectId, 없으면 agent origin 으로 폴백.
  const runProjectId = thread?.projectId ?? input.projectId ?? agent.projectId;
  const project = runProjectId ? getProject(runProjectId) : null;
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
    globalRule: getGlobalRule(),
    projectRule: project?.rule,
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
    !!thread?.worktreePath,
    runProjectId,
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
  inWorktree: boolean,
  projectId: string | null,
): Promise<void> {
  const log = runLogger(runId, {
    agentId: agent.id,
    adapter: agent.adapterKind,
  });
  log.info({ cwd, resumeSessionId }, "run starting");

  // 종료 후 하네스 평가에 쓸 결과 — try/catch 어느 경로로 끝나든 finally 에서
  // 같은 값을 읽도록 바깥 스코프에 둔다.
  let finalStatus: RunOutcome["status"] = "failed";
  let changedFileCount = 0;

  try {
    const beforeRef = await snapshotWorkTree(cwd);
    if (beforeRef) setRunBeforeRef(runId, beforeRef);

    const cost = makeCostTapper(runId);
    // resumed run → session_id는 이미 확정된 값. CLI 출력에서 추출하면
    // turn 단위 ID가 잡혀 다음 run이 잘못된 세션으로 resume → 반복 실패.
    // 입력 값을 그대로 유지하고 tapper는 fresh run에서만 동작.
    const sessionId = resumeSessionId
      ? (() => {
          setRunSessionId(runId, resumeSessionId);
          return { tap: () => {}, flush: () => {} };
        })()
      : makeSessionIdTapper(runId, adapter);
    const touches = makeTouchesTapper(runId, adapter);
    const tools = makeToolsTapper(runId, adapter);
    const delegations = makeDelegationTapper(runId, adapter);

    if (projectId) {
      startTracking({ runId, agentId: agent.id, projectId, cwd });
      startToolTracking({ runId, agentId: agent.id, projectId });
    }

    // 프로젝트 단위 env — 그 프로젝트의 모든 run 이 공통으로 받는 KV. 에이전트의
    // adapterConfig.env가 더 높은 우선순위 (define.ts spawn 합성 참고).
    const projectEnv = projectId ? listProjectEnv(projectId) : {};

    const handle = await adapter.spawn(
      {
        prompt: composedPrompt,
        cwd,
        env: projectEnv,
        signal: abort.signal,
        resumeSessionId,
        // 로드아웃/MCP 주입 — 어댑터가 자기 CLI에 맞게 처리:
        //   claude-code → --add-dir <loadoutDir> (Read 권한) +
        //                  --mcp-config <path> --strict-mcp-config
        //   antigravity → --allowed-mcp-server-names ...
        //   codex       → -c mcp_servers.X.{command|args|env|...}=...
        //   opencode    → write loadoutDir/xdg/opencode/opencode.json +
        //                  XDG_CONFIG_HOME / OPENCODE_DISABLE_PROJECT_CONFIG env
        loadoutDir: loadout.dir,
        mcpConfigPath: loadout.mcpConfigPath ?? undefined,
        mcpServers,
        onStdout: (chunk) => {
          appendChunk(runId, "stdout", chunk);
          cost.tap(chunk);
          sessionId.tap(chunk);
          touches.tap(chunk);
          tools.tap(chunk);
          delegations.tap(chunk);
        },
        onStderr: (chunk) => appendChunk(runId, "stderr", chunk),
      },
      agent.adapterConfig,
    );

    markRunRunning(runId, handle.pid);

    const result = await handle.promise;

    // 프로세스 종료 후 lineBuffer에 남은 잔여 라인 처리.
    cost.flush();
    sessionId.flush();
    touches.flush();
    tools.flush();
    delegations.flush();

    finalStatus = abort.signal.aborted
      ? "cancelled"
      : result.exitCode === 0
        ? "succeeded"
        : "failed";
    markRunFinished(runId, finalStatus, result.exitCode);
    finishLog(runId, {
      ts: new Date().toISOString(),
      status: finalStatus,
      exitCode: result.exitCode,
    });
    log[finalStatus === "failed" ? "warn" : "info"](
      { status: finalStatus, exitCode: result.exitCode },
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
    const afterRef = await snapshotWorkTree(cwd);
    if (afterRef) setRunAfterRef(runId, afterRef);

    // run_changes 영속화. file-history 쿼리가 SQL join으로 답할 수 있게.
    try {
      const run = getRun(runId);
      const changes = await diffStat(run?.beforeRef ?? null, afterRef, cwd);
      changedFileCount = changes.length;
      if (changes.length > 0) replaceRunChanges(runId, changes);
    } catch {
      // best-effort. 변경 영속화 실패가 run을 실패시키면 안 됨.
    }

    // git-first: worktree 브랜치에서 돌았으면 변경사항 자동 커밋.
    // 메인 checkout 에서는 건드리지 않음 — 사용자가 직접 커밋하도록.
    if (inWorktree) {
      try {
        const msg = `loom: ${agent.name} run ${runId.slice(0, 8)}`;
        await autoCommitAll(cwd, msg);
      } catch {
        log.warn("auto-commit failed (best-effort)");
      }
    }

    stopTracking(runId);
    stopToolTracking(runId);
    untrackActiveRun(runId);

    // 하네스 자동 발화 — 모든 정리/슬롯 해제 후. 자식 run 이 concurrency 슬롯을
    // 잡을 수 있도록 부모 untrack 뒤에 둔다. fire-and-forget, 내부에서 에러 처리.
    const finishedRun = getRun(runId);
    if (finishedRun && projectId) {
      void fireHarnessEdges(finishedRun, agent, projectId, {
        status: finalStatus,
        changedFileCount,
      });
    }
  }
}

// parent_run 체인 깊이 — A→B→A 무한루프 방어. MAX_HARNESS_HOPS 에 닿으면 발화 중단.
function harnessHops(run: Run): number {
  let hops = 0;
  let cur = run.parentRunId;
  while (cur && hops <= MAX_HARNESS_HOPS) {
    const parent = getRun(cur);
    if (!parent) break;
    hops++;
    cur = parent.parentRunId;
  }
  return hops;
}

// run 완료 시 그 에이전트가 source 인 auto 엣지를 평가해 자식 run 을 띄운다.
// fire-and-forget — 모든 에러를 내부에서 처리(호출부는 void).
async function fireHarnessEdges(
  finishedRun: Run,
  fromAgent: NonNullable<ReturnType<typeof getAgent>>,
  projectId: string,
  outcome: RunOutcome,
): Promise<void> {
  // 이 run 의 프로젝트 엣지만 — 전역 에이전트는 프로젝트마다 다른 하네스를 가짐.
  const fired = resolveAutoEdges(
    listEdgesFromAgentInProject(fromAgent.id, projectId),
    outcome,
  );
  if (fired.length === 0) return;

  const log = runLogger(finishedRun.id, {
    agentId: fromAgent.id,
    adapter: fromAgent.adapterKind,
  });

  if (harnessHops(finishedRun) >= MAX_HARNESS_HOPS) {
    log.warn({ max: MAX_HARNESS_HOPS }, "harness hop limit reached; not firing");
    return;
  }

  // carry 하는 엣지가 하나라도 있을 때만 결과를 읽음 (로그 파일 I/O 회피).
  const resultText = fired.some((e) => e.carryResult)
    ? await extractRunResultText(finishedRun).catch(() => null)
    : null;

  for (const edge of fired) {
    const prompt = buildHandoffPrompt({
      edgePrompt: edge.prompt,
      carryResult: edge.carryResult,
      fromAgentName: fromAgent.name,
      fromRunId: finishedRun.id,
      resultText,
    });
    startRun({
      agentId: edge.toAgentId,
      prompt,
      threadId: finishedRun.threadId,
      parentRunId: finishedRun.id,
    })
      .then((res) => {
        if (!res.ok) {
          log.warn(
            { edge: edge.id, error: res.error },
            "harness child did not start",
          );
        }
      })
      .catch((err) => log.error({ err, edge: edge.id }, "harness child threw"));
  }
}
