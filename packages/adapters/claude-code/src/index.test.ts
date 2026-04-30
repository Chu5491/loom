import { describe, it, expect } from "vitest";
import {
  buildClaudeCommand,
  claudeCodeAdapter,
  extractClaudeSessionId,
  extractClaudeTouchedEdits,
  extractClaudeTouchedPaths,
} from "./index.js";

describe("buildClaudeCommand", () => {
  it("uses defaults: claude --print - --output-format stream-json --verbose", () => {
    const { command, args } = buildClaudeCommand();
    expect(command).toBe("claude");
    expect(args).toEqual([
      "--print",
      "-",
      "--output-format",
      "stream-json",
      "--verbose",
    ]);
  });

  it("respects command override", () => {
    expect(buildClaudeCommand({ command: "/usr/local/bin/claude" }).command).toBe(
      "/usr/local/bin/claude",
    );
  });

  it("appends --model when configured", () => {
    const { args } = buildClaudeCommand({ model: "claude-opus-4-7" });
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("claude-opus-4-7");
  });

  it("appends --add-dir for each addDirs entry", () => {
    const { args } = buildClaudeCommand({ addDirs: ["/tmp/a", "/tmp/b"] });
    const positions = args.flatMap((a, i) => (a === "--add-dir" ? [i] : []));
    expect(positions).toHaveLength(2);
    expect(args[positions[0]! + 1]).toBe("/tmp/a");
    expect(args[positions[1]! + 1]).toBe("/tmp/b");
  });

  it("appends --dangerously-skip-permissions only when set", () => {
    expect(buildClaudeCommand().args).not.toContain("--dangerously-skip-permissions");
    expect(
      buildClaudeCommand({ dangerouslySkipPermissions: true }).args,
    ).toContain("--dangerously-skip-permissions");
  });

  it("appends extraArgs at the end", () => {
    const { args } = buildClaudeCommand({ extraArgs: ["--mcp-config", "foo.json"] });
    expect(args.slice(-2)).toEqual(["--mcp-config", "foo.json"]);
  });

  it("text output format omits --verbose by default", () => {
    const { args } = buildClaudeCommand({ outputFormat: "text" });
    expect(args).toContain("text");
    expect(args).not.toContain("--verbose");
  });

  it("explicit verbose=false overrides stream-json default", () => {
    const { args } = buildClaudeCommand({ outputFormat: "stream-json", verbose: false });
    expect(args).not.toContain("--verbose");
  });
});

describe("claudeCodeAdapter", () => {
  it("identifies as claude-code", () => {
    expect(claudeCodeAdapter.kind).toBe("claude-code");
  });
  it("buildCommand on adapter delegates to buildClaudeCommand", () => {
    expect(claudeCodeAdapter.buildCommand({ model: "x" }).args).toContain("x");
  });
  it("exposes extractSessionId for resume capture", () => {
    expect(typeof claudeCodeAdapter.extractSessionId).toBe("function");
  });
});

describe("extractClaudeSessionId", () => {
  it("plucks session_id out of an init event", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "abc-123",
    });
    expect(extractClaudeSessionId(line)).toBe("abc-123");
  });

  it("ignores non-JSON noise and partial lines", () => {
    expect(extractClaudeSessionId("warming up...\n")).toBeNull();
    expect(extractClaudeSessionId("{\"type\":\"system\",\"sub")).toBeNull();
  });

  it("returns null when session_id is missing", () => {
    const line = JSON.stringify({ type: "assistant", message: { content: [] } });
    expect(extractClaudeSessionId(line)).toBeNull();
  });

  it("scans across multiple lines and returns the first hit", () => {
    const chunk =
      "noise\n" +
      JSON.stringify({ type: "x" }) +
      "\n" +
      JSON.stringify({ type: "system", session_id: "first" }) +
      "\n" +
      JSON.stringify({ type: "result", session_id: "second" });
    expect(extractClaudeSessionId(chunk)).toBe("first");
  });
});

describe("extractClaudeTouchedPaths", () => {
  const writeEvent = (filePath: string) =>
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Write",
            input: { file_path: filePath, content: "..." },
          },
        ],
      },
    });

  it("plucks file_path from a Write tool_use", () => {
    expect(extractClaudeTouchedPaths(writeEvent("/abs/src/auth.ts"))).toEqual([
      "/abs/src/auth.ts",
    ]);
  });

  it("supports Edit and MultiEdit", () => {
    const editEvent = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Edit", input: { file_path: "/a.ts" } },
          { type: "tool_use", name: "MultiEdit", input: { file_path: "/b.ts" } },
        ],
      },
    });
    expect(extractClaudeTouchedPaths(editEvent)).toEqual(["/a.ts", "/b.ts"]);
  });

  it("ignores Read / Bash / Grep — those are inspection, not edits", () => {
    const readEvent = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Read", input: { file_path: "/a.ts" } },
          { type: "tool_use", name: "Bash", input: { command: "ls" } },
          { type: "tool_use", name: "Grep", input: { pattern: "x" } },
        ],
      },
    });
    expect(extractClaudeTouchedPaths(readEvent)).toEqual([]);
  });

  it("handles NotebookEdit's notebook_path field", () => {
    const ev = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "NotebookEdit",
            input: { notebook_path: "/n.ipynb" },
          },
        ],
      },
    });
    expect(extractClaudeTouchedPaths(ev)).toEqual(["/n.ipynb"]);
  });

  it("returns empty for non-assistant events and malformed lines", () => {
    expect(extractClaudeTouchedPaths("garbage\n")).toEqual([]);
    expect(
      extractClaudeTouchedPaths(
        JSON.stringify({ type: "system", subtype: "init" }),
      ),
    ).toEqual([]);
  });
});

describe("extractClaudeTouchedEdits", () => {
  it("returns {path, target} for an Edit", () => {
    const ev = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Edit",
            input: { file_path: "/a.ts", old_string: "foo", new_string: "bar" },
          },
        ],
      },
    });
    expect(extractClaudeTouchedEdits(ev)).toEqual([
      { path: "/a.ts", target: "foo" },
    ]);
  });

  it("Write has path but no target (whole-file overwrite)", () => {
    const ev = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Write",
            input: { file_path: "/a.ts", content: "..." },
          },
        ],
      },
    });
    expect(extractClaudeTouchedEdits(ev)).toEqual([{ path: "/a.ts" }]);
  });

  it("MultiEdit emits one entry per nested edit", () => {
    const ev = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "MultiEdit",
            input: {
              file_path: "/a.ts",
              edits: [
                { old_string: "foo", new_string: "FOO" },
                { old_string: "bar", new_string: "BAR" },
              ],
            },
          },
        ],
      },
    });
    expect(extractClaudeTouchedEdits(ev)).toEqual([
      { path: "/a.ts", target: "foo" },
      { path: "/a.ts", target: "bar" },
    ]);
  });
});
