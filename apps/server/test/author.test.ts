import { describe, expect, it } from "vitest";
import { extractJson } from "../src/run/author.js";
import { sanitizeAgentDraft } from "../src/run/agent-author.js";
import { parseSkillsFind } from "../src/run/skills-cli.js";

describe("extractJson", () => {
  it("pulls JSON out of a ```json fence with surrounding prose", () => {
    const out = "Here is the agent:\n```json\n{\"name\":\"x\",\"adapter\":\"codex\"}\n```\nDone.";
    expect(extractJson(out)).toEqual({ name: "x", adapter: "codex" });
  });

  it("handles a bare object with no fence", () => {
    expect(extractJson('  {"a":1}  ')).toEqual({ a: 1 });
  });

  it("ignores braces inside strings when matching the closing brace", () => {
    expect(extractJson('{"prompt":"use {curly} braces","n":2}')).toEqual({ prompt: "use {curly} braces", n: 2 });
  });

  it("survives a body string that itself contains ``` code fences and braces", () => {
    // 실측 회귀: skill-author 가 마크다운 body 를 돌려주면 그 안에 ```json {…} 펜스가
    // 들어있어, 펜스 정규식 방식은 깨졌다. brace-matching 은 견뎌야 한다.
    const out =
      '```json\n{"description":"d","body":"# Title\\n```json\\n{\\"a\\":1}\\n```\\nmore {x} text"}\n```';
    const j = extractJson(out) as { description: string; body: string };
    expect(j.description).toBe("d");
    expect(j.body).toContain("```json");
    expect(j.body).toContain("more {x} text");
  });

  it("skips prose braces before the real object", () => {
    expect(extractJson("note: use {curly} then: {\"ok\":true}")).toEqual({ ok: true });
  });

  it("throws when there is no JSON object", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("sanitizeAgentDraft", () => {
  const names = {
    skills: new Set(["api-conventions", "commit-style"]),
    mcp: new Set(["github"]),
    rules: new Set(["global"]),
    adapters: new Set(["claude-code", "codex"]),
  };

  it("keeps only existing skill/mcp/rule references and warns on the rest", () => {
    const { draft, warnings } = sanitizeAgentDraft(
      { name: "reviewer", adapter: "codex", skills: ["api-conventions", "ghost-skill"], mcp: ["github"], rules: ["nope"] },
      names,
      "claude-code",
    );
    expect(draft.skills).toEqual(["api-conventions"]);
    expect(draft.mcp).toEqual(["github"]);
    expect(draft.rules).toBeUndefined(); // 'nope' dropped → empty → omitted
    expect(warnings.some((w) => w.includes("ghost-skill"))).toBe(true);
    expect(warnings.some((w) => w.includes("nope"))).toBe(true);
  });

  it("clamps an unknown adapter to the fallback and warns", () => {
    const { draft, warnings } = sanitizeAgentDraft({ name: "x", adapter: "made-up" }, names, "claude-code");
    expect(draft.adapter).toBe("claude-code");
    expect(warnings.some((w) => w.includes("made-up"))).toBe(true);
  });

  it("drops invalid enum values (reasoning/permission) silently", () => {
    const { draft } = sanitizeAgentDraft(
      { name: "x", adapter: "codex", reasoning: "turbo", permission: "yolo" },
      names,
      "claude-code",
    );
    expect(draft.reasoning).toBeUndefined();
    expect(draft.permission).toBeUndefined();
  });

  it("sanitizes the name to safe chars", () => {
    const { draft } = sanitizeAgentDraft({ name: "My Agent!", adapter: "codex" }, names, "claude-code");
    expect(draft.name).toBe("MyAgent");
  });
});

describe("parseSkillsFind", () => {
  // ANSI 색코드가 섞인 실제 `npx skills find` 출력 형태.
  const raw =
    "[38;5;102mInstall with[0m npx skills add <owner/repo@skill>\n\n" +
    "[38;5;145mvercel-labs/json-render@react[0m [36m2.5K installs[0m\n" +
    "[38;5;102m└ https://skills.sh/vercel-labs/json-render/react[0m\n\n" +
    "[38;5;145maradotso/trending-skills@foo[0m [36m826 installs[0m\n" +
    "[38;5;102m└ https://skills.sh/aradotso/trending-skills/foo[0m\n";

  it("extracts pkg, installs (K-suffix), url, and source owner", () => {
    const out = parseSkillsFind(raw);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      pkg: "vercel-labs/json-render@react",
      installs: 2500,
      url: "https://skills.sh/vercel-labs/json-render/react",
      source: "vercel-labs",
    });
    expect(out[1]!.installs).toBe(826);
    expect(out[1]!.source).toBe("aradotso");
  });

  it("returns empty for output with no skill lines", () => {
    expect(parseSkillsFind("No skills found for \"xyz\"")).toEqual([]);
  });
});
