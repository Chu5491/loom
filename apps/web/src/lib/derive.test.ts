import { describe, it, expect } from "vitest";
import type { OfficeEvent } from "@loom/core";
import { deriveView, prettyTool, fmtDuration, fmtTok } from "./derive.js";

describe("deriveView", () => {
  it("collects tool/file into trace and counts changed files", () => {
    const events: OfficeEvent[] = [
      { kind: "tool", name: "Read", target: "a.ts" },
      { kind: "file", path: "b.ts", action: "edit" },
      { kind: "file", path: "c.ts", action: "write" },
    ];
    const v = deriveView(events);
    expect(v.trace).toEqual([
      { kind: "tool", name: "Read", target: "a.ts" },
      { kind: "file", name: "Edit", target: "b.ts", action: "edit" },
      { kind: "file", name: "Write", target: "c.ts", action: "write" },
    ]);
    expect(v.changedFiles).toBe(2);
  });

  it("separates reasoning from the answer text", () => {
    const v = deriveView([
      { kind: "reasoning", text: "let me think" },
      { kind: "text", text: "the answer" },
    ]);
    expect(v.reasoning).toBe("let me think");
    expect(v.body).toBe("the answer");
  });

  it("accumulates usage tokens (input/output/cached) across events", () => {
    const v = deriveView([
      { kind: "usage", inputTokens: 100, outputTokens: 10, cachedInputTokens: 80 },
      { kind: "usage", inputTokens: 50, outputTokens: 5, cachedInputTokens: 40 },
    ]);
    expect(v.tokens).toEqual({ input: 150, output: 15, cached: 120 });
  });

  it("omits tokens when there are no usage events", () => {
    expect(deriveView([{ kind: "text", text: "hi" }]).tokens).toBeUndefined();
  });

  it("prefers the result text over accumulated text for the body", () => {
    const v = deriveView([
      { kind: "text", text: "partial" },
      { kind: "result", text: "FINAL", sessionId: "s1" },
    ]);
    expect(v.body).toBe("FINAL");
    expect(v.result?.sessionId).toBe("s1");
  });

  it("collects errors", () => {
    expect(deriveView([{ kind: "error", message: "boom" }]).errors).toEqual(["boom"]);
  });
});

describe("formatters", () => {
  it("prettyTool renders mcp__server__tool as server·tool, leaves others", () => {
    expect(prettyTool("mcp__loom__delegate")).toBe("loom·delegate");
    expect(prettyTool("Read")).toBe("Read");
  });

  it("fmtTok abbreviates thousands", () => {
    expect(fmtTok(500)).toBe("500");
    expect(fmtTok(1500)).toBe("1.5k");
    expect(fmtTok(13084)).toBe("13k");
  });

  it("fmtDuration renders ms / s / m s", () => {
    expect(fmtDuration(800)).toBe("800ms");
    expect(fmtDuration(5000)).toBe("5s");
    expect(fmtDuration(125000)).toBe("2m 5s");
  });
});
