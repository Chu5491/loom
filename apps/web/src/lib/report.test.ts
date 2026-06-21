import { describe, it, expect } from "vitest";
import { extractReport } from "./report.js";

describe("extractReport", () => {
  it("returns the body unchanged when there is no loom-report fence", () => {
    expect(extractReport("just an answer")).toEqual({ body: "just an answer" });
  });

  it("extracts a closed loom-report fence and strips it from the body", () => {
    const body = 'Here is the result.\n```loom-report\n{"summary":"did X","steps":["a","b"]}\n```';
    const { body: out, report } = extractReport(body);
    expect(out).toBe("Here is the result.");
    expect(report).toEqual({ summary: "did X", steps: ["a", "b"] });
  });

  it("handles an unclosed trailing fence (verbose / plain-text CLI)", () => {
    const body = 'answer\n```loom-report\n{"summary":"S"}';
    const { body: out, report } = extractReport(body);
    expect(out).toBe("answer");
    expect(report).toEqual({ summary: "S" });
  });

  it('de-escapes \\" inside the fence (some CLIs escape quotes)', () => {
    const body = '```loom-report\n{\\"summary\\":\\"esc\\"}\n```';
    expect(extractReport(body).report).toEqual({ summary: "esc" });
  });
});
