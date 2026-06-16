// 기록 보존 — ended_at 이 보존 일수보다 오래된 run 과 그 로그 파일을 정리한다.
// 헌법: data/ 는 기록일 뿐 — 자동 정리가 없으면 로그·sqlite 가 무한정 쌓인다.
// retentionDays=0 이면 비활성(무한 보존).

import { config } from "../config.js";
import { deleteRunDb, runIdsEndedBefore, vacuumDb } from "../db.js";
import { logger } from "../logger.js";
import { deleteRunFiles } from "./engine.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 순수 — now(ms) 기준 보존 컷오프 ISO. days<=0 이면 null(정리 안 함). */
export function retentionCutoff(nowMs: number, days: number): string | null {
  if (days <= 0) return null;
  return new Date(nowMs - days * DAY_MS).toISOString();
}

/** 보존 스윕 1회 — 오래된 run 의 DB 행·이벤트·로그를 지우고 VACUUM. 삭제 수 반환. */
export function sweepOldRuns(nowMs: number = Date.now()): number {
  const cutoff = retentionCutoff(nowMs, config.retentionDays);
  if (!cutoff) return 0;

  const ids = runIdsEndedBefore(cutoff);
  if (ids.length === 0) return 0;

  for (const id of ids) {
    deleteRunDb(id); // 행 + 이벤트(FK cascade)
    deleteRunFiles(id); // raw 로그 파일
  }
  vacuumDb();
  logger.info({ removed: ids.length, retentionDays: config.retentionDays }, "retention sweep removed old runs");
  return ids.length;
}

/** 부팅 시 무장 — 즉시 1회 + 하루 간격 반복. 프로세스 수명 동안만(머신-로컬). */
export function armRetention(): void {
  if (config.retentionDays <= 0) {
    logger.info("retention disabled (LOOM_RETENTION_DAYS=0)");
    return;
  }
  try {
    sweepOldRuns();
  } catch (err) {
    logger.error({ err }, "initial retention sweep failed");
  }
  const timer = setInterval(() => {
    try {
      sweepOldRuns();
    } catch (err) {
      logger.error({ err }, "retention sweep failed");
    }
  }, DAY_MS);
  timer.unref?.();
}
