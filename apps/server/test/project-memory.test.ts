import { describe, expect, it } from "vitest";
import { analysisReportSchema, renderAnalysisMarkdown, type AnalysisRecord } from "../src/run/project-memory.js";

function record(report: unknown): AnalysisRecord {
  return {
    analyzedAt: "2026-06-13T09:30:00.000Z",
    agent: "codex-t",
    runId: "r1",
    report: analysisReportSchema.parse(report),
  };
}

describe("renderAnalysisMarkdown", () => {
  it("notes who analyzed and when so another agent knows the source", () => {
    const md = renderAnalysisMarkdown(record({ summary: "A todo API." }));
    expect(md).toContain("# Project Analysis");
    expect(md).toContain("@codex-t");
    expect(md).toContain("2026-06-13 09:30");
    expect(md).toContain("A todo API.");
  });

  it("renders stack, health table, risks and suggestions", () => {
    const md = renderAnalysisMarkdown(
      record({
        summary: "s",
        stack: ["TypeScript", "Hono"],
        health: { tests: 40, docs: 70 },
        risks: [{ text: "no tests", severity: "high" }],
        suggestions: ["add CI"],
      }),
    );
    expect(md).toContain("- TypeScript");
    expect(md).toContain("| tests | docs |");
    expect(md).toContain("| 40 | 70 |");
    expect(md).toContain("- [high] no tests");
    expect(md).toContain("- [medium] add CI"); // 문자열 suggestion 은 medium 으로 정규화
  });

  it("omits empty sections — a thin report stays short", () => {
    const md = renderAnalysisMarkdown(record({ summary: "minimal" }));
    expect(md).not.toContain("## Risks");
    expect(md).not.toContain("## Health");
    expect(md).not.toContain("## Stack");
  });
});
