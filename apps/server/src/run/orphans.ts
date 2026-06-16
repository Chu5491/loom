// 하드 크래시(서버 SIGKILL) 후 살아남은 자식 프로세스 회수.
// 정상 종료는 cancelAllRunning/finish 가 그룹을 거두지만, 부모가 갑자기 죽으면
// detached 자식은 고아로 남는다. spawn 시 그룹 pid 를 pidfile 로 적어두고,
// 부팅 때 잔존 pidfile 의 그룹을 best-effort 로 죽인 뒤 정리한다.

import fs from "node:fs";
import path from "node:path";
import { killProcessGroup } from "@loom/adapter-utils";
import { paths } from "../config.js";
import { logger } from "../logger.js";
import { safeName } from "../office.js";

function pidFile(runId: string): string {
  return path.join(paths.runPids, safeName(runId));
}

/** spawn 직후 — 이 run 의 그룹 리더 pid 를 기록(부팅 회수의 근거). */
export function recordRunPid(runId: string, pid: number): void {
  if (!pid || pid <= 0) return;
  try {
    fs.mkdirSync(paths.runPids, { recursive: true });
    fs.writeFileSync(pidFile(runId), String(pid));
  } catch (err) {
    // 회수는 편의 기능 — 기록 실패해도 run 자체는 진행한다.
    logger.warn({ err, runId }, "could not record run pid");
  }
}

/** finish/cancel — 정상 종료한 run 의 pidfile 제거(부팅 시 헛된 kill 방지). */
export function clearRunPid(runId: string): void {
  try {
    fs.rmSync(pidFile(runId), { force: true });
  } catch {
    // 이미 없을 수 있음 — 무해.
  }
}

/** 부팅 시 — 직전 서버가 두고 간 pidfile 의 그룹을 거두고 디렉토리를 비운다.
 *  반환: 회수 시도한 pidfile 수. */
export function reapOrphanPids(): number {
  let files: string[];
  try {
    files = fs.readdirSync(paths.runPids);
  } catch {
    return 0; // 디렉토리 없음 = 회수할 것 없음
  }
  let reaped = 0;
  for (const name of files) {
    const file = path.join(paths.runPids, name);
    try {
      const pid = Number(fs.readFileSync(file, "utf8").trim());
      if (Number.isInteger(pid) && pid > 0) {
        killProcessGroup(pid);
        reaped++;
      }
    } catch {
      // 읽기 실패한 파일도 아래에서 정리한다.
    }
    fs.rmSync(file, { force: true });
  }
  return reaped;
}
