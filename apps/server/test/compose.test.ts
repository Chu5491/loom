import { describe, expect, it } from "vitest";
import { composePrompt, joinPrompt } from "../src/run/compose.js";
import type { ComposeInput } from "../src/run/compose.js";
import type { AgentLoadout } from "../src/run/loadout.js";

const baseLoadout: AgentLoadout = {
  dir: "/tmp/loadout/a",
  readmePath: "/tmp/loadout/a/README.md",
  mcpConfigPath: null,
  skills: [],
  mcpServerNames: [],
  delegate: null,
};

// 시스템 채널 없는 CLI(codex·opencode·antigravity)와 프리뷰가 보는 합쳐진 전체 프롬프트.
const full = (i: ComposeInput) => joinPrompt(composePrompt(i));

describe("composePrompt (joined view — what non-system CLIs receive)", () => {
  it("keeps the user prompt last and rules first", () => {
    const out = full({ userPrompt: "do it", rules: ["be kind"], agentPrompt: "you are x" });
    expect(out.indexOf("be kind")).toBeLessThan(out.indexOf("you are x"));
    expect(out.trim().endsWith("do it")).toBe(true);
  });

  it("omits the loadout block when there is nothing to expose", () => {
    const out = full({ userPrompt: "p", rules: [], loadout: baseLoadout });
    expect(out).not.toContain("=== Loadout ===");
  });

  it("on resume, skips rules and persona but keeps loadout + user prompt", () => {
    const out = full({
      userPrompt: "next turn",
      rules: ["be kind"],
      agentPrompt: "you are x",
      loadout: { ...baseLoadout, skills: [{ name: "nuxt", relPath: "skills/nuxt.md" }] },
      resuming: true,
    });
    expect(out).not.toContain("be kind"); // rules 재주입 안 함
    expect(out).not.toContain("you are x"); // 페르소나 재주입 안 함
    expect(out).toContain("=== Loadout ==="); // 경로는 run마다 바뀌어 다시 안내
    expect(out.trim().endsWith("next turn")).toBe(true);
  });

  it("on a fresh (non-resume) turn, includes rules and persona", () => {
    const out = full({ userPrompt: "p", rules: ["be kind"], agentPrompt: "you are x", resuming: false });
    expect(out).toContain("be kind");
    expect(out).toContain("you are x");
  });

  it("mentions project memory path only when provided — body never injected", () => {
    const withNotes = full({ userPrompt: "p", rules: [], projectNotesPath: "/work/proj/.loom/notes.md" });
    expect(withNotes).toContain("=== Project Memory ===");
    expect(withNotes).toContain("/work/proj/.loom/notes.md");
    const without = full({ userPrompt: "p", rules: [], projectNotesPath: null });
    expect(without).not.toContain("Project Memory");
  });

  it("points to the analysis doc so other CLIs can read prior project understanding", () => {
    const out = full({ userPrompt: "p", rules: [], projectAnalysisPath: "/work/proj/.loom/analysis.md" });
    expect(out).toContain("=== Project Memory ===");
    expect(out).toContain("/work/proj/.loom/analysis.md");
    expect(out).toContain("read-only");
  });

  it("lists notes and analysis together when both exist", () => {
    const out = full({
      userPrompt: "p",
      rules: [],
      projectNotesPath: "/p/.loom/notes.md",
      projectAnalysisPath: "/p/.loom/analysis.md",
    });
    expect(out).toContain("/p/.loom/notes.md");
    expect(out).toContain("/p/.loom/analysis.md");
    // 단일 Project Memory 섹션 안에 둘 다
    expect(out.match(/=== Project Memory ===/g)?.length).toBe(1);
  });

  it("renders the delegate shell bridge for MCP-less CLIs", () => {
    const out = full({
      userPrompt: "p",
      rules: [],
      loadout: {
        ...baseLoadout,
        delegate: { scriptPath: "/tmp/loadout/a/delegate.sh", teammates: ["reviewer", "devin"] },
      },
    });
    expect(out).toContain("sh /tmp/loadout/a/delegate.sh");
    expect(out).toContain("reviewer, devin");
  });
});

describe("composePrompt (system/user split — claude's system channel)", () => {
  it("puts rules + persona in system, loadout + user input in user", () => {
    const out = composePrompt({
      userPrompt: "do it",
      rules: ["be kind"],
      agentPrompt: "you are x",
      loadout: { ...baseLoadout, skills: [{ name: "nuxt", relPath: "skills/nuxt.md" }] },
    });
    expect(out.system).toContain("be kind");
    expect(out.system).toContain("you are x");
    expect(out.system).not.toContain("=== Loadout ===");
    expect(out.user).toContain("=== Loadout ===");
    expect(out.user.trim().endsWith("do it")).toBe(true);
    expect(out.user).not.toContain("be kind"); // 페르소나·규약은 user 채널에 안 샌다
  });

  it("on resume, system is empty (already in the session) and user carries the turn", () => {
    const out = composePrompt({
      userPrompt: "next turn",
      rules: ["be kind"],
      agentPrompt: "you are x",
      resuming: true,
    });
    expect(out.system).toBe("");
    expect(out.user.trim().endsWith("next turn")).toBe(true);
  });

  it("joinPrompt reproduces the system-then-user order with a blank-line seam", () => {
    const composed = composePrompt({ userPrompt: "p", rules: ["r"], agentPrompt: "a" });
    expect(joinPrompt(composed)).toBe(`${composed.system}\n\n${composed.user}`);
  });

  it("joinPrompt returns user verbatim when there is no system (resume / no rules)", () => {
    const composed = composePrompt({ userPrompt: "p", rules: [], resuming: true });
    expect(composed.system).toBe("");
    expect(joinPrompt(composed)).toBe(composed.user);
  });
});
