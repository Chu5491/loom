import { describe, expect, it } from "vitest";
import { appendPathDirs } from "./env.js";

// POSIX separator assumed (tests run on the dev/CI host).
describe("appendPathDirs", () => {
  it("appends new dirs after the existing PATH", () => {
    expect(appendPathDirs("/usr/bin:/bin", ["/opt/x/bin"])).toBe("/usr/bin:/bin:/opt/x/bin");
  });

  it("keeps existing PATH entries first (real PATH wins)", () => {
    expect(appendPathDirs("/a:/b", ["/b", "/c"])).toBe("/a:/b:/c");
  });

  it("does not duplicate a dir already on PATH", () => {
    expect(appendPathDirs("/a:/b", ["/a"])).toBe("/a:/b");
  });

  it("dedupes repeated extras", () => {
    expect(appendPathDirs("/a", ["/x", "/x", "/y"])).toBe("/a:/x:/y");
  });

  it("handles an empty base PATH", () => {
    expect(appendPathDirs("", ["/x", "/y"])).toBe("/x:/y");
  });
});
