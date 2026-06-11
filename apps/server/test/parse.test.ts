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
});
