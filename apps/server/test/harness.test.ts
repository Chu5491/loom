// 하네스 발화 판정 — 순수 로직 단위 테스트.

import { describe, it, expect } from "vitest";
import type { HarnessEdge } from "@loom/core";
import { buildHandoffPrompt, resolveAutoEdges, triggerMatches } from "../src/run/harness.js";

const edge = (over: Partial<HarnessEdge>): HarnessEdge => ({
  from: "a",
  to: "b",
  trigger: "on_success",
  mode: "auto",
  ...over,
});

describe("triggerMatches", () => {
  it("on_success fires only on succeeded", () => {
    expect(triggerMatches("on_success", { status: "succeeded", changedFileCount: 0 })).toBe(true);
    expect(triggerMatches("on_success", { status: "failed", changedFileCount: 0 })).toBe(false);
  });

  it("on_fail fires only on failed", () => {
    expect(triggerMatches("on_fail", { status: "failed", changedFileCount: 0 })).toBe(true);
    expect(triggerMatches("on_fail", { status: "succeeded", changedFileCount: 0 })).toBe(false);
  });

  it("on_changes needs success AND file changes", () => {
    expect(triggerMatches("on_changes", { status: "succeeded", changedFileCount: 2 })).toBe(true);
    expect(triggerMatches("on_changes", { status: "succeeded", changedFileCount: 0 })).toBe(false);
    expect(triggerMatches("on_changes", { status: "failed", changedFileCount: 2 })).toBe(false);
  });

  it("manual never auto-fires", () => {
    expect(triggerMatches("manual", { status: "succeeded", changedFileCount: 5 })).toBe(false);
  });

  it("cancelled fires nothing", () => {
    for (const tr of ["on_success", "on_fail", "on_changes", "manual"] as const) {
      expect(triggerMatches(tr, { status: "cancelled", changedFileCount: 1 })).toBe(false);
    }
  });
});

describe("resolveAutoEdges", () => {
  it("keeps only auto edges whose trigger matches", () => {
    const edges = [
      edge({ to: "auto-hit", mode: "auto", trigger: "on_success" }),
      edge({ to: "ask-skip", mode: "ask", trigger: "on_success" }),
      edge({ to: "wrong-trigger", mode: "auto", trigger: "on_fail" }),
    ];
    const fired = resolveAutoEdges(edges, { status: "succeeded", changedFileCount: 0 });
    expect(fired.map((e) => e.to)).toEqual(["auto-hit"]);
  });
});

describe("buildHandoffPrompt", () => {
  it("prepends a marked result block when carryResult and result present", () => {
    const p = buildHandoffPrompt({
      edgePrompt: "Review this",
      carryResult: true,
      fromAgentName: "coder",
      fromRunId: "abcdef123456",
      resultText: "done the thing",
    });
    expect(p).toContain("=== Result from @coder (run abcdef12) ===");
    expect(p).toContain("done the thing");
    expect(p.trim().endsWith("Review this")).toBe(true);
  });

  it("falls back to a minimal note when both edgePrompt and result are empty", () => {
    const p = buildHandoffPrompt({
      edgePrompt: undefined,
      carryResult: false,
      fromAgentName: "coder",
      fromRunId: "x",
      resultText: null,
    });
    expect(p).toBe("Continue from @coder's last run.");
  });

  it("omits the result block when carryResult is off", () => {
    const p = buildHandoffPrompt({
      edgePrompt: "Go",
      carryResult: false,
      fromAgentName: "coder",
      fromRunId: "x",
      resultText: "secret result",
    });
    expect(p).not.toContain("secret result");
    expect(p).toBe("Go");
  });
});
