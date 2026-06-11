// 런 기록 영속의 라운드트립 — insert→append→finish 후 list/get/events 로 복원되는지.
// 핵심 보장: 인메모리와 무관하게 디스크(sqlite)만으로 run+이벤트가 되살아난다.

import { afterAll, beforeAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OfficeEvent, RunInfo } from "@loom/core";

// config.ts 가 import 시점에 LOOM_HOME 을 읽으므로, db 모듈 import 전에 임시 폴더로 박는다.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "loom-db-test-"));
process.env.LOOM_HOME = home;

const db = await import("../src/db.js");

afterAll(() => {
  db.closeDb();
  fs.rmSync(home, { recursive: true, force: true });
});

function run(id: string): RunInfo {
  return {
    id,
    agent: "claude",
    prompt: "hello",
    status: "running",
    startedAt: "2026-06-10T00:00:00.000Z",
    endedAt: null,
    exitCode: null,
    parentRunId: null,
    projectId: null,
    threadId: null,
    costUsd: null,
  };
}

describe("run history persistence", () => {
  it("round-trips a run with events through finish", () => {
    const r = run("r1");
    db.insertRun(r);

    const events: OfficeEvent[] = [
      { kind: "text", text: "hi" },
      { kind: "result", text: "hi", costUsd: 0.01, sessionId: "s1" },
    ];
    events.forEach((e, i) => db.appendEvent("r1", i, e));

    db.finishRun(
      { ...r, status: "succeeded", endedAt: "2026-06-10T00:00:05.000Z", exitCode: 0 },
      { costUsd: 0.01, sessionId: "s1" },
    );

    const got = db.getRunDb("r1");
    expect(got?.status).toBe("succeeded");
    expect(got?.exitCode).toBe(0);
    expect(db.getRunEventsDb("r1")).toEqual(events);
  });

  it("lists runs newest-first and returns null for unknown id", () => {
    db.insertRun({ ...run("r2"), startedAt: "2026-06-10T01:00:00.000Z" });
    expect(db.listRunsDb()[0]?.id).toBe("r2"); // r2 가 r1 보다 나중
    expect(db.getRunDb("nope")).toBeNull();
    expect(db.getRunEventsDb("nope")).toEqual([]);
  });
});

describe("threads + session resume lookup", () => {
  it("scopes runs by thread and finds the agent's latest session id", () => {
    db.insertThread({ id: "t1", name: "대화", projectId: null, createdAt: "2026-06-10T02:00:00.000Z" });

    const a = { ...run("tr1"), threadId: "t1", startedAt: "2026-06-10T02:01:00.000Z" };
    const b = { ...run("tr2"), threadId: "t1", startedAt: "2026-06-10T02:02:00.000Z" };
    db.insertRun(a);
    db.insertRun(b);
    db.finishRun({ ...a, status: "succeeded", endedAt: "x", exitCode: 0 }, { sessionId: "sess-old" });
    db.finishRun({ ...b, status: "succeeded", endedAt: "x", exitCode: 0 }, { sessionId: "sess-new" });

    expect(db.listRunsDb({ threadId: "t1" }).map((r) => r.id)).toEqual(["tr2", "tr1"]);
    expect(db.lastSessionId("t1", "claude")).toBe("sess-new"); // 최신 세션으로 resume
    expect(db.lastSessionId("t1", "other-agent")).toBeNull(); // 에이전트별 세션 분리
  });

  it("deleteThreadDb removes the thread with its runs and events", () => {
    db.appendEvent("tr1", 0, { kind: "text", text: "x" });
    db.deleteThreadDb("t1");
    expect(db.getThreadDb("t1")).toBeNull();
    expect(db.getRunDb("tr1")).toBeNull();
    expect(db.getRunEventsDb("tr1")).toEqual([]);
  });
});
