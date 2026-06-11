import { describe, expect, it } from "vitest";
import type { WorkflowSpec, WorkflowTrigger } from "@loom/core";
import { nextNodeIds, renderStepPrompt, resolveAutoWorkflows, triggerMatches } from "../src/run/workflow.js";

const wf: WorkflowSpec = {
  name: "wf",
  entry: "n1",
  nodes: [
    { id: "n1", agent: "a", prompt: "p1" },
    { id: "n2", agent: "b", prompt: "p2" },
    { id: "n3", agent: "c", prompt: "p3" },
  ],
  edges: [
    { from: "n1", to: "n2", on: "success" },
    { from: "n1", to: "n3", on: "fail" },
    { from: "n2", to: "n3", on: "always" },
  ],
};

describe("nextNodeIds", () => {
  it("follows success edges on success", () => {
    expect(nextNodeIds(wf, "n1", "success")).toEqual(["n2"]);
  });

  it("follows fail edges on fail", () => {
    expect(nextNodeIds(wf, "n1", "fail")).toEqual(["n3"]);
  });

  it("always edges fire on both outcomes", () => {
    expect(nextNodeIds(wf, "n2", "success")).toEqual(["n3"]);
    expect(nextNodeIds(wf, "n2", "fail")).toEqual(["n3"]);
  });

  it("terminal node has no next", () => {
    expect(nextNodeIds(wf, "n3", "success")).toEqual([]);
  });
});

describe("triggerMatches (옛 하네스 흡수)", () => {
  const tr = (on: WorkflowTrigger["on"]): WorkflowTrigger => ({ agent: "a", on, mode: "auto" });

  it("success fires only on succeeded", () => {
    expect(triggerMatches(tr("success"), { status: "succeeded", changedFileCount: 0 })).toBe(true);
    expect(triggerMatches(tr("success"), { status: "failed", changedFileCount: 0 })).toBe(false);
  });

  it("fail fires only on failed", () => {
    expect(triggerMatches(tr("fail"), { status: "failed", changedFileCount: 0 })).toBe(true);
    expect(triggerMatches(tr("fail"), { status: "succeeded", changedFileCount: 0 })).toBe(false);
  });

  it("changes needs success AND file changes", () => {
    expect(triggerMatches(tr("changes"), { status: "succeeded", changedFileCount: 2 })).toBe(true);
    expect(triggerMatches(tr("changes"), { status: "succeeded", changedFileCount: 0 })).toBe(false);
    expect(triggerMatches(tr("changes"), { status: "failed", changedFileCount: 2 })).toBe(false);
  });
});

describe("resolveAutoWorkflows", () => {
  const make = (name: string, trigger: WorkflowTrigger | null): WorkflowSpec => ({
    name,
    trigger,
    entry: "n1",
    nodes: [{ id: "n1", agent: "b", prompt: "p" }],
    edges: [],
  });
  const all = [
    make("auto-hit", { agent: "a", on: "success", mode: "auto" }),
    make("ask-hit", { agent: "a", on: "success", mode: "ask" }),
    make("other-agent", { agent: "x", on: "success", mode: "auto" }),
    make("manual-only", null),
  ];

  it("returns only auto-mode workflows whose trigger matches the agent and outcome", () => {
    const fired = resolveAutoWorkflows(all, "a", { status: "succeeded", changedFileCount: 0 });
    expect(fired.map((w) => w.name)).toEqual(["auto-hit"]);
  });

  it("cancelled-like mismatches fire nothing", () => {
    expect(resolveAutoWorkflows(all, "a", { status: "cancelled", changedFileCount: 0 })).toEqual([]);
  });
});

describe("renderStepPrompt", () => {
  it("substitutes input and result placeholders", () => {
    expect(renderStepPrompt("do {{input}} with {{result}}", "X", "Y")).toBe("do X with Y");
  });

  it("missing result renders empty", () => {
    expect(renderStepPrompt("after: {{result}}", "X", null)).toBe("after: ");
  });

  it("templates without placeholders pass through", () => {
    expect(renderStepPrompt("static", "X", "Y")).toBe("static");
  });
});
