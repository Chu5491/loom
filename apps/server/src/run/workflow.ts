// 워크플로우 실행기 — office/workflows/<name>.json 그래프를 따라 노드를 실행.
// 시작: 수동(사용자 버튼) 또는 트리거(에이전트 run 종료 시 auto/ask — 옛 하네스 흡수).
// 각 스텝 = 보통 run, parentRunId 체인으로 묶여 Talk 에 핸드오프 버블로 보인다.

import { randomUUID } from "node:crypto";
import type { RunInfo, RunStatus, WorkflowGate, WorkflowSpec, WorkflowTrigger } from "@loom/core";
import { getRunEventsDb } from "../db.js";
import { logger } from "../logger.js";
import { startRun, waitForRun, type StartRunResult } from "./engine.js";

export const MAX_WORKFLOW_STEPS = 20;
const STEP_TIMEOUT_MS = 10 * 60_000;

// ── 트리거 판정 (순수) — run 이 끝났을 때 어떤 워크플로우가 발화하는지 ─────────
export interface RunOutcome {
  status: RunStatus;
  /** 이 run 이 만든 file 이벤트 수 — on:"changes" 판정용. */
  changedFileCount: number;
}

/** cancelled 는 어떤 트리거에도 발화하지 않는다. */
export function triggerMatches(trigger: WorkflowTrigger, outcome: RunOutcome): boolean {
  switch (trigger.on) {
    case "success":
      return outcome.status === "succeeded";
    case "fail":
      return outcome.status === "failed";
    case "changes":
      return outcome.status === "succeeded" && outcome.changedFileCount > 0;
  }
}

/** 자동 발화 대상 — mode==="auto" + 트리거 일치. ask 는 UI 가 제안만. */
export function resolveAutoWorkflows(workflows: WorkflowSpec[], agent: string, outcome: RunOutcome): WorkflowSpec[] {
  return workflows.filter(
    (w) => w.trigger && w.trigger.mode === "auto" && w.trigger.agent === agent && triggerMatches(w.trigger, outcome),
  );
}

/** 순수 — from 노드가 outcome 으로 끝났을 때 따라갈 다음 노드 id 들. */
export function nextNodeIds(wf: WorkflowSpec, from: string, outcome: "success" | "fail"): string[] {
  return wf.edges
    .filter((e) => e.from === from && (e.on === "always" || e.on === outcome))
    .map((e) => e.to);
}

/** 순수 — 스텝 프롬프트 치환. {{input}}=실행 입력, {{result}}=직전 스텝 결과.
 *  자동주입 아님: 사용자가 정의에 직접 적은 자리에만 들어간다. */
export function renderStepPrompt(template: string, input: string, result: string | null): string {
  return template.replaceAll("{{input}}", input).replaceAll("{{result}}", result ?? "");
}

export interface WorkflowRunInput {
  input: string;
  projectId?: string | null;
  threadId?: string | null;
  /** 트리거 발화면 발화시킨 run — 체인 깊이 가드 + UI 연결선의 근거. */
  parentRunId?: string | null;
}

// ── 실행 컨텍스트 — 한 번의 워크플로우 실행(체인)을 관통하는 상태 ────────────────
interface Exec {
  wf: WorkflowSpec;
  runInput: WorkflowRunInput;
  counter: { steps: number };
  /** 체인 식별자(= entry run id) — join 도착분과 게이트가 이 키로 묶인다. */
  chainId: string;
}

// 휴먼 게이트 — 인메모리(서버 재시작 시 소실, v1 한계). 승인=success/거부=fail 경로.
interface PendingGate extends WorkflowGate {
  exec: Exec;
}
const gates = new Map<string, PendingGate>();

export function listGates(threadId?: string | null): WorkflowGate[] {
  const all = [...gates.values()].map(({ exec: _e, ...g }) => g);
  return threadId === undefined ? all : all.filter((g) => g.threadId === threadId);
}

export async function resolveGate(id: string, approved: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = gates.get(id);
  if (!gate) return { ok: false, error: "gate_not_found" };
  gates.delete(id);
  await fanOut(gate.exec, gate.nodeId, approved ? "success" : "fail", gate.result, gate.prevRunId);
  return { ok: true };
}

// 병렬 join — 들어오는 엣지가 2개 이상인 노드는 모든 분기가 도착해야 실행.
// 키 = chainId:nodeId. 한계: 도착하지 않는 분기(실패로 끊김)가 있으면 join 은 영원히 대기.
const joinArrivals = new Map<string, { results: string[]; lastRunId: string | null }>();

/** entry 노드를 시작하고 첫 run 을 즉시 반환 — 나머지 스텝은 비동기로 이어진다. */
export async function startWorkflow(wf: WorkflowSpec, runInput: WorkflowRunInput): Promise<StartRunResult> {
  const entry = wf.nodes.find((n) => n.id === wf.entry);
  if (!entry) return { ok: false, status: 400, error: "entry_node_not_found" };
  if (entry.kind === "gate") return { ok: false, status: 400, error: "entry_cannot_be_gate" };
  const first = await startRun({
    agent: entry.agent,
    prompt: renderStepPrompt(entry.prompt, runInput.input, runInput.input || null),
    projectId: runInput.projectId,
    threadId: runInput.threadId,
    parentRunId: runInput.parentRunId,
    workflow: wf.name,
    node: entry.id,
  });
  if (!first.ok) return first;
  const exec: Exec = { wf, runInput, counter: { steps: 1 }, chainId: first.run.id };
  void watchRun(exec, entry.id, first.run);
  return first;
}

function lastResultText(runId: string): string | null {
  const events = getRunEventsDb(runId);
  const result = [...events].reverse().find((e) => e.kind === "result");
  return result && "text" in result ? result.text : null;
}

// run 완료를 기다렸다가 outcome 에 맞는 다음 노드들로 퍼져나간다.
async function watchRun(exec: Exec, nodeId: string, run: RunInfo): Promise<void> {
  const log = logger.child({ workflow: exec.wf.name, node: nodeId, runId: run.id });
  try {
    const done = await waitForRun(run.id, STEP_TIMEOUT_MS);
    if (done.status === "cancelled") return; // 사용자가 멈춤 — 그래프 진행도 멈춘다
    const outcome = done.status === "succeeded" ? "success" : "fail";
    await fanOut(exec, nodeId, outcome, lastResultText(run.id) ?? "", run.id);
  } catch (err) {
    log.error({ err }, "workflow step threw");
  }
}

// outcome 에 맞는 다음 노드들 진입 — run 완료와 게이트 승인 양쪽에서 호출된다.
async function fanOut(exec: Exec, fromNodeId: string, outcome: "success" | "fail", result: string, prevRunId: string | null): Promise<void> {
  for (const nid of nextNodeIds(exec.wf, fromNodeId, outcome)) {
    await enterNode(exec, nid, result, prevRunId);
  }
}

// 노드 진입 — join 대기 → 게이트 정지 → 에이전트 run 순으로 분기.
async function enterNode(exec: Exec, nodeId: string, result: string, prevRunId: string | null): Promise<void> {
  const log = logger.child({ workflow: exec.wf.name, node: nodeId, chain: exec.chainId.slice(0, 8) });
  const node = exec.wf.nodes.find((n) => n.id === nodeId);
  if (!node) {
    log.warn("workflow edge points to missing node");
    return;
  }

  // join — 들어오는 엣지 수만큼 도착해야 진행. 결과는 구분선으로 합쳐 {{result}} 에.
  const incoming = exec.wf.edges.filter((e) => e.to === nodeId).length;
  let joinedResult = result;
  if (incoming > 1) {
    const key = `${exec.chainId}:${nodeId}`;
    const arrival = joinArrivals.get(key) ?? { results: [], lastRunId: null };
    arrival.results.push(result);
    arrival.lastRunId = prevRunId ?? arrival.lastRunId;
    joinArrivals.set(key, arrival);
    if (arrival.results.length < incoming) {
      log.info({ arrived: arrival.results.length, incoming }, "join waiting for branches");
      return;
    }
    joinArrivals.delete(key);
    joinedResult = arrival.results.join("\n\n---\n\n");
    prevRunId = arrival.lastRunId;
  }

  if (exec.counter.steps >= MAX_WORKFLOW_STEPS) {
    log.warn({ max: MAX_WORKFLOW_STEPS }, "workflow step limit reached; stopping");
    return;
  }

  // 휴먼 게이트 — 사람이 승인/거부할 때까지 정지(스텝으로 계산).
  if (node.kind === "gate") {
    exec.counter.steps++;
    const gate: PendingGate = {
      id: randomUUID(),
      workflow: exec.wf.name,
      nodeId,
      prevRunId,
      projectId: exec.runInput.projectId ?? null,
      threadId: exec.runInput.threadId ?? null,
      result: joinedResult,
      createdAt: new Date().toISOString(),
      exec,
    };
    gates.set(gate.id, gate);
    log.info({ gateId: gate.id }, "workflow paused at human gate");
    return;
  }

  exec.counter.steps++;
  const started = await startRun({
    agent: node.agent,
    prompt: renderStepPrompt(node.prompt, exec.runInput.input, joinedResult),
    parentRunId: prevRunId,
    projectId: exec.runInput.projectId,
    threadId: exec.runInput.threadId,
    workflow: exec.wf.name,
    node: nodeId,
  });
  if (!started.ok) {
    log.warn({ error: started.error }, "workflow step did not start");
    return;
  }
  void watchRun(exec, nodeId, started.run);
}
