import { describe, it, expect } from "vitest";
import { streamStatusOnError, parsePayload } from "./stream.js";

describe("streamStatusOnError", () => {
  it("CLOSED while still running → failed", () => {
    expect(streamStatusOnError(true, "running")).toBe("failed");
  });

  it("CLOSED after a terminal status → preserves it (no false failure)", () => {
    expect(streamStatusOnError(true, "succeeded")).toBe("succeeded");
    expect(streamStatusOnError(true, "cancelled")).toBe("cancelled");
  });

  it("not CLOSED (browser auto-reconnecting) → status unchanged", () => {
    expect(streamStatusOnError(false, "running")).toBe("running");
  });
});

describe("parsePayload", () => {
  it("parses a valid JSON line", () => {
    expect(parsePayload<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it("returns null on a broken/empty line instead of throwing", () => {
    expect(parsePayload("{broken")).toBeNull();
    expect(parsePayload("")).toBeNull();
  });
});
