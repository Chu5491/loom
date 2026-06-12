// 워크플로우 실행 경로 — 스텝 실패·타임아웃·시작 실패가 그래프를 멈추지 않고
// fail 엣지로 진행하는지 검증. engine 은 모킹(실제 spawn 없음).

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

import { cancelRun, startRun, waitForRun } from "../src/run/engine.js";
import { startWorkflow } from "../src/run/workflow.js";

const mockStartRun = vi.mocked(startRun);
const mockWaitForRun = vi.mocked(waitForRun);
const mockCancelRun = vi.mocked(cancelRun);

function runInfo(id: string, status: RunInfo["status"] = "running"): RunInfo {
  return {
    id,
    agent: "a",
    prompt: "p",
    status,
    startedAt: "",
    endedAt: null,
    exitCode: null,
    parentRunId: null,
    projectId: null,
    threadId: null,
    costUsd: null,
    workflow: "wf",
    node: null,
  };
}

const wf: WorkflowSpec = {
  name: "wf",
  entry: "n1",
  nodes: [
    { id: "n1", agent: "a", prompt: "p1" },
    { id: "n2", agent: "b", prompt: "ok: {{result}}" },
    { id: "n3", agent: "c", prompt: "recover: {{result}}" },
  ],
  edges: [
    { from: "n1", to: "n2", on: "success" },
    { from: "n1", to: "n3", on: "fail" },
  ],
};

// watchRun 은 fire-and-forget — 마이크로태스크가 빠질 때까지 기다린다.
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("workflow execution fail paths", () => {
  it("entry run failure follows the fail edge", async () => {
    mockStartRun.mockResolvedValue({ ok: true, run: runInfo("r1") });
    mockWaitForRun.mockResolvedValueOnce(runInfo("r1", "failed"));
    // n3 진입 run 은 영원히 대기(테스트 종료 시점엔 무관)
    mockWaitForRun.mockReturnValue(new Promise(() => {}));

    const res = await startWorkflow(wf, { input: "x" });
    expect(res.ok).toBe(true);
    await settle();

    const agents = mockStartRun.mock.calls.map((c) => c[0].agent);
    expect(agents).toEqual(["a", "c"]);
  });

  it("step timeout cancels the run and follows the fail edge", async () => {
    mockStartRun.mockResolvedValue({ ok: true, run: runInfo("r1") });
    mockWaitForRun.mockRejectedValueOnce(new Error("delegation_timeout"));
    mockWaitForRun.mockReturnValue(new Promise(() => {}));

    await startWorkflow(wf, { input: "x" });
    await settle();

    expect(mockCancelRun).toHaveBeenCalledWith("r1");
    const agents = mockStartRun.mock.calls.map((c) => c[0].agent);
    expect(agents).toEqual(["a", "c"]);
    expect(mockStartRun.mock.calls[1]![0].prompt).toContain("timed out");
  });

  it("step start failure follows the fail edge instead of stalling", async () => {
    mockStartRun
      .mockResolvedValueOnce({ ok: true, run: runInfo("r1") }) // n1
      .mockResolvedValueOnce({ ok: false, status: 404, error: "agent_not_found" }) // n2
      .mockResolvedValue({ ok: true, run: runInfo("r-rest") });
    mockWaitForRun.mockResolvedValueOnce(runInfo("r1", "succeeded"));
    mockWaitForRun.mockReturnValue(new Promise(() => {}));

    const failWf: WorkflowSpec = {
      ...wf,
      edges: [
        { from: "n1", to: "n2", on: "success" },
        { from: "n2", to: "n3", on: "fail" },
      ],
    };
    await startWorkflow(failWf, { input: "x" });
    await settle();

    const agents = mockStartRun.mock.calls.map((c) => c[0].agent);
    expect(agents).toEqual(["a", "b", "c"]);
    expect(mockStartRun.mock.calls[2]![0].prompt).toContain("failed to start");
  });

  it("cancelled run stops the graph (no fail edge)", async () => {
    mockStartRun.mockResolvedValue({ ok: true, run: runInfo("r1") });
    mockWaitForRun.mockResolvedValueOnce(runInfo("r1", "cancelled"));

    await startWorkflow(wf, { input: "x" });
    await settle();

    expect(mockStartRun).toHaveBeenCalledTimes(1);
    expect(mockCancelRun).not.toHaveBeenCalled();
  });
});
