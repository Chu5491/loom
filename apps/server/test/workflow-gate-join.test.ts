// 게이트·join 실행 경로 — 승인/거부가 올바른 엣지로 가는지, join 이 모든 분기를
// 기다렸다 결과를 합치는지. engine·db 는 모킹(실제 spawn/sqlite 없음).

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunInfo, WorkflowSpec } from "@loom/core";

vi.mock("../src/run/engine.js", () => ({
  startRun: vi.fn(),
  waitForRun: vi.fn(),
  cancelRun: vi.fn(),
}));
vi.mock("../src/db.js", () => ({
  deleteGateDb: vi.fn(),
  deleteJoinArrivalsDb: vi.fn(),
  getRunEventsDb: vi.fn(() => []),
  insertGateDb: vi.fn(),
  insertJoinArrivalDb: vi.fn(),
  listGatesDb: vi.fn(() => []),
  listJoinArrivalsDb: vi.fn(() => []),
}));
vi.mock("../src/office.js", () => ({
  readWorkflows: vi.fn(() => []),
}));

import { startRun as startRunFn, waitForRun as waitForRunFn } from "../src/run/engine.js";
import { getRunEventsDb as getRunEventsDbFn, insertGateDb as insertGateDbFn } from "../src/db.js";
import { listGates, resolveGate, startWorkflow } from "../src/run/workflow.js";

const mockStartRun = vi.mocked(startRunFn);
const mockWaitForRun = vi.mocked(waitForRunFn);
const mockGetEvents = vi.mocked(getRunEventsDbFn);
const mockInsertGate = vi.mocked(insertGateDbFn);

let seq = 0;
function runInfo(id: string, status: RunInfo["status"] = "running"): RunInfo {
  return {
    id, agent: "a", prompt: "p", status, startedAt: `2026-06-12T00:00:0${seq++ % 10}.000Z`,
    endedAt: null, exitCode: null, parentRunId: null, projectId: null, threadId: null,
    costUsd: null, workflow: "wf", node: null,
  };
}

// startRun 은 노드별 run id 를, waitForRun 은 즉시 성공을, 결과는 RES-<id> 를 돌려준다.
function autoSucceed() {
  let n = 0;
  mockStartRun.mockImplementation(async () => ({ ok: true, run: runInfo(`r${++n}`) }));
  mockWaitForRun.mockImplementation(async (id: string) => runInfo(id, "succeeded"));
  mockGetEvents.mockImplementation((id: string) => [{ kind: "result", text: `RES-${id}` }]);
}

const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("human gate", () => {
  const wf = (name: string): WorkflowSpec => ({
    name,
    entry: "n1",
    nodes: [
      { id: "n1", agent: "a", prompt: "p1" },
      { id: "g1", kind: "gate", agent: "", prompt: "" },
      { id: "ok", agent: "b", prompt: "after: {{result}}" },
      { id: "no", agent: "c", prompt: "rejected" },
    ],
    edges: [
      { from: "n1", to: "g1", on: "success" },
      { from: "g1", to: "ok", on: "success" },
      { from: "g1", to: "no", on: "fail" },
    ],
  });

  it("pauses at the gate, approve follows the success edge with the carried result", async () => {
    autoSucceed();
    await startWorkflow(wf("wf-gate-ok"), { input: "x", threadId: "t1" });
    await settle();

    // 게이트에서 멈춤 — 다음 run 은 아직 없다.
    expect(mockStartRun).toHaveBeenCalledTimes(1);
    expect(mockInsertGate).toHaveBeenCalledTimes(1);
    const gate = listGates("t1").find((g) => g.workflow === "wf-gate-ok");
    expect(gate).toBeDefined();
    expect(gate!.result).toBe("RES-r1");

    const r = await resolveGate(gate!.id, true);
    expect(r.ok).toBe(true);
    await settle();
    expect(mockStartRun.mock.calls[1]![0].agent).toBe("b");
    // 게이트가 들고 있던 결과는 데이터 펜스로 감싸여 다음 스텝에 들어간다.
    const prompt = mockStartRun.mock.calls[1]![0].prompt as string;
    expect(prompt.startsWith("after: ")).toBe(true);
    expect(prompt).toContain("DATA");
    expect(prompt).toContain("RES-r1");
  });

  it("reject follows the fail edge and the gate resolves only once", async () => {
    autoSucceed();
    await startWorkflow(wf("wf-gate-no"), { input: "x", threadId: "t2" });
    await settle();
    const gate = listGates("t2").find((g) => g.workflow === "wf-gate-no")!;

    expect((await resolveGate(gate.id, false)).ok).toBe(true);
    await settle();
    expect(mockStartRun.mock.calls[1]![0].agent).toBe("c");

    // 이중 승인 방지 — 같은 게이트는 다시 풀 수 없다.
    expect((await resolveGate(gate.id, true)).ok).toBe(false);
  });
});

describe("parallel join", () => {
  const wf: WorkflowSpec = {
    name: "wf-join",
    entry: "n1",
    nodes: [
      { id: "n1", agent: "a", prompt: "p1" },
      { id: "n2", agent: "b", prompt: "p2" },
      { id: "n3", agent: "c", prompt: "p3" },
      { id: "n4", agent: "d", prompt: "joined: {{result}}" },
    ],
    edges: [
      { from: "n1", to: "n2", on: "success" },
      { from: "n1", to: "n3", on: "success" },
      { from: "n2", to: "n4", on: "success" },
      { from: "n3", to: "n4", on: "success" },
    ],
  };

  it("waits for both branches then joins results with a divider", async () => {
    autoSucceed();
    await startWorkflow(wf, { input: "x" });
    await settle();

    const agents = mockStartRun.mock.calls.map((c) => c[0].agent);
    // n4 는 정확히 한 번 — 두 분기가 모두 도착한 뒤에만.
    expect(agents).toEqual(["a", "b", "c", "d"]);
    const joined = mockStartRun.mock.calls[3]![0].prompt;
    expect(joined).toContain("\n\n---\n\n");
    expect(joined).toContain("RES-r2");
    expect(joined).toContain("RES-r3");
  });

  it("one failed branch leaves the join waiting (documented limitation)", async () => {
    let n = 0;
    mockStartRun.mockImplementation(async () => ({ ok: true, run: runInfo(`f${++n}`) }));
    // n2(f2)는 성공, n3(f3)는 실패 — fail 엣지가 없어 그 분기는 끊긴다.
    mockWaitForRun.mockImplementation(async (id: string) => runInfo(id, id === "f3" ? "failed" : "succeeded"));
    mockGetEvents.mockImplementation((id: string) => [{ kind: "result", text: `RES-${id}` }]);

    await startWorkflow(wf, { input: "x" });
    await settle();

    const agents = mockStartRun.mock.calls.map((c) => c[0].agent);
    expect(agents).toEqual(["a", "b", "c"]); // n4 미진입 — join 영구 대기
  });
});
