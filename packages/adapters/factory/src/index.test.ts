import { describe, it, expect } from "vitest";
import {
  buildDroidCommand,
  extractDroidSessionId,
  factoryAdapter,
  DROID_PRESET_MODELS,
} from "./index.js";

describe("buildDroidCommand", () => {
  it("defaults: droid exec --output-format json --auto low", () => {
    const { command, args } = buildDroidCommand();
    expect(command).toBe("droid");
    // 기본 --auto low — droid 기본 read-only 면 파일 편집이 막혀 코딩이 실패하므로.
    expect(args).toEqual(["exec", "--output-format", "json", "--auto", "low"]);
  });

  it("bypass uses --skip-permissions-unsafe instead of --auto", () => {
    const { args } = buildDroidCommand({ dangerouslySkipPermissions: true });
    expect(args).toContain("--skip-permissions-unsafe");
    expect(args).not.toContain("--auto");
  });

  it("respects an explicit autonomy level", () => {
    const { args } = buildDroidCommand({ auto: "medium" });
    expect(args[args.indexOf("--auto") + 1]).toBe("medium");
  });

  it("appends --model when set", () => {
    const { args } = buildDroidCommand({ model: "claude-opus-4-8" });
    expect(args[args.indexOf("--model") + 1]).toBe("claude-opus-4-8");
  });

  it("appends --reasoning-effort when set", () => {
    const { args } = buildDroidCommand({ reasoningEffort: "high" });
    expect(args[args.indexOf("--reasoning-effort") + 1]).toBe("high");
  });

  it("appends --cwd when set", () => {
    const { args } = buildDroidCommand({ cwd: "/repo" });
    expect(args[args.indexOf("--cwd") + 1]).toBe("/repo");
  });

  it("appends extraArgs verbatim", () => {
    const { args } = buildDroidCommand({ extraArgs: ["--tag", "ci"] });
    expect(args.slice(-2)).toEqual(["--tag", "ci"]);
  });

  it("respects command override", () => {
    expect(buildDroidCommand({ command: "/opt/droid" }).command).toBe("/opt/droid");
  });

  it("does not put the prompt in args (prompt is via stdin)", () => {
    const { args } = buildDroidCommand({ model: "x" });
    expect(args).not.toContain("-");
    expect(args.join(" ")).not.toContain("prompt");
  });
});

describe("extractDroidSessionId", () => {
  it("pulls session_id from the final result object", () => {
    const line = JSON.stringify({ type: "result", subtype: "success", result: "ok", session_id: "sess-abc" });
    expect(extractDroidSessionId(line)).toBe("sess-abc");
  });

  it("returns null when no result/session_id is present", () => {
    expect(extractDroidSessionId('{"type":"text","part":{"text":"hi"}}')).toBeNull();
    expect(extractDroidSessionId("plain text, not json")).toBeNull();
  });
});

describe("factoryAdapter", () => {
  it("identifies as factory and supports the system-prompt channel", () => {
    expect(factoryAdapter.kind).toBe("factory");
    expect(factoryAdapter.supportsSystemPrompt).toBe(true);
  });

  it("ships preset models across managed providers", () => {
    const cats = new Set(DROID_PRESET_MODELS.map((m) => m.category));
    expect(cats.has("Anthropic")).toBe(true);
    expect(cats.has("OpenAI")).toBe(true);
    expect(cats.has("Google")).toBe(true);
  });
});
