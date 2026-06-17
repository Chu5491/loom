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
import { gitFilesTouchedSince } from "./git-changes.js";
import { analysisDocPath, notesPath } from "./project-memory.js";
import { materializeLoadout } from "./loadout.js";
import { clearRunPid, recordRunPid } from "./orphans.js";
import { ensureDiskSpace } from "./disk.js";
import { parseLine } from "./parse.js";
import { estimateCost } from "./pricing.js";
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
  agent?: string; // office agent name (fn 이면 생략)
  /** 기능 실행 — office 에이전트 대신 기능(adapter+model)으로 ad-hoc. rules/skills/mcp·
   *  위임·resume 없음(자동주입 0). promptOverride 가 지침. info.agent = "fn:<name>". */
  fn?: { name: string; adapter: string; model?: string };
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
  /** CLI 가 비용을 직접 보고했나(claude result, opencode step). false 면 토큰으로 추정. */
  costReported?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  /** 비용 추정용 모델 id — run() 이 adapterConfig 에서 채운다. */
  model?: string;
  sessionId?: string;
  abort: AbortController;
  kill: () => void;
  /** 어댑터별 세션 id 추출기 — CLI 마다 포맷이 달라(claude system, codex
   *  thread.started, opencode sessionID 등) 어댑터에 위임한다. 다음 턴 resume 의 근거. */
  extractSession?: (chunk: string) => string | null;
  /** run 스코프 loadout 디렉토리 — finish 가 정리한다. */
  loadoutDir?: string;
  /** 영속 실패 로그 1회 가드 — ENOSPC 류는 줄마다 반복돼 로그를 범람시킨다. */
  persistWarned?: boolean;
  /** stderr 끝부분(상한) — 실패 시 사유로 표면화(불투명한 "run failed" 방지). */
  stderrTail?: string;
  /** raw 로그 누적 바이트 — 상한 초과 시 절단(폭주 CLI 의 디스크 범람 방어). */
  rawBytes?: number;
}

// run 안전 가드(전 CLI 공통):
//  - 월-클록 타임아웃: 멈춘 run 을 자동 종료(0=비활성). antigravity 외 CLI 엔 자체
//    타임아웃이 없어 hang 시 좀비로 남던 갭.
//  - raw 로그 상한: 폭주 CLI 가 디스크를 채우는 것 방어.
//  - stderr tail 상한: 실패 사유로 보여줄 만큼만.
const RUN_TIMEOUT_MS = Number(process.env.LOOM_RUN_TIMEOUT_MS ?? 30 * 60_000);
const MAX_RAW_BYTES = Number(process.env.LOOM_MAX_RAW_BYTES ?? 50 * 1024 * 1024);
const STDERR_TAIL_MAX = 2000;

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

/** run 의 디스크 산물(raw 로그 + 합성 프롬프트) 삭제 — DB 행 삭제가 남기던
 *  고아 파일 정리. id 검증은 호출자 책임이나 UUID 가드로 traversal 방지. */
export function deleteRunFiles(id: string): void {
  if (!UUID_RE.test(id)) return;
  for (const ext of [".log", ".prompt.txt"]) {
    try {
      fs.rmSync(path.join(paths.logs, `${id}${ext}`), { force: true });
    } catch {
      // 없거나 권한 문제 — 정리 실패는 무해
    }
  }
}

/** 부팅 prune — DB 에 더는 없는 run 의 로그 파일을 거둔다. run 삭제 경로가
 *  파일을 안 지우던 시절 누적분 + 크래시 잔재. */
export function pruneOrphanLogs(): number {
  let removed = 0;
  let files: string[];
  try {
    files = fs.readdirSync(paths.logs);
  } catch {
    return 0; // logs 디렉토리 아직 없음
  }
  const seen = new Set<string>();
  for (const f of files) {
    const id = f.replace(/\.(log|prompt\.txt)$/, "");
    if (id === f || seen.has(id)) continue;
    seen.add(id);
    if (!getRunDb(id)) {
      deleteRunFiles(id);
      removed++;
    }
  }
  return removed;
}

// 기록 삭제 — running 은 거부(먼저 취소). 인메모리 상태 + 디스크 산물도 같이 비운다.
export function deleteRun(id: string): { ok: true } | { ok: false; status: 404 | 409; error: string } {
  const info = getRun(id);
  if (!info) return { ok: false, status: 404, error: "not_found" };
  if (info.status === "running") return { ok: false, status: 409, error: "still_running" };
  runs.delete(id);
  deleteRunDb(id);
  deleteRunFiles(id);
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
  // 기능 실행은 임시(ephemeral) 에이전트 — office 에 없는 adapter+model 만의 스펙.
  // rules/skills/mcp 비움 = 자동주입 0(헌법). delegate/resume/페르소나 없음.
  const agent: AgentSpec | undefined = input.fn
    ? { name: `fn:${input.fn.name}`, adapter: input.fn.adapter as AgentSpec["adapter"], ...(input.fn.model ? { model: input.fn.model } : {}), prompt: "", rules: [], skills: [], mcp: [] }
    : readAgents().find((a) => a.name === input.agent);
  if (!agent) return { ok: false, status: 404, error: "agent_not_found" };
  const adapter = getAdapter(agent.adapter);
  if (!adapter) return { ok: false, status: 400, error: `adapter_not_registered: ${agent.adapter}` };

  // 월 예산 가드 — 초과 시 새 run 거부(이미 도는 run 은 끝까지). office/budget.json.
  // 시작 전 차단만으로는 한 run 이 도중에 예산을 넘겨버릴 수 있다 → 남은 예산을
  // budgetRemaining 으로 모아, 지원하는 어댑터(claude --max-budget-usd)에 run 단위
  // 하드캡으로 넘긴다(가장 빡빡한 cap 기준).
  const budget = readBudget();
  let budgetRemaining: number | undefined;
  if (budget.monthlyUsd != null) {
    const spent = monthCostUsd();
    if (spent >= budget.monthlyUsd) {
      return { ok: false, status: 400, error: `budget_exceeded: $${spent.toFixed(2)} / $${budget.monthlyUsd} this month` };
    }
    budgetRemaining = budget.monthlyUsd - spent;
  }
  const agentCap = budget.perAgent[agent.name];
  if (agentCap != null) {
    const spent = monthCostUsd(agent.name);
    if (spent >= agentCap) {
      return { ok: false, status: 400, error: `agent_budget_exceeded: @${agent.name} $${spent.toFixed(2)} / $${agentCap} this month` };
    }
    const agentRemaining = agentCap - spent;
    budgetRemaining = budgetRemaining == null ? agentRemaining : Math.min(budgetRemaining, agentRemaining);
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

  // 디스크 여유 가드 — 꽉 찬 채 시작하면 raw 로그 쓰기 실패로 run 이 죽고 이벤트를
  // 잃는다. 시작 전에 명확히 거부한다(LOOM_MIN_FREE_MB, 0=비활성).
  const disk = await ensureDiskSpace();
  if (!disk.ok) {
    return {
      ok: false,
      status: 400,
      error: `disk_low: data 볼륨 여유 ${disk.freeMb}MB (최소 ${config.minFreeMb}MB 필요) — 공간을 비우거나 LOOM_MIN_FREE_MB 를 낮추세요`,
    };
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
  // 프로젝트 공유 기억 — 노트·분석 모두 파일이 있을 때만 경로 안내(없으면 침묵,
  // 자동 생성 안 함). 분석 뷰는 다른 CLI 도구가 만든 이해를 이어 읽는 통로.
  const notes = project ? notesPath(project.path) : null;
  const analysisDoc = project ? analysisDocPath(project.path) : null;
  const prompt = composePrompt({
    userPrompt: input.prompt,
    rules,
    // 기능 실행(git 커밋·분석)은 에이전트 개성 대신 기능 프롬프트 — 출력 일관성.
    agentPrompt: input.promptOverride ?? agent.prompt,
    loadout,
    projectNotesPath: notes && fs.existsSync(notes) ? notes : null,
    projectAnalysisPath: analysisDoc && fs.existsSync(analysisDoc) ? analysisDoc : null,
    // 이어가는 턴이면 rules·페르소나 재주입 생략 — 매 턴 자기소개 반복 방지.
    resuming: !!resumeSessionId,
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
    model: agent.model,
  };
  runs.set(id, state);
  insertRun(info); // history 영속 — running 상태로 즉시 기록(finish 가 갱신).

  // 이 run 의 loadout(스킬·MCP·위임)을 첫 이벤트로 — 모든 CLI 공통. 평문 CLI 는
  // 도구 호출을 스트림에서 못 뽑으니, "무엇이 실렸나"라도 UI 에 보여준다.
  if (loadout.skills.length || loadout.mcpServerNames.length || loadout.delegate) {
    emit(state, [{
      kind: "loadout",
      skills: loadout.skills.map((s) => s.name),
      mcp: loadout.mcpServerNames,
      delegate: !!loadout.delegate,
    }]);
  }

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
    // 남은 월 예산을 run 하드캡으로 — claude(--max-budget-usd)가 읽어 도중 초과를 막는다.
    ...(budgetRemaining != null ? { maxBudgetUsd: budgetRemaining } : {}),
    // 스레드(대화)가 아니면 다음 턴 resume 가 없다 → 세션을 안 남긴다(codex --ephemeral).
    // 기능·워크플로우 run 의 세션 누적 방지(지원 어댑터만 읽음).
    ...(input.threadId ? {} : { ephemeral: true }),
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
      // claude 는 result 에 total_cost_usd 를 직접 준다(보고된 비용).
      if (ev.costUsd != null) { state.costUsd = ev.costUsd; state.costReported = true; }
      // result 이벤트의 sessionId 가 있을 때만 갱신 — 없으면(codex 합성 result 등)
      // captureSession 이 stream 에서 이미 잡아둔 값을 덮어쓰지 않는다.
      if (ev.sessionId) state.sessionId = ev.sessionId;
    }
    if (ev.kind === "usage") {
      // 토큰 누적(codex/opencode 는 스텝마다 보고). cost 가 있으면(opencode) 합산.
      if (ev.inputTokens != null) state.inputTokens = (state.inputTokens ?? 0) + ev.inputTokens;
      if (ev.outputTokens != null) state.outputTokens = (state.outputTokens ?? 0) + ev.outputTokens;
      if (ev.costUsd != null) { state.costUsd = (state.costUsd ?? 0) + ev.costUsd; state.costReported = true; }
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
  // raw 로그 상한 — 폭주 CLI 가 디스크를 채우지 않게. 상한 넘으면 로그만 멈추고
  // run 은 계속(파싱·결과는 stdout 콜백이 이미 처리). 넘는 순간 1회 표시.
  const prev = state.rawBytes ?? 0;
  if (prev >= MAX_RAW_BYTES) return true;
  state.rawBytes = prev + Buffer.byteLength(chunk);
  try {
    fs.writeSync(state.rawFd, chunk);
    if (state.rawBytes >= MAX_RAW_BYTES) {
      fs.writeSync(state.rawFd, `\n…[loom: raw output capped at ${Math.round(MAX_RAW_BYTES / 1024 / 1024)}MB]\n`);
    }
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

/** 완성된 라인에서 세션 id 를 잡는다 — 부분 라인은 서버 buf 가 이미 이어붙였다.
 *  한 번 잡으면 멈춘다(세션은 run 중 안 바뀜). claude 는 result 이벤트로도 잡히나
 *  중복 갱신은 같은 값이라 무해. */
function captureSession(state: RunState, line: string): void {
  if (state.sessionId || !state.extractSession) return;
  const sid = state.extractSession(line);
  if (sid) state.sessionId = sid;
}

function consume(state: RunState, chunk: string): void {
  if (!writeRaw(state, chunk)) return;
  state.buf += chunk;
  const lines = state.buf.split("\n");
  state.buf = lines.pop() ?? "";
  for (const line of lines) {
    captureSession(state, line);
    emit(state, parseLine(line));
  }
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
  state.extractSession = adapter.extractSessionId?.bind(adapter);
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
  // 평문 CLI(antigravity/devin)의 디스크 세션 캡처 기준점 — 이 run 이 만진
  // 대화를 직전 잔재와 구분하려고 spawn 직전에 찍는다.
  const sessionSince = Date.now();
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
        // stderr 는 raw 로그에 + 끝부분을 따로 보관(실패 시 사유로 표면화).
        onStderr: (c) => { state.stderrTail = ((state.stderrTail ?? "") + c).slice(-STDERR_TAIL_MAX); writeRaw(state, c); },
      },
      adapterConfig,
    );
    state.kill = handle.kill;
    // 그룹 pid 기록 — 하드 크래시(서버 SIGKILL) 후 부팅 시 이 자식을 회수한다.
    recordRunPid(state.info.id, handle.pid);
    // 전역 월-클록 타임아웃 — 멈춘 run 을 자동 종료(전 CLI 공통 안전망; 0=비활성).
    // antigravity 외 CLI 엔 자체 타임아웃이 없어 hang 시 좀비로 남던 갭을 메운다.
    let timedOut = false;
    const killTimer =
      RUN_TIMEOUT_MS > 0
        ? setTimeout(() => {
            timedOut = true;
            log.warn({ timeoutMs: RUN_TIMEOUT_MS }, "run timed out — killing");
            state.kill();
            state.abort.abort();
          }, RUN_TIMEOUT_MS)
        : null;
    let exitCode: number | null = null;
    try {
      ({ exitCode } = await handle.promise);
    } finally {
      if (killTimer) clearTimeout(killTimer);
    }

    if (state.buf.trim()) {
      captureSession(state, state.buf);
      emit(state, parseLine(state.buf));
    }
    state.buf = "";

    // 최종 result 이벤트가 없었으면(예: devin plain text) 누적 텍스트로 합성.
    if (!state.sawResult && state.lastText) {
      emit(state, [{ kind: "result", text: state.lastText }]);
    }

    // 평문 CLI 는 출력에 세션 id 가 없다 — CLI 자신의 디스크 저장소에서 되찾아
    // 다음 턴 resume 의 근거를 만든다(스트림에서 못 잡았을 때만, 성공 run 만).
    if (!state.sessionId && !state.abort.signal.aborted && exitCode === 0 && adapter.captureSessionFromDisk) {
      try {
        const sid = await adapter.captureSessionFromDisk({ cwd, since: sessionSince }, adapterConfig);
        if (sid) state.sessionId = sid;
      } catch (err) {
        log.warn({ err }, "disk session capture failed");
      }
    }

    // 평문 CLI(devin)는 stdout 에 비용·토큰·도구가 없다 — CLI export 에서 활동을
    // 되찾는다. 토큰은 아래 estimateCost 로 비용 추정, 도구는 활동 카드/작업 상세에
    // 채운다(stream-json CLI 처럼 "무슨 도구를 썼나"). 스트림이 못 준 것만 보강.
    if (exitCode === 0 && !state.abort.signal.aborted && adapter.captureActivityFromDisk) {
      try {
        const act = await adapter.captureActivityFromDisk({ cwd, since: sessionSince }, adapterConfig);
        if (!state.costReported) {
          if (act?.inputTokens != null) state.inputTokens = (state.inputTokens ?? 0) + act.inputTokens;
          if (act?.outputTokens != null) state.outputTokens = (state.outputTokens ?? 0) + act.outputTokens;
        }
        if (act?.tools?.length && !state.events.some((e) => e.kind === "tool")) {
          emit(state, act.tools.map((t) => ({ kind: "tool", name: t.name, ...(t.target ? { target: t.target } : {}) })));
        }
      } catch (err) {
        log.warn({ err }, "disk activity capture failed");
      }
    }

    // stream 으로 파일 편집을 못 잡은 run(평문 CLI 등)은 git 작업트리에서 변경
    // 파일을 되찾아 귀속한다 — 파일 탭의 "누가 뭘 고쳤나"가 전 CLI 에서 채워진다.
    if (exitCode === 0 && !state.abort.signal.aborted && !state.events.some((e) => e.kind === "file")) {
      try {
        const touched = gitFilesTouchedSince(cwd, sessionSince);
        if (touched.length) emit(state, touched.map((f) => ({ kind: "file", path: f.path, action: f.action })));
      } catch (err) {
        log.warn({ err }, "git file capture failed");
      }
    }

    // 타임아웃은 abort 를 거치지만 사용자 취소가 아니라 실패로 본다.
    const status = timedOut ? "failed" : state.abort.signal.aborted ? "cancelled" : exitCode === 0 ? "succeeded" : "failed";
    // 실패인데 명시적 에러 이벤트가 없으면 stderr 끝부분(또는 타임아웃)을 사유로 —
    // 불투명한 "run failed" 대신 진짜 원인을 보여준다(전 CLI 공통).
    if (status === "failed" && !state.events.some((e) => e.kind === "error")) {
      const reason = timedOut
        ? `timed out after ${Math.round(RUN_TIMEOUT_MS / 60_000)}m`
        : state.stderrTail?.trim() || (exitCode != null ? `exited with code ${exitCode}` : "run failed");
      emit(state, [{ kind: "error", message: reason.slice(0, STDERR_TAIL_MAX) }]);
    }
    concludeRun(state, status, exitCode);
    log.info({ exitCode, timedOut }, "run done");
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
  // CLI 가 비용을 안 줬는데(codex) 토큰은 있으면 모델 단가로 추정 — 예산 가드가
  // claude 외 CLI 에서도 의미를 갖게. opencode 는 cost 를 직접 주므로 추정 안 함.
  if (!state.costReported && (state.inputTokens || state.outputTokens)) {
    state.costUsd = estimateCost(state.model, state.inputTokens, state.outputTokens) ?? state.costUsd;
  }
  // 추정 = CLI 가 실값을 안 줬는데 우리가 토큰으로 채운 경우(codex·devin). UI 가 "~" 표시.
  const costEstimated = !state.costReported && state.costUsd != null;
  state.info.costUsd = state.costUsd ?? null;
  state.info.costEstimated = costEstimated;
  finishRun(state.info, { costUsd: state.costUsd, sessionId: state.sessionId, costEstimated });
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
  // 정상 종료 — pidfile 제거(부팅 시 헛된 회수 kill 방지).
  clearRunPid(state.info.id);
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
