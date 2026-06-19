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

// 스케줄 직전-run 영속 — 재시작 후 중복 발화 가드를 시드하는 근거.
describe("schedule last-run id", () => {
  it("persists the fired run id and surfaces it for the restart guard", () => {
    db.insertSchedule({
      id: "sc1",
      name: "nightly",
      agent: "claude",
      prompt: "go",
      cron: "0 0 * * *",
      workflow: null,
      feature: null,
      projectId: null,
      enabled: true,
      lastRunAt: null,
      createdAt: "2026-06-12T00:00:00.000Z",
    });
    // 발화 전엔 시드할 게 없다.
    expect(db.scheduleLastRunIds().some((s) => s.id === "sc1")).toBe(false);

    db.setScheduleLastRunId("sc1", "run-xyz");
    expect(db.scheduleLastRunIds()).toContainEqual({ id: "sc1", lastRunId: "run-xyz" });
  });
});

// 워크플로우 일시정지 상태(게이트·join) — 재시작 생존의 근거가 되는 라운드트립.
describe("gates & join arrivals", () => {
  it("gate roundtrip: insert → list restores all fields → delete", () => {
    const gate = {
      id: "g1",
      workflow: "review-chain",
      nodeId: "n2",
      prevRunId: "run-1",
      projectId: "p1",
      threadId: "t9",
      result: "branch result",
      chainId: "chain-1",
      input: "original input",
      steps: 3,
      createdAt: "2026-06-12T00:00:00.000Z",
    };
    db.insertGateDb(gate);
    expect(db.listGatesDb()).toContainEqual(gate);
    db.deleteGateDb("g1");
    expect(db.listGatesDb().some((g) => g.id === "g1")).toBe(false);
  });

  it("join arrivals: per-(chain,node) grouping in seq order, delete clears the group", () => {
    db.insertJoinArrivalDb("c1", "n4", 0, "first", "run-a");
    db.insertJoinArrivalDb("c1", "n4", 1, "second", "run-b");
    db.insertJoinArrivalDb("c2", "n4", 0, "other-chain", null);

    const groups = db.listJoinArrivalsDb();
    const c1 = groups.find((g) => g.chainId === "c1" && g.nodeId === "n4");
    expect(c1?.results).toEqual(["first", "second"]);
    expect(c1?.lastRunId).toBe("run-b");
    expect(groups.some((g) => g.chainId === "c2")).toBe(true);

    db.deleteJoinArrivalsDb("c1", "n4");
    expect(db.listJoinArrivalsDb().some((g) => g.chainId === "c1")).toBe(false);
  });
});

describe("lastSessionId", () => {
  it("스레드+에이전트의 최근 세션을 반환하고 session_id 없는 run 은 무시한다", () => {
    const a = { ...run("ls1"), agent: "A", threadId: "t1", startedAt: "2026-06-10T00:00:00.000Z" };
    db.insertRun(a); db.finishRun(a, { sessionId: "sess-old" });
    const b = { ...run("ls2"), agent: "A", threadId: "t1", startedAt: "2026-06-10T01:00:00.000Z" };
    db.insertRun(b); db.finishRun(b, { sessionId: "sess-new" });
    const c = { ...run("ls3"), agent: "A", threadId: "t1", startedAt: "2026-06-10T02:00:00.000Z" };
    db.insertRun(c); // session_id 없음(미완료) → resume 대상에서 제외
    expect(db.lastSessionId("t1", "A")).toBe("sess-new");
  });

  it("세션이 아직 없으면 null", () => {
    expect(db.lastSessionId("none", "Z")).toBeNull();
  });
});

describe("deleteProjectCascadeDb", () => {
  it("프로젝트의 run·이벤트·대화를 캐스케이드 삭제하고 다른 프로젝트는 보존한다", () => {
    db.insertProject({ id: "pc1", name: "a", path: "/tmp/pc-a", createdAt: "2026-06-19T00:00:00.000Z" });
    db.insertProject({ id: "pc2", name: "b", path: "/tmp/pc-b", createdAt: "2026-06-19T00:00:00.000Z" });
    db.insertThread({ id: "tc1", name: "t", projectId: "pc1", createdAt: "2026-06-19T00:00:00.000Z" });
    db.insertThread({ id: "tc2", name: "t2", projectId: "pc2", createdAt: "2026-06-19T00:00:00.000Z" });
    const a = { ...run("rc1"), projectId: "pc1", threadId: "tc1" };
    db.insertRun(a); db.finishRun(a, { sessionId: "s-a" });
    db.appendEvent("rc1", 0, { kind: "text", text: "x" });
    const b = { ...run("rc2"), projectId: "pc2", threadId: "tc2" };
    db.insertRun(b); db.finishRun(b, { sessionId: "s-b" });

    db.deleteProjectCascadeDb("pc1");

    expect(db.getProjectDb("pc1")).toBeNull();
    expect(db.getRunDb("rc1")).toBeNull();
    expect(db.getRunEventsDb("rc1")).toEqual([]); // 이벤트도 함께
    expect(db.getThreadDb("tc1")).toBeNull(); // 대화(스레드)도 함께
    // 다른 프로젝트는 손대지 않는다.
    expect(db.getProjectDb("pc2")).not.toBeNull();
    expect(db.getRunDb("rc2")).not.toBeNull();
    expect(db.getThreadDb("tc2")).not.toBeNull();
  });
});
