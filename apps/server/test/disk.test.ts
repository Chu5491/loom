// 디스크 여유 임계 판정(순수). statfs I/O 는 환경 의존이라 제외.

import { describe, it, expect } from "vitest";
import { isBelowFree } from "../src/run/disk.js";

const MB = 1024 * 1024;

describe("isBelowFree", () => {
  it("flags free space below the threshold", () => {
    expect(isBelowFree(50 * MB, 200)).toBe(true);
  });
  it("passes when free space meets or exceeds the threshold", () => {
    expect(isBelowFree(200 * MB, 200)).toBe(false);
    expect(isBelowFree(500 * MB, 200)).toBe(false);
  });
  it("is disabled when minFreeMb is 0 (never blocks)", () => {
    expect(isBelowFree(0, 0)).toBe(false);
  });
});
