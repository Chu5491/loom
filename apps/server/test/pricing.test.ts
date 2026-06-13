import { describe, expect, it } from "vitest";
import { estimateCost } from "../src/run/pricing.js";

describe("estimateCost", () => {
  it("returns null when there are no tokens to price", () => {
    expect(estimateCost("gpt-5.4-mini")).toBeNull();
    expect(estimateCost("gpt-5.4-mini", 0, 0)).toBeNull();
  });

  it("prices known models by input/output rate", () => {
    // gpt-5.4-mini: in $0.25/M, out $2/M. 1M in + 1M out = 0.25 + 2 = 2.25
    expect(estimateCost("gpt-5.4-mini", 1_000_000, 1_000_000)).toBeCloseTo(2.25, 6);
  });

  it("matches model id by substring (codex passes full ids)", () => {
    expect(estimateCost("openai/gpt-4o-mini", 1_000_000, 0)).toBeCloseTo(0.15, 6);
  });

  it("falls back to a conservative default for unknown models", () => {
    // DEFAULT in $1/M — 1M input tokens = $1
    expect(estimateCost("some-unknown-model", 1_000_000, 0)).toBeCloseTo(1, 6);
  });
});
