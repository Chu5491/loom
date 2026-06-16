// 보존 스윕 — 오래된 끝난 run 만 정리하고 최신·실행중 run 은 남기는지.
// 로그 파일 삭제(engine)는 모킹 — DB 정리 + 컷오프 판정만 검증한다.

import { afterAll, describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RunInfo } from "@loom/core";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "loom-retention-test-"));
process.env.LOOM_HOME = home;
process.env.LOOM_RETENTION_DAYS = "30";

vi.mock("../src/run/engine.js", () => ({ deleteRunFiles: vi.fn() }));

const db = await import("../src/db.js");
const { sweepOldRuns, retentionCutoff } = await import("../src/run/retention.js");

afterAll(() => {
  db.closeDb();
  fs.rmSync(home, { recursive: true, force: true });
});

const DAY = 24 * 60 * 60 * 1000;

function finished(id: string, endedAtMs: number): RunInfo {
  return {
    id, agent: "claude", prompt: "p", status: "succeeded",
    startedAt: new Date(endedAtMs - 1000).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    exitCode: 0, parentRunId: null, projectId: null, threadId: null, costUsd: null,
  };
}

describe("retentionCutoff", () => {
  it("returns null when retention is disabled", () => {
    expect(retentionCutoff(Date.now(), 0)).toBeNull();
  });
  it("returns the iso 'days' before now", () => {
    const now = Date.parse("2026-06-16T00:00:00.000Z");
    expect(retentionCutoff(now, 30)).toBe("2026-05-17T00:00:00.000Z");
  });
});

describe("sweepOldRuns", () => {
  it("removes runs ended before the cutoff, keeps recent and running ones", () => {
    const now = Date.now();
    // 40일 전 종료 — 정리 대상.
    const old = finished("old", now - 40 * DAY);
    db.insertRun({ ...old, status: "running", endedAt: null });
    db.appendEvent("old", 0, { kind: "text", text: "x" });
    db.finishRun(old, {});
    // 1일 전 종료 — 보존.
    const recent = finished("recent", now - 1 * DAY);
    db.insertRun({ ...recent, status: "running", endedAt: null });
    db.finishRun(recent, {});
    // 진행 중 — 종료 안 됨이라 절대 정리 안 함.
    db.insertRun({ ...finished("live", now), status: "running", endedAt: null });

    const removed = sweepOldRuns(now);

    expect(removed).toBe(1);
    expect(db.getRunDb("old")).toBeNull();
    expect(db.getRunEventsDb("old")).toEqual([]); // 이벤트도 cascade 삭제
    expect(db.getRunDb("recent")).not.toBeNull();
    expect(db.getRunDb("live")).not.toBeNull();
  });
});
