import { describe, it, expect } from "vitest";
import { applyPrompt } from "@loom/adapter-utils";
import {
  buildDevinCommand,
  devinAdapter,
  DEVIN_PRESET_MODELS,
} from "./index.js";

describe("buildDevinCommand", () => {
  it("defaults: devin with no flags", () => {
    const { command, args } = buildDevinCommand();
    expect(command).toBe("devin");
    expect(args).toEqual([]);
  });

  it("adds --model when set", () => {
    expect(buildDevinCommand({ model: "claude-opus-4.6" }).args).toEqual([
      "--model",
      "claude-opus-4.6",
    ]);
  });

  it("maps dangerouslySkipPermissions to --permission-mode dangerous", () => {
    expect(buildDevinCommand({ dangerouslySkipPermissions: true }).args).toEqual([
      "--permission-mode",
      "dangerous",
    ]);
    expect(buildDevinCommand().args).not.toContain("--permission-mode");
  });

  it("appends extraArgs at the end", () => {
    expect(buildDevinCommand({ extraArgs: ["--sandbox"] }).args).toEqual([
      "--sandbox",
    ]);
  });

  it("respects command override", () => {
    expect(buildDevinCommand({ command: "/usr/local/bin/devin" }).command).toBe(
      "/usr/local/bin/devin",
    );
  });
});

describe("devin prompt delivery", () => {
  it("passes the prompt via --print (non-interactive), not stdin", () => {
    const { args, stdin } = applyPrompt(
      buildDevinCommand({ model: "opus" }).args,
      "fix the login bug",
      { via: "arg", flag: "--print" },
    );
    expect(args).toEqual(["--model", "opus", "--print", "fix the login bug"]);
    expect(stdin).toBe("");
  });
});

describe("devinAdapter", () => {
  it("identifies as devin", () => {
    expect(devinAdapter.kind).toBe("devin");
  });
});

describe("DEVIN_PRESET_MODELS", () => {
  it("every entry has value, label, and category", () => {
    expect(DEVIN_PRESET_MODELS.length).toBeGreaterThan(0);
    for (const m of DEVIN_PRESET_MODELS) {
      expect(m.value).toBeTruthy();
      expect(m.label).toBeTruthy();
      expect(m.category).toBeTruthy();
    }
  });
});
