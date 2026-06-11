// 런 엔진 — office 에이전트를 spawn 하고, raw 를 디스크에 보존하면서
// parseEvents 로 OfficeEvent 를 만들어 구독자(SSE)에게 푸시한다.
// P2: 영속은 raw 로그(data/logs) + 인메모리 run 맵. (sqlite 기록은 P2b.)

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AdapterConfig, McpServer, OfficeEvent, RunInfo } from "@loom/core";
import { getAdapter } from "../adapters/registry.js";
import { config, paths } from "../config.js";
import { appendEvent, deleteRunDb, finishRun, getProjectDb, getRunDb, getRunEventsDb, getThreadDb, insertRun, lastSessionId, listRunsDb, type RunFilter } from "../db.js";
import { logger } from "../logger.js";
import {
  readAgents,
  readEdges,
  readMcp,
  readRules,
  readSkills,
} from "../office.js";
import { composePrompt } from "./compose.js";
import { buildHandoffPrompt, MAX_HARNESS_HOPS, resolveAutoEdges, type RunOutcome } from "./harness.js";
import { materializeLoadout } from "./loadout.js";
import { parseLine } from "./parse.js";

export interface StartRunInput {
  agent: string; // office agent name
  prompt: string;
  cwd?: string;
  /** 실행할 프로젝트(작업 디렉토리) id. 있으면 그 경로가 cwd. */
  projectId?: string | null;
  /** 대화 스레드 id. 같은 스레드의 같은 에이전트 직전 세션을 resume 한다. */
  threadId?: string | null;
  /** 하네스 자동발화로 만든 자식이면 부모 run id. 사용자 시작이면 생략. */
  parentRunId?: string | null;
  /** 이 run 에만 추가로 실을 스킬 이름들 — 사용자가 컴포저에서 명시적으로 첨부.
   *  (자동주입 아님: 명시 첨부는 헌법이 허용하는 유일한 추가 경로.) */
  skills?: string[];
}
export type StartRunResult =
  | { ok: true; run: RunInfo }
  | { ok: false; status: 400 | 404; error: string };

type Listener = (ev: { kind: "event"; event: OfficeEvent } | { kind: "done"; run: RunInfo }) => void;

interface RunState {
  info: RunInfo;
  events: OfficeEvent[];
  listeners: Set<Listener>;
  rawFd: number;
  buf: string; // stdout line buffer
  sawResult: boolean;
  lastText: string;
  seq: number; // run_events 순번 — 디스크 영속 순서 보장
  costUsd?: number;
  sessionId?: string;
  abort: AbortController;
  kill: () => void;
}

const runs = new Map<string, RunState>();

export function getRun(id: string): RunInfo | null {
  return runs.get(id)?.info ?? getRunDb(id);
}
export function listRuns(filter?: RunFilter): RunInfo[] {
  return listRunsDb(filter);
}

export function subscribe(id: string, fn: Listener): { replay: OfficeEvent[]; done: RunInfo | null; off: () => void } | null {
  const r = runs.get(id);
  if (!r) return null;
  r.listeners.add(fn);
  return {
    replay: [...r.events],
    done: r.info.status === "running" ? null : r.info,
    off: () => r.listeners.delete(fn),
  };
}

// 서버 재시작 후 인메모리 Map 에 없는 완료 run — 디스크 기록에서 정적 복원.
export function getPersistedRun(id: string): { events: OfficeEvent[]; run: RunInfo } | null {
  const run = getRunDb(id);
  if (!run) return null;
  return { events: getRunEventsDb(id), run };
}

// 기록 삭제 — running 은 거부(먼저 취소). 인메모리 상태도 같이 비운다.
export function deleteRun(id: string): { ok: true } | { ok: false; status: 404 | 409; error: string } {
  const info = getRun(id);
  if (!info) return { ok: false, status: 404, error: "not_found" };
  if (info.status === "running") return { ok: false, status: 409, error: "still_running" };
  runs.delete(id);
  deleteRunDb(id);
  return { ok: true };
}

export function cancelRun(id: string): boolean {
  const r = runs.get(id);
  if (!r || r.info.status !== "running") return false;
  r.abort.abort();
  r.kill();
  return true;
}

// "${ENV_NAME}" 참조를 process.env 로 치환 — secret 은 파일에 리터럴로 안 둔다.
function resolveRefs(obj: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "");
  }
  return out;
}
function resolveServer(s: McpServer): McpServer {
  return { ...s, env: resolveRefs(s.env), headers: resolveRefs(s.headers) };
}

export async function startRun(input: StartRunInput): Promise<StartRunResult> {
  const agent = readAgents().find((a) => a.name === input.agent);
  if (!agent) return { ok: false, status: 404, error: "agent_not_found" };
  const adapter = getAdapter(agent.adapter);
  if (!adapter) return { ok: false, status: 400, error: `adapter_not_registered: ${agent.adapter}` };

  // 프로젝트 지정 시 그 디렉토리가 cwd. 검증 실패면 거절(엉뚱한 곳에서 돌지 않게).
  const project = input.projectId ? getProjectDb(input.projectId) : null;
  if (input.projectId && !project) return { ok: false, status: 404, error: "project_not_found" };
  const cwd = project?.path ?? input.cwd ?? config.home;

  if (input.threadId && !getThreadDb(input.threadId)) {
    return { ok: false, status: 404, error: "thread_not_found" };
  }
  // 대화 연속성 — 같은 스레드에서 이 에이전트의 직전 CLI 세션을 resume.
  // 어댑터가 resume 을 모르면 조용히 무시된다(adapter-utils 의 opt-in 설계).
  const resumeSessionId = input.threadId ? lastSessionId(input.threadId, agent.name) : null;

  // office 에서 이 에이전트가 끌어올 rules·skills·mcp 만 추린다.
  const allRules = readRules();
  const allSkills = readSkills();
  const allMcp = readMcp();
  const rules = (agent.rules ?? []).map((n) => allRules.find((r) => r.name === n)).filter(Boolean).map((r) => r!.body);
  // 에이전트 정의 스킬 + 이 run 에 사용자가 명시 첨부한 스킬(중복 제거).
  const skillNames = [...new Set([...(agent.skills ?? []), ...(input.skills ?? [])])];
  const skills = skillNames.map((n) => allSkills.find((s) => s.name === n)).filter(Boolean).map((s) => s!);
  const mcp = (agent.mcp ?? []).map((n) => allMcp.find((m) => m.name === n)).filter(Boolean).map((m) => resolveServer(m!));

  const loadout = materializeLoadout(agent, skills, mcp);
  const prompt = composePrompt({ userPrompt: input.prompt, rules, agentPrompt: agent.prompt, loadout });

  const id = randomUUID();
  const info: RunInfo = {
    id,
    agent: agent.name,
    prompt: input.prompt,
    status: "running",
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    parentRunId: input.parentRunId ?? null,
    projectId: input.projectId ?? null,
    threadId: input.threadId ?? null,
    costUsd: null,
  };
  fs.mkdirSync(paths.logs, { recursive: true });
  const rawFd = fs.openSync(path.join(paths.logs, `${id}.log`), "a");
  const abort = new AbortController();

  const state: RunState = {
    info,
    events: [],
    listeners: new Set(),
    rawFd,
    buf: "",
    sawResult: false,
    lastText: "",
    seq: 0,
    abort,
    kill: () => {},
  };
  runs.set(id, state);
  insertRun(info); // history 영속 — running 상태로 즉시 기록(finish 가 갱신).

  // adapterConfig — 에이전트 config + model. env 의 secret 참조도 resolve.
  const cfg = (agent.config ?? {}) as AdapterConfig;
  const adapterConfig: AdapterConfig = {
    ...cfg,
    ...(agent.model ? { model: agent.model } : {}),
    // 권한: bypass → 전 어댑터 공통 위험 토글, acceptEdits → claude/devin permission-mode.
    ...(agent.permission === "bypass" ? { dangerouslySkipPermissions: true } : {}),
    ...(agent.permission === "acceptEdits" ? { permissionMode: "acceptEdits" } : {}),
    // 추론 강도: 지원하는 어댑터(codex 등)가 config.reasoning 으로 읽음.
    ...(agent.reasoning ? { reasoning: agent.reasoning } : {}),
    ...(cfg.env ? { env: resolveRefs(cfg.env as Record<string, string>) } : {}),
  };

  void run(state, adapter, adapterConfig, prompt, mcp, loadout, cwd, resumeSessionId);
  return { ok: true, run: info };
}

function emit(state: RunState, events: OfficeEvent[]): void {
  for (const ev of events) {
    state.events.push(ev);
    appendEvent(state.info.id, state.seq++, ev); // 순서 보존하며 디스크에 기록
    if (ev.kind === "result") {
      state.sawResult = true;
      state.costUsd = ev.costUsd;
      state.sessionId = ev.sessionId;
    }
    if (ev.kind === "text") state.lastText = ev.text;
    for (const fn of state.listeners) {
      try {
        fn({ kind: "event", event: ev });
      } catch {
        // listener 오류가 스트림을 끊으면 안 됨
      }
    }
  }
}

function consume(state: RunState, chunk: string): void {
  fs.writeSync(state.rawFd, chunk);
  state.buf += chunk;
  const lines = state.buf.split("\n");
  state.buf = lines.pop() ?? "";
  for (const line of lines) emit(state, parseLine(line));
}

async function run(
  state: RunState,
  adapter: NonNullable<ReturnType<typeof getAdapter>>,
  adapterConfig: AdapterConfig,
  prompt: string,
  mcp: McpServer[],
  loadout: { dir: string; mcpConfigPath: string | null },
  cwd: string,
  resumeSessionId: string | null,
): Promise<void> {
  const log = logger.child({ runId: state.info.id, agent: state.info.agent });
  log.info({ cwd, resume: !!resumeSessionId }, "run start");
  try {
    const handle = await adapter.spawn(
      {
        prompt,
        cwd,
        env: {},
        signal: state.abort.signal,
        loadoutDir: loadout.dir,
        mcpConfigPath: loadout.mcpConfigPath ?? undefined,
        mcpServers: mcp,
        resumeSessionId: resumeSessionId ?? undefined,
        onStdout: (c) => consume(state, c),
        onStderr: (c) => fs.writeSync(state.rawFd, c),
      },
      adapterConfig,
    );
    state.kill = handle.kill;
    const { exitCode } = await handle.promise;

    if (state.buf.trim()) emit(state, parseLine(state.buf));
    state.buf = "";

    // 최종 result 이벤트가 없었으면(예: devin plain text) 누적 텍스트로 합성.
    if (!state.sawResult && state.lastText) {
      emit(state, [{ kind: "result", text: state.lastText }]);
    }

    concludeRun(state, state.abort.signal.aborted ? "cancelled" : exitCode === 0 ? "succeeded" : "failed", exitCode);
    log.info({ exitCode }, "run done");
  } catch (err) {
    emit(state, [{ kind: "error", message: (err as Error).message }]);
    concludeRun(state, "failed", null);
    log.error({ err }, "run threw");
  }
}

// 종료 시퀀스: (1) 자동발화 엣지 평가 → 부모 버블에 handoff 이벤트(라이브+영속),
// (2) finish(=done 통지), (3) 자식 run spawn(fire-and-forget). handoff 를 done
// 앞에 emit 하므로 라이브 구독자가 스트림 닫기 전에 핸드오프를 본다.
function concludeRun(state: RunState, status: RunInfo["status"], exitCode: number | null): void {
  const fired = evaluateFiredEdges(state, status);
  for (const edge of fired) emit(state, [{ kind: "handoff", toAgent: edge.to, via: "edge" }]);
  finish(state, status, exitCode);
  spawnHarnessChildren(state, fired);
}

// parentRunId 체인 깊이 — A→B→A 무한루프 방어. MAX 에 닿으면 발화 중단.
function harnessHops(info: RunInfo): number {
  let hops = 0;
  let cur = info.parentRunId;
  while (cur && hops <= MAX_HARNESS_HOPS) {
    const parent = getRun(cur);
    if (!parent) break;
    hops++;
    cur = parent.parentRunId;
  }
  return hops;
}

function evaluateFiredEdges(state: RunState, status: RunInfo["status"]): import("@loom/core").HarnessEdge[] {
  if (status === "cancelled") return []; // cancelled 는 발화 안 함
  try {
    const outcome: RunOutcome = {
      status,
      changedFileCount: state.events.filter((e) => e.kind === "file").length,
    };
    const fired = resolveAutoEdges(
      readEdges().filter((e) => e.from === state.info.agent),
      outcome,
    );
    if (fired.length === 0) return [];
    if (harnessHops(state.info) >= MAX_HARNESS_HOPS) {
      logger.warn({ runId: state.info.id, max: MAX_HARNESS_HOPS }, "harness hop limit reached; not firing");
      return [];
    }
    return fired;
  } catch (err) {
    logger.error({ err, runId: state.info.id }, "harness edge eval failed");
    return [];
  }
}

// ask/manual 엣지의 수동 발화 — 사용자가 UI 에서 "넘기기"를 눌렀을 때.
// 완료된 run 에서 from=run.agent, to=대상 인 엣지를 찾아 자식 run 을 시작한다.
export async function fireManualHandoff(runId: string, to: string): Promise<StartRunResult> {
  const run = getRun(runId);
  if (!run) return { ok: false, status: 404, error: "run_not_found" };
  if (run.status === "running") return { ok: false, status: 400, error: "run_still_running" };
  const edge = readEdges().find((e) => e.from === run.agent && e.to === to);
  if (!edge) return { ok: false, status: 404, error: "edge_not_found" };

  // 결과 텍스트 — 인메모리에 있으면 거기서, 아니면 디스크 기록에서.
  const events = runs.get(runId)?.events ?? getRunEventsDb(runId);
  const last = [...events].reverse().find(
    (e): e is Extract<OfficeEvent, { kind: "result" }> => e.kind === "result",
  );
  const prompt = buildHandoffPrompt({
    edgePrompt: edge.prompt,
    carryResult: !!edge.carryResult,
    fromAgentName: run.agent,
    fromRunId: run.id,
    resultText: last?.text ?? null,
  });
  return startRun({ agent: to, prompt, parentRunId: run.id, projectId: run.projectId, threadId: run.threadId });
}

function spawnHarnessChildren(state: RunState, fired: import("@loom/core").HarnessEdge[]): void {
  if (fired.length === 0) return;
  const log = logger.child({ runId: state.info.id, agent: state.info.agent });
  const last = [...state.events].reverse().find(
    (e): e is Extract<OfficeEvent, { kind: "result" }> => e.kind === "result",
  );
  const resultText = last?.text ?? state.lastText ?? null;
  for (const edge of fired) {
    const prompt = buildHandoffPrompt({
      edgePrompt: edge.prompt,
      carryResult: !!edge.carryResult,
      fromAgentName: state.info.agent,
      fromRunId: state.info.id,
      resultText,
    });
    void startRun({ agent: edge.to, prompt, parentRunId: state.info.id, projectId: state.info.projectId, threadId: state.info.threadId })
      .then((r) => {
        if (!r.ok) log.warn({ to: edge.to, error: r.error }, "harness child did not start");
      })
      .catch((err) => log.error({ err, to: edge.to }, "harness child threw"));
  }
}

function finish(state: RunState, status: RunInfo["status"], exitCode: number | null): void {
  state.info.status = status;
  state.info.exitCode = exitCode;
  state.info.endedAt = new Date().toISOString();
  state.info.costUsd = state.costUsd ?? null;
  finishRun(state.info, { costUsd: state.costUsd, sessionId: state.sessionId });
  try {
    fs.closeSync(state.rawFd);
  } catch {
    // 이미 닫혔을 수 있음
  }
  for (const fn of state.listeners) {
    try {
      fn({ kind: "done", run: state.info });
    } catch {
      // ignore
    }
  }
}
