// 런 엔진 — office 에이전트를 spawn 하고, raw 를 디스크에 보존하면서
// parseEvents 로 OfficeEvent 를 만들어 구독자(SSE)에게 푸시한다.
// P2: 영속은 raw 로그(data/logs) + 인메모리 run 맵. (sqlite 기록은 P2b.)

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AdapterConfig, AgentSpec, McpServer, OfficeEvent, RunInfo, RuleSpec, SkillSpec } from "@loom/core";
import { getAdapter } from "../adapters/registry.js";
import { config, paths } from "../config.js";
import { appendEvent, deleteRunDb, finishRun, getProjectDb, getRunDb, getRunEventsDb, getThreadDb, insertRun, lastSessionId, listRunsDb, monthCostUsd, type RunFilter } from "../db.js";
import { logger } from "../logger.js";
import {
  readAgents,
  readBudget,
  readMcp,
  readRules,
  readSkills,
  readWorkflows,
} from "../office.js";
import { composePrompt } from "./compose.js";
import { materializeLoadout } from "./loadout.js";
import { parseLine } from "./parse.js";
// 순환 import (workflow.ts ↔ engine.ts) — 양쪽 다 호출 시점에만 쓰는 함수 참조라 안전.
import { capText, fenceHandoff, resolveAutoWorkflows, startWorkflow, type RunOutcome } from "./workflow.js";

/** 자동 체인(워크플로우 트리거·위임)의 최대 깊이 — parentRunId 로 측정, 무한루프 방어. */
export const MAX_CHAIN_HOPS = 5;

// ── 동시 실행 한도 — 스케줄×트리거×위임이 겹쳐도 CLI 폭주 방지. FIFO 대기열.
// 위임 자식은 우회(부모가 슬롯을 쥔 채 결과를 기다리므로 — 한도=1 데드락 방지).
let activeSlots = 0;
const slotWaiters: (() => void)[] = [];
async function acquireSlot(): Promise<void> {
  if (activeSlots < config.maxConcurrentRuns) {
    activeSlots++;
    return;
  }
  // 대기자는 releaseSlot 이 슬롯을 넘겨주며 깨운다 — 여기서 다시 세지 않는다.
  // (release 후 새 acquire 가 먼저 끼어들어 한도를 넘는 race 방지.)
  await new Promise<void>((resolve) => slotWaiters.push(resolve));
}
function releaseSlot(): void {
  const next = slotWaiters.shift();
  if (next) {
    next(); // 슬롯을 그대로 넘긴다 — activeSlots 변동 없음
    return;
  }
  activeSlots = Math.max(0, activeSlots - 1);
}

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
  /** 내장 기능(git 커밋·분석) 전용 — 에이전트의 prompt 를 이 지침으로 대체.
   *  office/prompts/<feature>.md 에서 사용자가 관리하는 명시 정의. */
  promptOverride?: string;
  /** 워크플로우 스텝으로 도는 run 의 태그 — 진행 보드가 노드별 상태를 그린다. */
  workflow?: string;
  node?: string;
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
  /** run 스코프 loadout 디렉토리 — finish 가 정리한다. */
  loadoutDir?: string;
  /** 영속 실패 로그 1회 가드 — ENOSPC 류는 줄마다 반복돼 로그를 범람시킨다. */
  persistWarned?: boolean;
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// 실제로 CLI 에 들어간 합성 프롬프트(투명성). id 는 UUID 만 — 경로 탈출 차단.
export function getRunPromptText(id: string): string | null {
  if (!UUID_RE.test(id)) return null;
  try {
    return fs.readFileSync(path.join(paths.logs, `${id}.prompt.txt`), "utf8");
  } catch {
    return null; // 영속 이전의 옛 run — 프롬프트 기록 없음
  }
}

/** CLI raw 출력(진실) — run 상세 화면용. 1MB cap(뷰어 보호). */
export function getRunRawText(id: string): string | null {
  if (!UUID_RE.test(id)) return null;
  try {
    const file = path.join(paths.logs, `${id}.log`);
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, "r");
    try {
      const len = Math.min(size, 1024 * 1024);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len); // 크면 꼬리쪽이 더 유용
      return (size > len ? `… (앞 ${size - len} bytes 생략)\n` : "") + buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
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
  if (r && r.info.status === "running") {
    r.abort.abort();
    r.kill();
    return true;
  }
  // 인메모리에 없는데 DB 가 running — 직전 서버와 함께 죽은 좀비. 기록을 닫아준다
  // (부팅 sweep 이 있지만, 같은 프로세스 수명 안에서도 막히지 않게 이중 방어).
  const stale = getRunDb(id);
  if (stale && stale.status === "running") {
    stale.status = "cancelled";
    stale.endedAt = new Date().toISOString();
    finishRun(stale, {});
    return true;
  }
  return false;
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

// 에이전트가 office 에서 끌어올 rules·skills·mcp — startRun 과 프리뷰가 같은 선택.
function selectSpecs(agent: AgentSpec, extraSkills: string[]): { rules: string[]; skills: SkillSpec[]; mcp: McpServer[] } {
  const allRules = readRules();
  const allSkills = readSkills();
  const allMcp = readMcp();
  const rules = (agent.rules ?? []).map((n) => allRules.find((r: RuleSpec) => r.name === n)).filter(Boolean).map((r) => r!.body);
  // 에이전트 정의 스킬 + 이 run 에 사용자가 명시 첨부한 스킬(중복 제거).
  const skillNames = [...new Set([...(agent.skills ?? []), ...extraSkills])];
  const skills = skillNames.map((n) => allSkills.find((s) => s.name === n)).filter(Boolean).map((s) => s!);
  const mcp = (agent.mcp ?? []).map((n) => allMcp.find((m) => m.name === n)).filter(Boolean).map((m) => resolveServer(m!));
  return { rules, skills, mcp };
}

/** 프리뷰 — run 없이, 이 에이전트로 시작하면 CLI 에 들어갈 합성 프롬프트.
 *  loadout 도 실제처럼 펼치되 "preview" 스코프 — 라이브 run 의 디렉토리와 격리.
 *  위임 도구(runId 가 필요)는 제외 — delegate 에이전트는 MCP 인덱스에 loom 한 줄이 더 붙는 차이만. */
export function previewRunPrompt(
  agentName: string,
  userPrompt: string,
  extraSkills: string[] = [],
): { ok: true; prompt: string } | { ok: false; status: 404; error: string } {
  const agent = readAgents().find((a) => a.name === agentName);
  if (!agent) return { ok: false, status: 404, error: "agent_not_found" };
  const { rules, skills, mcp } = selectSpecs(agent, extraSkills);
  const loadout = materializeLoadout(agent, skills, mcp, null, "preview");
  const prompt = composePrompt({ userPrompt, rules, agentPrompt: agent.prompt, loadout });
  return { ok: true, prompt };
}

export async function startRun(input: StartRunInput): Promise<StartRunResult> {
  const agent = readAgents().find((a) => a.name === input.agent);
  if (!agent) return { ok: false, status: 404, error: "agent_not_found" };
  const adapter = getAdapter(agent.adapter);
  if (!adapter) return { ok: false, status: 400, error: `adapter_not_registered: ${agent.adapter}` };

  // 월 예산 가드 — 초과 시 새 run 거부(이미 도는 run 은 끝까지). office/budget.json.
  const budget = readBudget();
  if (budget.monthlyUsd != null) {
    const spent = monthCostUsd();
    if (spent >= budget.monthlyUsd) {
      return { ok: false, status: 400, error: `budget_exceeded: $${spent.toFixed(2)} / $${budget.monthlyUsd} this month` };
    }
  }
  const agentCap = budget.perAgent[agent.name];
  if (agentCap != null) {
    const spent = monthCostUsd(agent.name);
    if (spent >= agentCap) {
      return { ok: false, status: 400, error: `agent_budget_exceeded: @${agent.name} $${spent.toFixed(2)} / $${agentCap} this month` };
    }
  }

  // 프로젝트 지정 시 그 디렉토리가 cwd. 검증 실패면 거절(엉뚱한 곳에서 돌지 않게).
  const project = input.projectId ? getProjectDb(input.projectId) : null;
  if (input.projectId && !project) return { ok: false, status: 404, error: "project_not_found" };
  const cwd = project?.path ?? input.cwd ?? config.home;
  // cwd 가 사라졌으면(예: /tmp 프로젝트를 macOS 가 청소) Node 의 spawn 이
  // "spawn claude ENOENT" 라는 오해 소지 큰 에러를 던진다 — 여기서 명확히 거른다.
  if (!fs.existsSync(cwd)) {
    return { ok: false, status: 400, error: `project_dir_missing: ${cwd}` };
  }

  if (input.threadId && !getThreadDb(input.threadId)) {
    return { ok: false, status: 404, error: "thread_not_found" };
  }
  // 대화 연속성 — 같은 스레드에서 이 에이전트의 직전 CLI 세션을 resume.
  // 어댑터가 resume 을 모르면 조용히 무시된다(adapter-utils 의 opt-in 설계).
  const resumeSessionId = input.threadId ? lastSessionId(input.threadId, agent.name) : null;

  // office 에서 이 에이전트가 끌어올 rules·skills·mcp 만 추린다.
  const { rules, skills, mcp } = selectSpecs(agent, input.skills ?? []);

  const id = randomUUID();

  // 팀원 위임(opt-in) — MCP 지원 CLI 는 loom 의 delegate MCP 도구를 loadout 에,
  // MCP 불가 CLI(antigravity)는 loadout 의 셸 브리지(delegate.sh)를 싣는다.
  // 어느 쪽이든 runId 로 "누가 위임하는지"를 알아 부모/스레드/프로젝트를 상속시킨다.
  let bridge: import("./loadout.js").DelegateBridge | null = null;
  if (agent.delegate) {
    if (adapter.supportsMcpServers) {
      mcp.push({
        name: "loom",
        description: "Delegate a task to a teammate agent",
        kind: "http",
        command: null,
        args: [],
        env: {},
        url: `http://${config.host}:${config.port}/api/mcp?runId=${id}`,
        headers: {},
      });
    } else {
      bridge = {
        runId: id,
        url: `http://${config.host}:${config.port}/api/delegate`,
        teammates: readAgents().filter((a) => a.name !== agent.name).map((a) => a.name),
      };
    }
  }

  const loadout = materializeLoadout(agent, skills, mcp, bridge, id);
  // 프로젝트 공유 메모 — 파일이 있을 때만 경로 안내(없으면 침묵, 자동 생성 안 함).
  const notesPath = project ? path.join(project.path, ".loom", "notes.md") : null;
  const prompt = composePrompt({
    userPrompt: input.prompt,
    rules,
    // 기능 실행(git 커밋·분석)은 에이전트 개성 대신 기능 프롬프트 — 출력 일관성.
    agentPrompt: input.promptOverride ?? agent.prompt,
    loadout,
    projectNotesPath: notesPath && fs.existsSync(notesPath) ? notesPath : null,
  });
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
    workflow: input.workflow ?? null,
    node: input.node ?? null,
  };
  fs.mkdirSync(paths.logs, { recursive: true });
  // 투명성 — 실제로 CLI 에 들어간 합성 프롬프트를 영속(사용자 텍스트는 DB 에 따로).
  fs.writeFileSync(path.join(paths.logs, `${id}.prompt.txt`), prompt);
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
    loadoutDir: loadout.dir,
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

  // 위임 자식은 슬롯 우회 — 부모가 슬롯을 쥔 채 결과를 기다리므로(데드락 방지).
  const isDelegation = !!input.parentRunId && runs.get(input.parentRunId)?.info.status === "running";
  void run(state, adapter, adapterConfig, prompt, mcp, loadout, cwd, resumeSessionId, isDelegation);
  return { ok: true, run: info };
}

function emit(state: RunState, events: OfficeEvent[]): void {
  for (const ev of events) {
    state.events.push(ev);
    try {
      appendEvent(state.info.id, state.seq++, ev); // 순서 보존하며 디스크에 기록
    } catch (err) {
      // stdout 콜백 안에서 throw 되면 서버 전체가 죽는다. raw 로그가 진실이므로
      // DB 영속만 포기하고 인메모리 스트림(SSE)은 계속 살린다.
      if (!state.persistWarned) {
        state.persistWarned = true;
        logger.error({ err, runId: state.info.id }, "run event persist failed — continuing in-memory");
      }
    }
    if (ev.kind === "result") {
      state.sawResult = true;
      state.costUsd = ev.costUsd;
      state.sessionId = ev.sessionId;
    }
    // plain-text CLI(devin/antigravity)는 줄 단위 text 이벤트 — 누적해야 여러 줄
    // 출력(커밋 메시지 등)이 result 합성에서 잘리지 않는다.
    if (ev.kind === "text") state.lastText = state.lastText ? `${state.lastText}\n${ev.text}` : ev.text;
    for (const fn of state.listeners) {
      try {
        fn({ kind: "event", event: ev });
      } catch {
        // listener 오류가 스트림을 끊으면 안 됨
      }
    }
  }
}

/** raw 로그 쓰기 — 스트림 콜백 안이라 절대 throw 하면 안 된다(서버 다운).
 *  run 마감 후 도착한 늦은 출력은 fd 가 닫혔으니 버리고(최악엔 재사용된 fd 에
 *  교차 기록), 쓰기 실패(디스크 풀 등)는 raw 가 진실이므로 run 자체를 중단한다. */
function writeRaw(state: RunState, chunk: string): boolean {
  if (state.info.status !== "running") return false;
  try {
    fs.writeSync(state.rawFd, chunk);
    return true;
  } catch (err) {
    if (!state.persistWarned) {
      state.persistWarned = true;
      logger.error({ err, runId: state.info.id }, "raw log write failed — aborting run");
    }
    state.kill();
    state.abort.abort();
    return false;
  }
}

function consume(state: RunState, chunk: string): void {
  if (!writeRaw(state, chunk)) return;
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
  skipSlot: boolean,
): Promise<void> {
  const log = logger.child({ runId: state.info.id, agent: state.info.agent });
  if (!skipSlot) {
    await acquireSlot();
    // 대기 중 취소됐으면 spawn 없이 마감.
    if (state.abort.signal.aborted) {
      releaseSlot();
      concludeRun(state, "cancelled", null);
      return;
    }
  }
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
        // 위임 opt-in 의 일부 — delegate 도구는 권한 프롬프트 없이 호출돼야 한다.
        allowedTools: mcp.some((m) => m.name === "loom") ? ["mcp__loom__delegate"] : undefined,
        onStdout: (c) => consume(state, c),
        onStderr: (c) => void writeRaw(state, c),
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
  } finally {
    if (!skipSlot) releaseSlot();
  }
}

/** 서버 종료 시 — 실행 중 run 들을 즉시 kill 하고 cancelled 로 마감(좀비 방지). */
export function cancelAllRunning(): number {
  let n = 0;
  for (const state of runs.values()) {
    if (state.info.status !== "running") continue;
    state.abort.abort();
    state.kill();
    finish(state, "cancelled", null);
    n++;
  }
  return n;
}

// 종료 시퀀스: (1) 자동발화 워크플로우 평가 → 부모 버블에 handoff 이벤트(라이브+영속),
// (2) finish(=done 통지), (3) 워크플로우 시작(fire-and-forget). handoff 를 done
// 앞에 emit 하므로 라이브 구독자가 스트림 닫기 전에 핸드오프를 본다.
function concludeRun(state: RunState, status: RunInfo["status"], exitCode: number | null): void {
  const fired = evaluateFiredWorkflows(state, status);
  for (const wf of fired) {
    const entryAgent = wf.nodes.find((n) => n.id === wf.entry)?.agent ?? wf.entry;
    emit(state, [{ kind: "handoff", toAgent: entryAgent, via: "workflow", reason: wf.name }]);
  }
  finish(state, status, exitCode);
  spawnTriggeredWorkflows(state, fired);
}

// parentRunId 체인 깊이 — A→B→A 무한루프 방어. MAX 에 닿으면 발화 중단.
function chainHops(info: RunInfo): number {
  let hops = 0;
  let cur = info.parentRunId;
  while (cur && hops <= MAX_CHAIN_HOPS) {
    const parent = getRun(cur);
    if (!parent) break;
    hops++;
    cur = parent.parentRunId;
  }
  return hops;
}

function evaluateFiredWorkflows(state: RunState, status: RunInfo["status"]): import("@loom/core").WorkflowSpec[] {
  if (status === "cancelled") return []; // cancelled 는 발화 안 함
  try {
    const outcome: RunOutcome = {
      status,
      changedFileCount: state.events.filter((e) => e.kind === "file").length,
    };
    const fired = resolveAutoWorkflows(readWorkflows(), state.info.agent, outcome);
    if (fired.length === 0) return [];
    if (chainHops(state.info) >= MAX_CHAIN_HOPS) {
      logger.warn({ runId: state.info.id, max: MAX_CHAIN_HOPS }, "chain hop limit reached; not firing");
      return [];
    }
    return fired;
  } catch (err) {
    logger.error({ err, runId: state.info.id }, "workflow trigger eval failed");
    return [];
  }
}

// run 완료를 기다린다 — 위임(delegate)·커밋메시지 생성처럼 결과를 동기로 쓸 때.
export function waitForRun(id: string, timeoutMs: number): Promise<RunInfo> {
  return new Promise((resolve, reject) => {
    const sub = subscribe(id, (msg) => {
      if (msg.kind === "done") {
        clearTimeout(timer);
        sub?.off();
        resolve(msg.run as RunInfo);
      }
    });
    if (!sub) return reject(new Error("run_not_found"));
    if (sub.done) {
      sub.off();
      return resolve(sub.done);
    }
    const timer = setTimeout(() => {
      sub.off();
      reject(new Error("delegation_timeout"));
    }, timeoutMs);
  });
}

const DELEGATE_TIMEOUT_MS = 10 * 60_000;

// 위임 폭(breadth) 상한 — 깊이 가드(MAX_CHAIN_HOPS)는 병렬 tool call 이 한 번에
// 띄우는 자식 수를 못 막고, 위임 자식은 동시성 슬롯도 우회한다(데드락 방지 설계).
const MAX_CONCURRENT_DELEGATIONS = 3;
const delegationsInFlight = new Map<string, number>();

/** 에이전트 주도 위임 — run 도중 MCP delegate 도구가 호출. 자식 run 을 띄우고
 *  완료까지 기다려 결과 텍스트를 돌려준다. 부모의 프로젝트/스레드 상속,
 *  parentRunId 체인으로 hop 가드(무한 위임 방어). */
export async function delegateFromRun(
  parentRunId: string,
  toAgent: string,
  task: string,
  reason?: string,
): Promise<{ ok: true; result: string; childRunId: string } | { ok: false; error: string }> {
  const parent = runs.get(parentRunId);
  if (!parent) return { ok: false, error: "parent_run_not_found" };
  if (parent.info.agent === toAgent) return { ok: false, error: "cannot_delegate_to_self" };
  if (chainHops(parent.info) >= MAX_CHAIN_HOPS) {
    return { ok: false, error: `delegation depth limit (${MAX_CHAIN_HOPS}) reached` };
  }
  const inFlight = delegationsInFlight.get(parentRunId) ?? 0;
  if (inFlight >= MAX_CONCURRENT_DELEGATIONS) {
    return { ok: false, error: `concurrent delegation limit (${MAX_CONCURRENT_DELEGATIONS}) reached — wait for a delegation to finish` };
  }
  delegationsInFlight.set(parentRunId, inFlight + 1);

  try {
    // 부모 스트림에 위임 이벤트 — UI 가 "→ @x (위임)" 을 라이브로 그린다.
    emit(parent, [{ kind: "handoff", toAgent, via: "delegation", ...(reason ? { reason } : {}) }]);

    const started = await startRun({
      agent: toAgent,
      prompt: capText(task), // 거대 task 가 자식 프롬프트(토큰)를 집어삼키는 것 방지
      parentRunId,
      projectId: parent.info.projectId,
      threadId: parent.info.threadId,
    });
    if (!started.ok) return { ok: false, error: started.error };

    try {
      const done = await waitForRun(started.run.id, DELEGATE_TIMEOUT_MS);
      const events = runs.get(started.run.id)?.events ?? getRunEventsDb(started.run.id);
      const result = [...events].reverse().find(
        (e): e is Extract<OfficeEvent, { kind: "result" }> => e.kind === "result",
      );
      if (done.status !== "succeeded") {
        return { ok: false, error: `delegate run ${done.status}: ${result?.text?.slice(0, 500) ?? "no output"}` };
      }
      // 자식 출력은 신뢰 불가 — 부모에게 데이터 펜스로 돌려준다(워크플로우 핸드오프와 동일 정책).
      return { ok: true, result: fenceHandoff(result?.text ?? "(no output)"), childRunId: started.run.id };
    } catch (e) {
      // 타임아웃이면 자식이 아직 도는 중 — 끊지 않으면 부모 종료 후 고아가 된다.
      cancelRun(started.run.id);
      return { ok: false, error: (e as Error).message };
    }
  } finally {
    const n = (delegationsInFlight.get(parentRunId) ?? 1) - 1;
    if (n <= 0) delegationsInFlight.delete(parentRunId);
    else delegationsInFlight.set(parentRunId, n);
  }
}

// ask 트리거의 수동 발화 — 사용자가 UI 의 제안 버튼을 눌렀을 때. 완료된 run 의
// 결과를 입력으로 워크플로우를 시작한다(parentRunId 체인으로 연결).
export async function fireWorkflowFromRun(runId: string, workflowName: string): Promise<StartRunResult> {
  const run = getRun(runId);
  if (!run) return { ok: false, status: 404, error: "run_not_found" };
  if (run.status === "running") return { ok: false, status: 400, error: "run_still_running" };
  const wf = readWorkflows().find((w) => w.name === workflowName);
  if (!wf) return { ok: false, status: 404, error: "workflow_not_found" };

  // 결과 텍스트 — 인메모리에 있으면 거기서, 아니면 디스크 기록에서.
  const events = runs.get(runId)?.events ?? getRunEventsDb(runId);
  const last = [...events].reverse().find(
    (e): e is Extract<OfficeEvent, { kind: "result" }> => e.kind === "result",
  );
  return startWorkflow(wf, {
    input: last?.text ?? "",
    parentRunId: run.id,
    projectId: run.projectId,
    threadId: run.threadId,
  });
}

function spawnTriggeredWorkflows(state: RunState, fired: import("@loom/core").WorkflowSpec[]): void {
  if (fired.length === 0) return;
  const log = logger.child({ runId: state.info.id, agent: state.info.agent });
  const last = [...state.events].reverse().find(
    (e): e is Extract<OfficeEvent, { kind: "result" }> => e.kind === "result",
  );
  const resultText = last?.text ?? state.lastText ?? "";
  for (const wf of fired) {
    void startWorkflow(wf, {
      input: resultText,
      parentRunId: state.info.id,
      projectId: state.info.projectId,
      threadId: state.info.threadId,
    })
      .then((r) => {
        if (!r.ok) log.warn({ workflow: wf.name, error: r.error }, "triggered workflow did not start");
      })
      .catch((err) => log.error({ err, workflow: wf.name }, "triggered workflow threw"));
  }
}

// 완료 run 을 인메모리에 들고 있는 유예 — 직후의 SSE 재구독/위임 결과 조회는
// 메모리에서, 그 뒤는 디스크 기록(getPersistedRun 폴백)이 답한다. 무한 보유 시
// 장기 운영에서 events 가 누적돼 메모리가 자란다.
const EVICT_AFTER_MS = 5 * 60_000;

function finish(state: RunState, status: RunInfo["status"], exitCode: number | null): void {
  // 재진입 가드 — cancelAllRunning(서버 종료)과 비동기 concludeRun 이 같은 state 에
  // 둘 다 도달할 수 있다. 두 번째 호출은 DB 중복 UPDATE·done 중복 발송만 만든다.
  if (state.info.status !== "running") return;
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
  if (state.loadoutDir) {
    try {
      fs.rmSync(state.loadoutDir, { recursive: true, force: true });
    } catch {
      // 정리 실패는 무해 — 부팅 시 loadouts 전체 청소가 잔재를 거둔다
    }
  }
  for (const fn of state.listeners) {
    try {
      fn({ kind: "done", run: state.info });
    } catch {
      // ignore
    }
  }
  const evict = setTimeout(() => {
    // deleteRun 이 먼저 지웠거나 같은 id 로 다른 상태가 들어섰으면 건드리지 않는다.
    if (runs.get(state.info.id) === state && state.info.status !== "running") {
      runs.delete(state.info.id);
    }
  }, EVICT_AFTER_MS);
  evict.unref?.();
}
