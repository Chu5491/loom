import { describe, expect, it } from "vitest";
import { composePrompt } from "../src/services/run/prompt-composer.js";

describe("composePrompt", () => {
  it("renders all three rule layers in order: global > project > agent", () => {
    const result = composePrompt({
      userPrompt: "do something",
      globalRule: "workspace level",
      projectRule: "project level",
      agentPrompt: "agent level",
    });
    const gIdx = result.indexOf("Workspace Rules");
    const pIdx = result.indexOf("Project Rules");
    const aIdx = result.indexOf("Agent Instructions");
    const uIdx = result.indexOf("do something");
    expect(gIdx).toBeLessThan(pIdx);
    expect(pIdx).toBeLessThan(aIdx);
    expect(aIdx).toBeLessThan(uIdx);
  });

  it("omits project rule section when empty", () => {
    const result = composePrompt({
      userPrompt: "hello",
      globalRule: "global",
      projectRule: "",
      agentPrompt: "agent",
    });
    expect(result).not.toContain("Project Rules");
    expect(result).toContain("Workspace Rules");
    expect(result).toContain("Agent Instructions");
  });

  it("omits project rule section when undefined", () => {
    const result = composePrompt({
      userPrompt: "hello",
      globalRule: "global",
    });
    expect(result).not.toContain("Project Rules");
  });

  it("only outputs user prompt when no rules are set", () => {
    const result = composePrompt({ userPrompt: "bare prompt" });
    expect(result).toBe("bare prompt");
  });

  it("places thread context between loadout and user prompt", () => {
    const result = composePrompt({
      userPrompt: "task",
      globalRule: "g",
      projectRule: "p",
      agentPrompt: "a",
      threadContext: "prior conversation summary",
    });
    const aIdx = result.indexOf("Agent Instructions");
    const cIdx = result.indexOf("Thread Context");
    const uIdx = result.indexOf("task");
    expect(aIdx).toBeLessThan(cIdx);
    expect(cIdx).toBeLessThan(uIdx);
  });
});
