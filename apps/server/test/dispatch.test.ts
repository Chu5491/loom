// 스마트 디스패치 점수 — 스킬 매칭이 자기소개 매칭보다 무겁고, 0점이면 첫 에이전트.

import { describe, it, expect } from "vitest";
import type { AgentSpec, SkillSpec } from "@loom/core";
import { pickAgent, scoreAgent } from "../src/run/dispatch.js";

const skills: SkillSpec[] = [
  { name: "api-conventions", description: "REST API design rules and error codes", body: "" },
  { name: "commit-style", description: "커밋 메시지 작성 규칙", body: "" },
];
const agents: AgentSpec[] = [
  { name: "coder", adapter: "claude-code", prompt: "You are a backend engineer." },
  { name: "api-expert", adapter: "codex", prompt: "You design APIs.", skills: ["api-conventions"] },
  { name: "scribe", adapter: "devin", prompt: "You write commit messages.", skills: ["commit-style"] },
];

describe("pickAgent", () => {
  it("routes API work to the agent holding the matching skill", () => {
    const pick = pickAgent("design the REST error codes for the new API", agents, skills);
    expect(pick?.agent).toBe("api-expert");
  });

  it("routes commit work to the commit-style holder (Korean tokens)", () => {
    const pick = pickAgent("이번 변경의 커밋 메시지 좀 써줘", agents, skills);
    expect(pick?.agent).toBe("scribe");
  });

  it("falls back to the first agent when nothing matches", () => {
    const pick = pickAgent("zzz qqq", agents, skills);
    expect(pick?.agent).toBe("coder");
    expect(pick?.score).toBe(0);
  });

  it("skill match outweighs prompt-only match", () => {
    // "api" 는 coder prompt 에 없음, api-expert 는 스킬(2점)+prompt(1점).
    const a = scoreAgent("api", agents[1]!, skills);
    const b = scoreAgent("api", agents[0]!, skills);
    expect(a.score).toBeGreaterThan(b.score);
  });

  it("returns null with no agents", () => {
    expect(pickAgent("anything", [], skills)).toBeNull();
  });
});
