import { describe, expect, it } from "vitest";
import { parseLine } from "../src/run/parse.js";

describe("parseLine", () => {
  it("maps claude assistant text to a text event", () => {
    const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } });
    expect(parseLine(line)).toEqual([{ kind: "text", text: "hi" }]);
  });

  it("keeps typeless JSON lines as text — plain-text CLI pretty-printed JSON fragments", () => {
    // devin 이 JSON 응답을 pretty-print 하면 일부 줄이 그 자체로 유효한 JSON 객체가 된다.
    // 버리면 result 합성에서 그 줄만 빠져 깨진 JSON 이 된다(실측 버그).
    const line = '{"path": ".git", "desc": "Git repo"}';
    expect(parseLine(line)).toEqual([{ kind: "text", text: line }]);
  });

  it("drops unknown typed stream events", () => {
    expect(parseLine(JSON.stringify({ type: "system", subtype: "init" }))).toEqual([]);
  });

  it("non-JSON lines are plain text", () => {
    expect(parseLine("hello world")).toEqual([{ kind: "text", text: "hello world" }]);
  });

  it("captures codex token usage from turn.completed (no cost — engine estimates)", () => {
    const line = JSON.stringify({ type: "turn.completed", usage: { input_tokens: 12049, output_tokens: 22 } });
    expect(parseLine(line)).toEqual([{ kind: "usage", inputTokens: 12049, outputTokens: 22 }]);
  });

  it("captures opencode tokens + reported cost from step_finish", () => {
    const line = JSON.stringify({ type: "step_finish", part: { cost: 0.0042, tokens: { input: 13723, output: 17 } } });
    expect(parseLine(line)).toEqual([{ kind: "usage", costUsd: 0.0042, inputTokens: 13723, outputTokens: 17 }]);
  });

  it("captures factory/droid usage tokens from the final result object", () => {
    const line = JSON.stringify({ type: "result", result: "ok", session_id: "s1", usage: { input_tokens: 100, output_tokens: 20 } });
    const out = parseLine(line);
    expect(out[0]).toMatchObject({ kind: "result", text: "ok", sessionId: "s1" });
    expect(out[1]).toEqual({ kind: "usage", inputTokens: 100, outputTokens: 20 });
  });

  it("treats claude MultiEdit as a file edit, not a generic tool", () => {
    const me = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "MultiEdit", input: { file_path: "a.ts" } }] } });
    expect(parseLine(me)).toEqual([{ kind: "file", path: "a.ts", action: "edit" }]);
  });

  it("captures codex MCP tool calls and web_search from item.completed", () => {
    const mcp = JSON.stringify({ type: "item.completed", item: { type: "mcp_tool_call", tool: "delegate", server: "loom" } });
    expect(parseLine(mcp)).toEqual([{ kind: "tool", name: "delegate", target: "loom" }]);
    const ws = JSON.stringify({ type: "item.completed", item: { type: "web_search", query: "loom orchestration" } });
    expect(parseLine(ws)).toEqual([{ kind: "tool", name: "web_search", target: "loom orchestration" }]);
  });

  it("captures codex file_change from item.completed changes[] (was dropped — path is not at item.path)", () => {
    const fc = JSON.stringify({
      type: "item.completed",
      item: { type: "file_change", changes: [{ path: "src/a.ts", kind: "update" }, { path: "src/b.ts", kind: "add" }] },
    });
    expect(parseLine(fc)).toEqual([
      { kind: "file", path: "src/a.ts", action: "edit" },
      { kind: "file", path: "src/b.ts", action: "write" },
    ]);
  });

  it("falls back to a single item.path for legacy file_change shape", () => {
    const fc = JSON.stringify({ type: "item.completed", item: { type: "file_change", path: "legacy.ts" } });
    expect(parseLine(fc)).toEqual([{ kind: "file", path: "legacy.ts", action: "edit" }]);
  });

  it("surfaces a codex turn.failed as an error event (was silent → empty run)", () => {
    const f = JSON.stringify({ type: "turn.failed", error: { message: "rate limited" } });
    expect(parseLine(f)).toEqual([{ kind: "error", message: "rate limited" }]);
  });

  it("captures opencode reasoning (--thinking) as a reasoning event", () => {
    const line = JSON.stringify({ type: "reasoning", part: { text: "let me think" } });
    expect(parseLine(line)).toEqual([{ kind: "reasoning", text: "let me think" }]);
  });

  it("captures codex reasoning item as a reasoning event", () => {
    const line = JSON.stringify({ type: "item.completed", item: { type: "reasoning", text: "planning" } });
    expect(parseLine(line)).toEqual([{ kind: "reasoning", text: "planning" }]);
  });
});
