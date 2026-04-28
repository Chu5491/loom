import { describe, it, expect } from "vitest";
import { buildClaudeCommand, claudeCodeAdapter } from "./index.js";

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
});
