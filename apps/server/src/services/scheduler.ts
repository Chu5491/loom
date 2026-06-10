// 스케줄러 엔진. enabled scheduled_run 마다 croner job 을 arm 하고, 발화 시
// startRun 을 호출한다 — 손으로 누르는 run 과 같은 primitive 를 타이머에 걸 뿐.
//
// cron 파싱/다음-발화 계산은 croner 에 위임(DST·요일 엣지케이스 재발명 금지).
// 이 파일은 (1) 순수 헬퍼 validateCron/computeNextFire 와 (2) 타이머 lifecycle
// 을 가진 엔진으로 나뉜다. 엔진은 서버 프로세스(index.ts)에서만 start.

import { Cron } from "croner";
import {
  getSchedule,
  listEnabledSchedules,
  recordScheduleFired,
} from "../db/schedules.js";
import { logger } from "../logger.js";
import { startRun } from "./run-service.js";

// ─── 순수 헬퍼 (테스트 대상) ────────────────────────────────────────────────

/** cron 식이 유효한지. 유효하면 null, 아니면 에러 메시지. */
export function validateCron(cron: string, timezone?: string | null): string | null {
  try {
    new Cron(cron, { timezone: timezone ?? undefined });
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

/** 다음 발화 시각(ISO). 유효하지 않거나 미래 발화가 없으면 null. */
export function computeNextFire(
  cron: string,
  timezone?: string | null,
  from?: Date,
): string | null {
  try {
    const job = new Cron(cron, { timezone: timezone ?? undefined });
    const next = from ? job.nextRun(from) : job.nextRun();
    return next ? next.toISOString() : null;
  } catch {
    return null;
  }
}

// ─── 엔진 (타이머 lifecycle) ────────────────────────────────────────────────

const jobs = new Map<string, Cron>();

function arm(id: string, cron: string, timezone: string | null): void {
  // protect: 동일 job 의 발화가 겹치지 않게 (이전 발화가 아직 처리 중이면 skip).
  const job = new Cron(
    cron,
    { timezone: timezone ?? undefined, protect: true },
    () => {
      void fireSchedule(id);
    },
  );
  jobs.set(id, job);
}

async function fireSchedule(id: string): Promise<void> {
  // 발화 시점에 DB 를 다시 읽음 — 편집된 프롬프트/비활성화가 즉시 반영되도록.
  const schedule = getSchedule(id);
  if (!schedule || !schedule.enabled) return;

  const log = logger.child({ scheduleId: id, scheduleName: schedule.name });
  log.info("schedule firing");

  let runId: string | null = null;
  try {
    const res = await startRun({
      agentId: schedule.agentId,
      prompt: schedule.prompt,
      cwd: schedule.cwd ?? undefined,
    });
    if (res.ok) {
      runId = res.run.id;
    } else {
      // 동시 실행 한도(429) 등 — 발화는 기록하되 run 은 없음. 다음 주기에 재시도.
      log.warn({ error: res.error, status: res.status }, "schedule run did not start");
    }
  } catch (err) {
    log.error({ err }, "schedule fire threw");
  }

  const next = jobs.get(id)?.nextRun() ?? null;
  recordScheduleFired(id, {
    runId,
    nextFireAt: next ? next.toISOString() : null,
  });
}

/** 모든 job 정지 + 맵 비움. */
export function stopScheduler(): void {
  for (const job of jobs.values()) job.stop();
  jobs.clear();
}

/** enabled 스케줄을 DB 에서 다시 읽어 전부 재-arm. CRUD 변경 후 호출. */
export function reloadSchedules(): void {
  stopScheduler();
  const enabled = listEnabledSchedules();
  for (const s of enabled) arm(s.id, s.cron, s.timezone);
  if (enabled.length > 0) {
    logger.info({ count: enabled.length }, "scheduler armed");
  }
}

/** 서버 부팅 시 1회. 이후 CRUD 는 reloadSchedules 로 갱신. */
export function startScheduler(): void {
  reloadSchedules();
}

/** 테스트/진단용 — 현재 arm 된 schedule id 목록. */
export function _armedScheduleIds(): string[] {
  return [...jobs.keys()];
}
