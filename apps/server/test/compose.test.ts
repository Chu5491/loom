import { describe, expect, it } from "vitest";
import { composePrompt } from "../src/run/compose.js";
import type { AgentLoadout } from "../src/run/loadout.js";

const baseLoadout: AgentLoadout = {
  dir: "/tmp/loadout/a",
  readmePath: "/tmp/loadout/a/README.md",
  mcpConfigPath: null,
  skills: [],
  mcpServerNames: [],
  delegate: null,
};

describe("composePrompt", () => {
  it("keeps the user prompt last and rules first", () => {
    const out = composePrompt({ userPrompt: "do it", rules: ["be kind"], agentPrompt: "you are x" });
    expect(out.indexOf("be kind")).toBeLessThan(out.indexOf("you are x"));
    expect(out.trim().endsWith("do it")).toBe(true);
  });

  it("omits the loadout block when there is nothing to expose", () => {
    const out = composePrompt({ userPrompt: "p", rules: [], loadout: baseLoadout });
    expect(out).not.toContain("=== Loadout ===");
  });

  it("mentions project memory path only when provided — body never injected", () => {
    const withNotes = composePrompt({ userPrompt: "p", rules: [], projectNotesPath: "/work/proj/.loom/notes.md" });
    expect(withNotes).toContain("=== Project Memory ===");
    expect(withNotes).toContain("/work/proj/.loom/notes.md");
    const without = composePrompt({ userPrompt: "p", rules: [], projectNotesPath: null });
    expect(without).not.toContain("Project Memory");
  });

  it("points to the analysis doc so other CLIs can read prior project understanding", () => {
    const out = composePrompt({ userPrompt: "p", rules: [], projectAnalysisPath: "/work/proj/.loom/analysis.md" });
    expect(out).toContain("=== Project Memory ===");
    expect(out).toContain("/work/proj/.loom/analysis.md");
    expect(out).toContain("read-only");
  });

  it("lists notes and analysis together when both exist", () => {
    const out = composePrompt({
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
    const out = composePrompt({
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
