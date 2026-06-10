// 런 엔진 — office 에이전트를 spawn 하고, raw 를 디스크에 보존하면서
// parseEvents 로 OfficeEvent 를 만들어 구독자(SSE)에게 푸시한다.
// P2: 영속은 raw 로그(data/logs) + 인메모리 run 맵. (sqlite 기록은 P2b.)

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AdapterConfig, McpServer, OfficeEvent, RunInfo } from "@loom/core";
import { getAdapter } from "../adapters/registry.js";
import { config, paths } from "../config.js";
import { appendEvent, finishRun, getRunDb, getRunEventsDb, insertRun, listRunsDb } from "../db.js";
import { logger } from "../logger.js";
import {
  readAgents,
  readMcp,
  readRules,
  readSkills,
} from "../office.js";
import { composePrompt } from "./compose.js";
import { materializeLoadout } from "./loadout.js";
import { parseLine } from "./parse.js";

export interface StartRunInput {
  agent: string; // office agent name
  prompt: string;
  cwd?: string;
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
export function listRuns(): RunInfo[] {
  return listRunsDb();
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

  // office 에서 이 에이전트가 끌어올 rules·skills·mcp 만 추린다.
  const allRules = readRules();
  const allSkills = readSkills();
  const allMcp = readMcp();
  const rules = (agent.rules ?? []).map((n) => allRules.find((r) => r.name === n)).filter(Boolean).map((r) => r!.body);
  const skills = (agent.skills ?? []).map((n) => allSkills.find((s) => s.name === n)).filter(Boolean).map((s) => s!);
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

  void run(state, adapter, adapterConfig, prompt, mcp, loadout, input.cwd ?? config.home);
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
): Promise<void> {
  const log = logger.child({ runId: state.info.id, agent: state.info.agent });
  log.info({ cwd }, "run start");
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

    finish(state, state.abort.signal.aborted ? "cancelled" : exitCode === 0 ? "succeeded" : "failed", exitCode);
    log.info({ exitCode }, "run done");
  } catch (err) {
    emit(state, [{ kind: "error", message: (err as Error).message }]);
    finish(state, "failed", null);
    log.error({ err }, "run threw");
  }
}

function finish(state: RunState, status: RunInfo["status"], exitCode: number | null): void {
  state.info.status = status;
  state.info.exitCode = exitCode;
  state.info.endedAt = new Date().toISOString();
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
