import { describe, it, expect } from "vitest";
import {
  routePrompt,
  _parseMentions,
  _stripMentions,
} from "../src/services/run/prompt-router.js";
import type { Agent } from "@loom/core";

function agent(id: string, mentionName: string | null): Agent {
  return {
    id,
    projectId: "proj-1",
    name: mentionName ?? id,
    mentionName,
    prompt: "",
    skillIds: [],
    mcpServerIds: [],
    role: null,
    adapterKind: "claude-code",
    adapterConfig: {},
    defaultCwd: null,
    createdAt: "",
    updatedAt: "",
  };
}

describe("_parseMentions", () => {
  it("extracts @mention from text", () => {
    const tokens = _parseMentions("@claude do this");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.name).toBe("claude");
  });

  it("extracts multiple mentions", () => {
    const tokens = _parseMentions("@claude refactor @gemini write tests");
    expect(tokens).toHaveLength(2);
    expect(tokens.map((t) => t.name)).toEqual(["claude", "gemini"]);
  });

  it("ignores mentions in the middle of words", () => {
    expect(_parseMentions("email@test")).toHaveLength(0);
  });

  it("handles @all", () => {
    const tokens = _parseMentions("@all check this");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.name).toBe("all");
  });
});

describe("_stripMentions", () => {
  it("removes mention tags and collapses whitespace", () => {
    const mentions = _parseMentions("@claude do this");
    expect(_stripMentions("@claude do this", mentions)).toBe("do this");
  });

  it("handles multiple mentions", () => {
    const text = "@claude refactor @gemini tests";
    const mentions = _parseMentions(text);
    expect(_stripMentions(text, mentions)).toBe("refactor tests");
  });
});

describe("routePrompt", () => {
  const claude = agent("a1", "claude");
  const gemini = agent("a2", "gemini");
  const agents = [claude, gemini];
  const defaultId = "a1";

  it("sends to default agent when no mentions", () => {
    const result = routePrompt("refactor this function", agents, defaultId);
    expect(result).toEqual([
      { agentId: "a1", prompt: "refactor this function" },
    ]);
  });

  it("routes single mention to the correct agent", () => {
    const result = routePrompt("@gemini write tests", agents, defaultId);
    expect(result).toEqual([{ agentId: "a2", prompt: "write tests" }]);
  });

  it("routes multiple mentions to separate agents", () => {
    const result = routePrompt(
      "@claude refactor @gemini write tests",
      agents,
      defaultId,
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ agentId: "a1", prompt: "refactor" });
    expect(result[1]).toEqual({ agentId: "a2", prompt: "write tests" });
  });

  it("broadcasts @all to all agents", () => {
    const result = routePrompt("@all check this", agents, defaultId);
    expect(result).toHaveLength(2);
    expect(result[0]!.agentId).toBe("a1");
    expect(result[1]!.agentId).toBe("a2");
    expect(result[0]!.prompt).toBe("check this");
    expect(result[1]!.prompt).toBe("check this");
  });

  it("falls back to default for unknown mention", () => {
    const result = routePrompt("@unknown do this", agents, defaultId);
    expect(result).toHaveLength(1);
    expect(result[0]!.agentId).toBe(defaultId);
  });
});
