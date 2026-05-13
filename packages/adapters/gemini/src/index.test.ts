import { describe, it, expect } from "vitest";
import {
  buildGeminiCommand,
  geminiAdapter,
  extractGeminiSessionId,
  extractGeminiTouchedEdits,
  extractGeminiTouchedPaths,
  extractGeminiToolUses,
} from "./index.js";

describe("buildGeminiCommand", () => {
  it("defaults: gemini --output-format stream-json", () => {
    const { command, args } = buildGeminiCommand();
    expect(command).toBe("gemini");
    expect(args).toEqual(["--output-format", "stream-json"]);
  });

  it("appends --model when configured", () => {
    const { args } = buildGeminiCommand({ model: "gemini-2.5-pro" });
    expect(args[args.indexOf("--model") + 1]).toBe("gemini-2.5-pro");
  });

  it("appends --approval-mode yolo only when yolo=true", () => {
    expect(buildGeminiCommand().args).not.toContain("--approval-mode");
    expect(buildGeminiCommand({ yolo: true }).args).toEqual([
      "--output-format",
      "stream-json",
      "--approval-mode",
      "yolo",
    ]);
  });

  it("respects sandbox toggle", () => {
    expect(buildGeminiCommand({ sandbox: true }).args).toContain("--sandbox");
    expect(buildGeminiCommand({ sandbox: false }).args).toContain("--sandbox=none");
    expect(buildGeminiCommand().args).not.toContain("--sandbox");
    expect(buildGeminiCommand().args).not.toContain("--sandbox=none");
  });

  it("appends extraArgs at the end", () => {
    const { args } = buildGeminiCommand({ extraArgs: ["--debug"] });
    expect(args.slice(-1)).toEqual(["--debug"]);
  });

  it("respects command override", () => {
    expect(buildGeminiCommand({ command: "gemini-cli" }).command).toBe("gemini-cli");
  });
});

describe("geminiAdapter", () => {
  it("identifies as gemini", () => {
    expect(geminiAdapter.kind).toBe("gemini");
  });
});

describe("extractGeminiSessionId", () => {
  it("extracts session_id from init event", () => {
    const chunk = '{"type":"init","timestamp":"2025-01-01T00:00:00Z","session_id":"abc-123","model":"gemini-2.5-pro"}\n';
    expect(extractGeminiSessionId(chunk)).toBe("abc-123");
  });

  it("returns null for non-init events", () => {
    const chunk = '{"type":"message","role":"assistant","content":"hello"}\n';
    expect(extractGeminiSessionId(chunk)).toBeNull();
  });

  it("returns null for empty chunk", () => {
    expect(extractGeminiSessionId("")).toBeNull();
  });
});

describe("extractGeminiTouchedEdits", () => {
  it("extracts replace tool with old_string target", () => {
    const chunk = JSON.stringify({
      type: "tool_use",
      tool_name: "replace",
      tool_id: "t1",
      parameters: { file_path: "src/index.ts", old_string: "foo", new_string: "bar" },
    }) + "\n";
    expect(extractGeminiTouchedEdits(chunk)).toEqual([
      { path: "src/index.ts", target: "foo" },
    ]);
  });

  it("extracts write_file without target", () => {
    const chunk = JSON.stringify({
      type: "tool_use",
      tool_name: "write_file",
      tool_id: "t2",
      parameters: { file_path: "new-file.ts" },
    }) + "\n";
    expect(extractGeminiTouchedEdits(chunk)).toEqual([
      { path: "new-file.ts", target: undefined },
    ]);
  });

  it("ignores read_file and shell tools", () => {
    const chunk = [
      JSON.stringify({ type: "tool_use", tool_name: "read_file", parameters: { file_path: "a.ts" } }),
      JSON.stringify({ type: "tool_use", tool_name: "run_shell_command", parameters: { command: "ls" } }),
    ].join("\n") + "\n";
    expect(extractGeminiTouchedEdits(chunk)).toEqual([]);
  });
});

describe("extractGeminiTouchedPaths", () => {
  it("returns just paths from edit events", () => {
    const chunk = JSON.stringify({
      type: "tool_use",
      tool_name: "replace",
      tool_id: "t1",
      parameters: { file_path: "a.ts", old_string: "x", new_string: "y" },
    }) + "\n";
    expect(extractGeminiTouchedPaths(chunk)).toEqual(["a.ts"]);
  });
});

describe("extractGeminiToolUses", () => {
  it("extracts all tool_use events with summarised target", () => {
    const chunk = [
      JSON.stringify({ type: "tool_use", tool_name: "read_file", parameters: { file_path: "a.ts" } }),
      JSON.stringify({ type: "tool_use", tool_name: "run_shell_command", parameters: { command: "npm test" } }),
      JSON.stringify({ type: "tool_use", tool_name: "grep_search", parameters: { pattern: "TODO" } }),
      JSON.stringify({ type: "tool_use", tool_name: "google_web_search", parameters: { query: "vitest docs" } }),
      JSON.stringify({ type: "tool_use", tool_name: "invoke_agent", parameters: { agent_name: "reviewer" } }),
    ].join("\n") + "\n";
    const uses = extractGeminiToolUses(chunk);
    expect(uses).toEqual([
      { name: "read_file", target: "a.ts" },
      { name: "run_shell_command", target: "npm test" },
      { name: "grep_search", target: "TODO" },
      { name: "google_web_search", target: "vitest docs" },
      { name: "invoke_agent", target: "reviewer" },
    ]);
  });

  it("skips non tool_use events", () => {
    const chunk = [
      JSON.stringify({ type: "init", session_id: "s1" }),
      JSON.stringify({ type: "message", role: "assistant", content: "hi" }),
      JSON.stringify({ type: "tool_result", tool_id: "t1", status: "success" }),
    ].join("\n") + "\n";
    expect(extractGeminiToolUses(chunk)).toEqual([]);
  });
});
