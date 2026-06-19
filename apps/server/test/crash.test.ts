// 프로세스 크래시 가드 — 등록 여부만 검증(핸들러 동작은 process 전역이라 직접 트리거하면
// vitest 자체 rejection 리스너와 얽혀 위험). 방금 추가한 리스너만 제거해 격리.

import { describe, it, expect } from "vitest";
import { installAsyncGuard, installCrashShutdown } from "../src/crash.js";

describe("crash guards", () => {
  it("installAsyncGuard registers an unhandledRejection listener (stray rejection → server survives)", () => {
    const before = process.listenerCount("unhandledRejection");
    installAsyncGuard();
    expect(process.listenerCount("unhandledRejection")).toBe(before + 1);
    const ls = process.listeners("unhandledRejection");
    process.removeListener("unhandledRejection", ls[ls.length - 1] as (...a: unknown[]) => void);
  });

  it("installCrashShutdown registers an uncaughtException listener", () => {
    const before = process.listenerCount("uncaughtException");
    installCrashShutdown(async () => {});
    expect(process.listenerCount("uncaughtException")).toBe(before + 1);
    const ls = process.listeners("uncaughtException");
    process.removeListener("uncaughtException", ls[ls.length - 1] as (...a: unknown[]) => void);
  });
});
