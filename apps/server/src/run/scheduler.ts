// 스케줄러 — cron 으로 에이전트 run 을 반복 실행. croner 에 파싱·발화를 위임.
// 서버 프로세스 수명 동안만 동작(머신-로컬). CRUD 후 reschedule() 로 재등록.

import { Cron } from "croner";
import type { Schedule } from "@loom/core";
import { listSchedulesDb, touchScheduleLastRun } from "../db.js";
import { logger } from "../logger.js";
import { startRun } from "./engine.js";

const jobs = new Map<string, Cron>();

/** cron 식 검증 — 라우트가 저장 전에 부른다. 잘못된 식이면 에러 메시지 반환. */
export function validateCron(expr: string): string | null {
  try {
    new Cron(expr, { paused: true }).stop();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export function nextRunAt(expr: string): string | null {
  try {
    const cron = new Cron(expr, { paused: true });
    const next = cron.nextRun();
    cron.stop();
    return next ? next.toISOString() : null;
  } catch {
    return null;
  }
}

function fire(s: Schedule): void {
  touchScheduleLastRun(s.id, new Date().toISOString());
  // fire-and-forget — 실패해도 스케줄러는 계속 돈다.
  void startRun({ agent: s.agent, prompt: s.prompt, projectId: s.projectId })
    .then((r) => {
      if (!r.ok) logger.warn({ schedule: s.id, name: s.name, error: r.error }, "scheduled run did not start");
      else logger.info({ schedule: s.id, name: s.name, runId: r.run.id }, "scheduled run fired");
    })
    .catch((err) => logger.error({ err, schedule: s.id }, "scheduled run threw"));
}

/** 활성 스케줄 전부를 (재)등록 — 시작 시 1회 + CRUD 마다. */
export function reschedule(): void {
  for (const job of jobs.values()) job.stop();
  jobs.clear();
  for (const s of listSchedulesDb()) {
    if (!s.enabled) continue;
    try {
      jobs.set(s.id, new Cron(s.cron, () => fire(s)));
    } catch (err) {
      logger.warn({ err, schedule: s.id, cron: s.cron }, "invalid cron — schedule skipped");
    }
  }
  logger.info({ active: jobs.size }, "scheduler armed");
}

export function stopScheduler(): void {
  for (const job of jobs.values()) job.stop();
  jobs.clear();
}
