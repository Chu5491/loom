// 엔진 초기화 — HTTP 진입점(index.ts)과 헤드리스 진입점(cli.ts)이 공유.
// DB 오픈/마이그레이션 + orphan run 정리 + 세션 보정 + best-effort 청소.
// serve()는 여기 없음 — 헤드리스에서 같은 초기화를 HTTP 없이 재사용하기 위함.

import { getDb } from "./db/client.js";
import { fixStaleSessionIds, markOrphanedRunsFailed } from "./db/runs.js";
import { listAllThreadIds } from "./db/threads.js";
import { logger } from "./logger.js";
import { autoBackupOnStartup } from "./services/backup.js";
import { pruneOrphanedWorktrees } from "./services/worktree.js";

let booted = false;

/** 초기화를 1회만 실행. 재호출은 noop — CLI가 여러 서비스를 거쳐도 안전. */
export function boot(): void {
  if (booted) return;
  booted = true;

  getDb();

  const orphans = markOrphanedRunsFailed();
  if (orphans > 0) {
    logger.warn({ orphans }, "marked orphaned runs as failed");
  }

  const fixedSessions = fixStaleSessionIds();
  if (fixedSessions > 0) {
    logger.warn({ fixedSessions }, "corrected stale session ids");
  }

  // fire-and-forget — 디스크 청소 + 자동 백업이 시작을 막으면 안 됨.
  pruneOrphanedWorktrees(listAllThreadIds()).catch(() => undefined);
  autoBackupOnStartup().catch(() => undefined);
}
