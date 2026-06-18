// 워크플로우 자동 발화 선택 — 순수 함수. run 종료 결과(outcome)로 어떤 워크플로우가
// 자동으로 이어질지 결정한다. (engine 이 매 run 종료 후 호출)

import { describe, it, expect } from "vitest";
import { triggerMatches, resolveAutoWorkflows, type RunOutcome } from "../src/run/workflow.js";
import type { WorkflowSpec, WorkflowTrigger } from "@loom/core";

function outcome(o: Partial<RunOutcome> = {}): RunOutcome {
  return { status: "succeeded", changedFileCount: 0, ...o } as RunOutcome;
}
function trig(on: WorkflowTrigger["on"], mode: WorkflowTrigger["mode"] = "auto", agent = "Coder"): WorkflowTrigger {
  return { agent, on, mode };
}
function wf(name: string, trigger: WorkflowTrigger | null): WorkflowSpec {
  return { name, entry: "n1", nodes: [], edges: [], trigger };
}

describe("triggerMatches", () => {
  it("on:success — 성공한 run 만 매치", () => {
    expect(triggerMatches(trig("success"), outcome({ status: "succeeded" }))).toBe(true);
    expect(triggerMatches(trig("success"), outcome({ status: "failed" }))).toBe(false);
  });

  it("on:fail — 실패한 run 만 매치", () => {
    expect(triggerMatches(trig("fail"), outcome({ status: "failed" }))).toBe(true);
    expect(triggerMatches(trig("fail"), outcome({ status: "succeeded" }))).toBe(false);
  });

  it("on:changes — 성공 + 변경 파일이 있을 때만", () => {
    expect(triggerMatches(trig("changes"), outcome({ status: "succeeded", changedFileCount: 2 }))).toBe(true);
    expect(triggerMatches(trig("changes"), outcome({ status: "succeeded", changedFileCount: 0 }))).toBe(false);
    expect(triggerMatches(trig("changes"), outcome({ status: "failed", changedFileCount: 5 }))).toBe(false);
  });
});

describe("resolveAutoWorkflows", () => {
  it("auto 모드 + agent 일치 + 트리거 매치만 선택", () => {
    const list = [
      wf("a", trig("success", "auto", "Coder")), // ✓
      wf("b", trig("success", "ask", "Coder")), // ask → 제외(수동 제안)
      wf("c", trig("success", "auto", "Other")), // 다른 agent → 제외
      wf("d", trig("fail", "auto", "Coder")), // 트리거 불일치 → 제외
      wf("e", null), // 트리거 없음 → 제외
    ];
    const fired = resolveAutoWorkflows(list, "Coder", outcome({ status: "succeeded" }));
    expect(fired.map((w) => w.name)).toEqual(["a"]);
  });

  it("매치 없으면 빈 배열", () => {
    const list = [wf("x", trig("fail", "auto", "Coder"))];
    expect(resolveAutoWorkflows(list, "Coder", outcome({ status: "succeeded" }))).toEqual([]);
  });
});
