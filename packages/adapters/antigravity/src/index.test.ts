import { describe, it, expect } from "vitest";
import {
  buildAntigravityCommand,
  antigravityAdapter,
  extractAntigravitySessionId,
  extractAntigravityTouchedEdits,
  extractAntigravityTouchedPaths,
  extractAntigravityToolUses,
  parseModelLines,
  ANTIGRAVITY_PRESET_MODELS,
} from "./index.js";

describe("buildAntigravityCommand", () => {
  it("defaults: agy with no flags", () => {
    const { command, args } = buildAntigravityCommand();
    expect(command).toBe("agy");
    expect(args).toEqual([]);
  });

  it("appends --dangerously-skip-permissions when set", () => {
    expect(buildAntigravityCommand().args).not.toContain("--dangerously-skip-permissions");
    expect(buildAntigravityCommand({ dangerouslySkipPermissions: true }).args).toEqual([
      "--dangerously-skip-permissions",
    ]);
  });

  it("passes model via --model flag", () => {
    const { args } = buildAntigravityCommand({ model: "gemini-3.1-pro" });
    expect(args[args.indexOf("--model") + 1]).toBe("gemini-3.1-pro");
  });

  it("respects sandbox toggle", () => {
    expect(buildAntigravityCommand({ sandbox: true }).args).toContain("--sandbox");
    expect(buildAntigravityCommand().args).not.toContain("--sandbox");
  });

  it("appends extraArgs at the end", () => {
    const { args } = buildAntigravityCommand({ extraArgs: ["--log-file", "/tmp/agy.log"] });
    expect(args).toEqual(["--log-file", "/tmp/agy.log"]);
  });

  it("respects command override", () => {
    expect(buildAntigravityCommand({ command: "ag-cli" }).command).toBe("ag-cli");
  });
});

describe("antigravityAdapter", () => {
  it("identifies as antigravity", () => {
    expect(antigravityAdapter.kind).toBe("antigravity");
  });
});

describe("ANTIGRAVITY_PRESET_MODELS", () => {
  it("contains known model families", () => {
    const values = ANTIGRAVITY_PRESET_MODELS.map((m) => m.value);
    expect(values).toContain("gemini-3.5-flash");
    expect(values).toContain("gemini-3.1-pro");
    expect(values).toContain("claude-sonnet-4-6");
    expect(values).toContain("claude-opus-4-6");
    expect(values).toContain("gpt-oss-120b");
  });

  it("every entry has value, label, and category", () => {
    for (const m of ANTIGRAVITY_PRESET_MODELS) {
      expect(m.value).toBeTruthy();
      expect(m.label).toBeTruthy();
      expect(m.category).toBeTruthy();
    }
  });
});

describe("parseModelLines (agy models live → ids)", () => {
  it("maps recognised display labels back to their preset id", () => {
    // agy prints labels, not ids; normalised-label match recovers the real id.
    const models = parseModelLines(
      ["Claude Opus 4.6 (Thinking)", "Gemini 3.5 Flash (Medium)"].join("\n"),
    );
    const byLabel = new Map(models.map((m) => [m.label, m.value]));
    expect(byLabel.get("Claude Opus 4.6 Thinking")).toBe("claude-opus-4-6");
    expect(byLabel.get("Gemini 3.5 Flash (Medium)")).toBe(
      "gemini-3.5-flash:thinking-medium",
    );
  });

  it("surfaces models not in our preset map as Other (label as value)", () => {
    // e.g. extra thinking tiers agy exposes that our curated presets don't list.
    const models = parseModelLines("Gemini 3.5 Flash (High)");
    expect(models).toEqual([
      {
        value: "Gemini 3.5 Flash (High)",
        label: "Gemini 3.5 Flash (High)",
        category: "Other",
      },
    ]);
  });

  it("skips blank lines and chrome", () => {
    expect(parseModelLines("\n  \nAvailable models:\nClaude Opus 4.6 (Thinking)\n"))
      .toHaveLength(1);
  });
});

describe("extractAntigravitySessionId", () => {
  it("extracts session_id from init event", () => {
    const chunk = '{"type":"init","timestamp":"2025-01-01T00:00:00Z","session_id":"abc-123","model":"gemini-2.5-pro"}\n';
    expect(extractAntigravitySessionId(chunk)).toBe("abc-123");
  });

  it("returns null for non-init events", () => {
    const chunk = '{"type":"message","role":"assistant","content":"hello"}\n';
    expect(extractAntigravitySessionId(chunk)).toBeNull();
  });

  it("returns null for empty chunk", () => {
    expect(extractAntigravitySessionId("")).toBeNull();
  });
});

describe("extractAntigravityTouchedEdits", () => {
  it("extracts replace tool with old_string target", () => {
    const chunk = JSON.stringify({
      type: "tool_use",
      tool_name: "replace",
      tool_id: "t1",
      parameters: { file_path: "src/index.ts", old_string: "foo", new_string: "bar" },
    }) + "\n";
    expect(extractAntigravityTouchedEdits(chunk)).toEqual([
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
    expect(extractAntigravityTouchedEdits(chunk)).toEqual([
      { path: "new-file.ts", target: undefined },
    ]);
  });

  it("ignores read_file and shell tools", () => {
    const chunk = [
      JSON.stringify({ type: "tool_use", tool_name: "read_file", parameters: { file_path: "a.ts" } }),
      JSON.stringify({ type: "tool_use", tool_name: "run_shell_command", parameters: { command: "ls" } }),
    ].join("\n") + "\n";
    expect(extractAntigravityTouchedEdits(chunk)).toEqual([]);
  });
});

describe("extractAntigravityTouchedPaths", () => {
  it("returns just paths from edit events", () => {
    const chunk = JSON.stringify({
      type: "tool_use",
      tool_name: "replace",
      tool_id: "t1",
      parameters: { file_path: "a.ts", old_string: "x", new_string: "y" },
    }) + "\n";
    expect(extractAntigravityTouchedPaths(chunk)).toEqual(["a.ts"]);
  });
});

describe("extractAntigravityToolUses", () => {
  it("extracts all tool_use events with summarised target", () => {
    const chunk = [
      JSON.stringify({ type: "tool_use", tool_name: "read_file", parameters: { file_path: "a.ts" } }),
      JSON.stringify({ type: "tool_use", tool_name: "run_shell_command", parameters: { command: "npm test" } }),
      JSON.stringify({ type: "tool_use", tool_name: "grep_search", parameters: { pattern: "TODO" } }),
      JSON.stringify({ type: "tool_use", tool_name: "google_web_search", parameters: { query: "vitest docs" } }),
      JSON.stringify({ type: "tool_use", tool_name: "invoke_agent", parameters: { agent_name: "reviewer" } }),
    ].join("\n") + "\n";
    const uses = extractAntigravityToolUses(chunk);
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
    expect(extractAntigravityToolUses(chunk)).toEqual([]);
  });
});
