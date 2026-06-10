import { describe, it, expect, beforeEach } from "vitest";
import type { HarnessEdge } from "@loom/core";
import { createAgent } from "../src/db/agents.js";
import { createProject } from "../src/db/projects.js";
import {
  createHarnessEdge,
  deleteHarnessEdge,
  findDuplicateEdge,
  listEdgesFromAgent,
  listHarnessEdges,
  updateHarnessEdge,
} from "../src/db/harness-edges.js";
import {
  buildHandoffPrompt,
  resolveAutoEdges,
  triggerMatches,
  type RunOutcome,
} from "../src/services/harness.js";
import { getDb } from "../src/db/client.js";

function reset(): void {
  const db = getDb();
  db.exec("DELETE FROM harness_edges");
  db.exec("DELETE FROM agents");
  db.exec("DELETE FROM projects");
}

function makeProjectWithAgents() {
  const project = createProject({ name: "p", path: "/tmp/p" });
  const a = createAgent({
    projectId: project.id,
    name: "builder",
    adapterKind: "claude-code",
    adapterConfig: {},
  });
  const b = createAgent({
    projectId: project.id,
    name: "reviewer",
    adapterKind: "claude-code",
    adapterConfig: {},
  });
  return { projectId: project.id, a, b };
}

const edge = (over: Partial<HarnessEdge>): HarnessEdge => ({
  id: "e",
  projectId: "p",
  fromAgentId: "a",
  toAgentId: "b",
  trigger: "on_success",
  prompt: null,
  carryResult: false,
  mode: "auto",
  createdAt: "",
  updatedAt: "",
  ...over,
});

const ok: RunOutcome = { status: "succeeded", changedFileCount: 3 };
const noChange: RunOutcome = { status: "succeeded", changedFileCount: 0 };
const failed: RunOutcome = { status: "failed", changedFileCount: 0 };
const cancelled: RunOutcome = { status: "cancelled", changedFileCount: 2 };

describe("triggerMatches", () => {
  it("on_success matches only succeeded", () => {
    expect(triggerMatches("on_success", ok)).toBe(true);
    expect(triggerMatches("on_success", failed)).toBe(false);
  });

  it("on_fail matches only failed", () => {
    expect(triggerMatches("on_fail", failed)).toBe(true);
    expect(triggerMatches("on_fail", ok)).toBe(false);
  });

  it("on_changes needs success AND changed files", () => {
    expect(triggerMatches("on_changes", ok)).toBe(true);
    expect(triggerMatches("on_changes", noChange)).toBe(false);
  });

  it("manual never auto-matches", () => {
    expect(triggerMatches("manual", ok)).toBe(false);
  });

  it("cancelled fires nothing", () => {
    expect(triggerMatches("on_success", cancelled)).toBe(false);
    expect(triggerMatches("on_changes", cancelled)).toBe(false);
  });
});

describe("resolveAutoEdges", () => {
  it("picks auto edges whose trigger matches", () => {
    const edges = [
      edge({ id: "1", trigger: "on_success", mode: "auto" }),
      edge({ id: "2", trigger: "on_fail", mode: "auto" }),
      edge({ id: "3", trigger: "on_success", mode: "ask" }),
    ];
    const fired = resolveAutoEdges(edges, ok);
    expect(fired.map((e) => e.id)).toEqual(["1"]);
  });

  it("excludes ask-mode edges even when the trigger matches", () => {
    const edges = [edge({ id: "1", trigger: "on_success", mode: "ask" })];
    expect(resolveAutoEdges(edges, ok)).toHaveLength(0);
  });
});

describe("buildHandoffPrompt", () => {
  it("uses the edge instruction alone when carry is off", () => {
    expect(
      buildHandoffPrompt({
        edgePrompt: "review the diff",
        carryResult: false,
        fromAgentName: "builder",
        fromRunId: "abcdef1234",
        resultText: "should be ignored",
      }),
    ).toBe("review the diff");
  });

  it("prepends a marked result block when carry is on", () => {
    const p = buildHandoffPrompt({
      edgePrompt: "review",
      carryResult: true,
      fromAgentName: "builder",
      fromRunId: "abcdef1234567",
      resultText: "built the thing",
    });
    expect(p).toContain("=== Result from @builder (run abcdef12) ===");
    expect(p).toContain("built the thing");
    expect(p).toContain("review");
  });

  it("carry on but no result text → instruction only", () => {
    expect(
      buildHandoffPrompt({
        edgePrompt: "go",
        carryResult: true,
        fromAgentName: "b",
        fromRunId: "x",
        resultText: null,
      }),
    ).toBe("go");
  });

  it("falls back to a default when prompt and carry are both empty", () => {
    expect(
      buildHandoffPrompt({
        edgePrompt: null,
        carryResult: false,
        fromAgentName: "builder",
        fromRunId: "x",
        resultText: null,
      }),
    ).toContain("Continue from @builder");
  });
});

describe("harness_edges CRUD", () => {
  beforeEach(reset);

  it("creates and lists by project", () => {
    const { projectId, a, b } = makeProjectWithAgents();
    createHarnessEdge({
      projectId,
      fromAgentId: a.id,
      toAgentId: b.id,
      trigger: "on_success",
      mode: "auto",
    });
    const edges = listHarnessEdges(projectId);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.mode).toBe("auto");
  });

  it("listEdgesFromAgent scopes to the source agent", () => {
    const { projectId, a, b } = makeProjectWithAgents();
    createHarnessEdge({ projectId, fromAgentId: a.id, toAgentId: b.id, trigger: "on_success" });
    createHarnessEdge({ projectId, fromAgentId: b.id, toAgentId: a.id, trigger: "on_fail" });
    expect(listEdgesFromAgent(a.id)).toHaveLength(1);
    expect(listEdgesFromAgent(a.id)[0]?.toAgentId).toBe(b.id);
  });

  it("findDuplicateEdge matches on from+to+trigger", () => {
    const { projectId, a, b } = makeProjectWithAgents();
    createHarnessEdge({ projectId, fromAgentId: a.id, toAgentId: b.id, trigger: "on_success" });
    expect(
      findDuplicateEdge({ fromAgentId: a.id, toAgentId: b.id, trigger: "on_success" }),
    ).not.toBeNull();
    expect(
      findDuplicateEdge({ fromAgentId: a.id, toAgentId: b.id, trigger: "on_fail" }),
    ).toBeNull();
  });

  it("updates carryResult and mode", () => {
    const { projectId, a, b } = makeProjectWithAgents();
    const e = createHarnessEdge({ projectId, fromAgentId: a.id, toAgentId: b.id, trigger: "on_success" });
    const updated = updateHarnessEdge(e.id, { carryResult: true, mode: "auto" });
    expect(updated?.carryResult).toBe(true);
    expect(updated?.mode).toBe("auto");
    expect(updated?.trigger).toBe("on_success");
  });

  it("deletes, and cascades when an agent is removed", () => {
    const { projectId, a, b } = makeProjectWithAgents();
    const e = createHarnessEdge({ projectId, fromAgentId: a.id, toAgentId: b.id, trigger: "on_success" });
    expect(deleteHarnessEdge(e.id)).toBe(true);
    createHarnessEdge({ projectId, fromAgentId: a.id, toAgentId: b.id, trigger: "on_fail" });
    getDb().prepare("DELETE FROM agents WHERE id = ?").run(a.id);
    expect(listHarnessEdges(projectId)).toHaveLength(0);
  });
});
