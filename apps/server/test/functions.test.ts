// 기능(Functions) 로더 — frontmatter(adapter/model) + 본문(prompt) 왕복, 기본값 폴백.

import { afterEach, beforeEach, describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "loom-fn-test-"));
process.env.LOOM_HOME = home;

const office = await import("../src/office.js");

beforeEach(() => {
  fs.rmSync(path.join(home, "office", "prompts"), { recursive: true, force: true });
});
afterEach(() => {
  fs.rmSync(path.join(home, "office", "prompts"), { recursive: true, force: true });
});

describe("readFunction", () => {
  it("falls back to default model when no file exists", () => {
    const fn = office.readFunction("analysis");
    expect(fn.name).toBe("analysis");
    expect(fn.adapter).toBe("codex"); // DEFAULT_FUNCTION_MODELS
    expect(fn.model).toBe("gpt-5.5");
    expect(fn.prompt.length).toBeGreaterThan(0); // 기본 지침
  });

  it("round-trips adapter+model+prompt via writeFunction (frontmatter)", () => {
    office.writeFunction("git-commit", { prompt: "Write a tidy commit.", adapter: "claude-code", model: "claude-opus-4-8" });
    const fn = office.readFunction("git-commit");
    expect(fn.adapter).toBe("claude-code");
    expect(fn.model).toBe("claude-opus-4-8");
    expect(fn.prompt).toBe("Write a tidy commit.");
  });

  it("readFeaturePrompt returns only the body, not the frontmatter", () => {
    office.writeFunction("analysis", { prompt: "Body only.", adapter: "codex", model: "gpt-5.5" });
    const body = office.readFeaturePrompt("analysis");
    expect(body).toBe("Body only.");
    expect(body).not.toContain("adapter:"); // frontmatter 제거됨
  });

  it("every feature prompt is a function — standup and meeting included", () => {
    expect(office.isFunctionName("analysis")).toBe(true);
    expect(office.isFunctionName("standup")).toBe(true);
    expect(office.isFunctionName("meeting")).toBe(true);
  });

  it("standup and meeting fall back to a default model like other functions", () => {
    for (const name of ["standup", "meeting"] as const) {
      const fn = office.readFunction(name);
      expect(fn.name).toBe(name);
      expect(fn.adapter).toBe("claude-code");
      expect(fn.prompt.length).toBeGreaterThan(0);
    }
  });
});
