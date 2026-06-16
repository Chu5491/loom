// 고아 pid 회수 — record → reap 라운드트립. 실제 프로세스는 안 죽이고(존재하지
// 않는 pid 사용) pidfile 생애주기만 검증한다.

import { afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// config.ts 가 import 시점에 LOOM_HOME 을 읽으므로 모듈 import 전에 임시 폴더로 박는다.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "loom-orphans-test-"));
process.env.LOOM_HOME = home;

const { paths } = await import("../src/config.js");
const { recordRunPid, clearRunPid, reapOrphanPids } = await import("../src/run/orphans.js");

// 존재할 가능성이 거의 없는 pid — killProcessGroup 은 ESRCH 를 삼킨다(아무것도 안 죽임).
const SAFE_FAKE_PID = 2_000_000_000;

afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

describe("orphan pid lifecycle", () => {
  it("records a pidfile and clears it (no reap target left)", () => {
    recordRunPid("run-a", SAFE_FAKE_PID);
    expect(fs.existsSync(path.join(paths.runPids, "run-a"))).toBe(true);
    clearRunPid("run-a");
    expect(fs.existsSync(path.join(paths.runPids, "run-a"))).toBe(false);
  });

  it("ignores a non-positive pid", () => {
    recordRunPid("run-zero", 0);
    expect(fs.existsSync(path.join(paths.runPids, "run-zero"))).toBe(false);
  });

  it("reaps leftover pidfiles and empties the directory", () => {
    recordRunPid("run-b", SAFE_FAKE_PID);
    recordRunPid("run-c", SAFE_FAKE_PID);
    const reaped = reapOrphanPids();
    expect(reaped).toBe(2);
    expect(fs.readdirSync(paths.runPids)).toEqual([]);
  });

  it("returns 0 when there is nothing to reap", () => {
    expect(reapOrphanPids()).toBe(0);
  });
});
