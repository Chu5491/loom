import { describe, it, expect } from "vitest";
import { buildCodexCommand, codexAdapter } from "./index.js";

describe("buildCodexCommand", () => {
  it("defaults: codex exec --json -", () => {
    const { command, args } = buildCodexCommand();
    expect(command).toBe("codex");
    expect(args).toEqual(["exec", "--json", "-"]);
  });

  it("appends --model when configured", () => {
    const { args } = buildCodexCommand({ model: "o4-mini" });
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("o4-mini");
  });

  it("encodes reasoningEffort as -c override", () => {
    const { args } = buildCodexCommand({ reasoningEffort: "high" });
    const i = args.indexOf("-c");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe('model_reasoning_effort="high"');
  });

  it("inserts --search when enabled", () => {
    expect(buildCodexCommand({ search: true }).args).toContain("--search");
  });

  it("inserts bypass flag only when enabled", () => {
    expect(buildCodexCommand().args).not.toContain(
      "--dangerously-bypass-approvals-and-sandbox",
    );
    expect(
      buildCodexCommand({ dangerouslyBypassApprovalsAndSandbox: true }).args,
    ).toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("appends --cd when configured", () => {
    const { args } = buildCodexCommand({ cd: "/repo" });
    expect(args[args.indexOf("--cd") + 1]).toBe("/repo");
  });

  it("trailing `-` always remains last so stdin is honored", () => {
    const cases = [
      buildCodexCommand({ model: "x" }).args,
      buildCodexCommand({ extraArgs: ["--foo", "bar"] }).args,
      buildCodexCommand({ search: true, model: "x" }).args,
    ];
    for (const args of cases) expect(args[args.length - 1]).toBe("-");
  });
});

describe("codexAdapter", () => {
  it("identifies as codex", () => {
    expect(codexAdapter.kind).toBe("codex");
  });
});
