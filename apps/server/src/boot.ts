// 서버 부팅을 함수로 묶어 두 진입점이 공유한다:
//   - index.ts        — CLI/dev (tsx), 프로세스 시그널로 종료
//   - apps/desktop     — Electron main 에서 인-프로세스로 기동, app quit 에서 종료
// 라우트 구성·정리 작업·serve 는 전부 여기 한 곳. 정적 웹 서빙은 데스크톱 전용
// (config.webDir 설정 시) — 같은 오리진이라 웹의 상대경로 /api·SSE 가 그대로 동작.

import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config, paths } from "./config.js";
import { backfillRunAdapters, failOrphanRuns } from "./db.js";
import { logger } from "./logger.js";
import { ensureOffice, readAgents } from "./office.js";
import { adaptersRoute } from "./routes/adapters.js";
import { cliSessionsRoute } from "./routes/cli-sessions.js";
import { healthRoute } from "./routes/health.js";
import { officeRoute } from "./routes/office.js";
import { fsRoute } from "./routes/fs.js";
import { delegateRoute, mcpRoute } from "./routes/mcp.js";
import { projectFilesRoute } from "./routes/project-files.js";
import { projectsRoute } from "./routes/projects.js";
import { runsRoute } from "./routes/runs.js";
import { gatesRoute } from "./routes/gates.js";
import { meetingsRoute } from "./routes/meetings.js";
import { schedulesRoute } from "./routes/schedules.js";
import { usageRoute } from "./routes/usage.js";
import { cancelAllRunning, pruneOrphanLogs } from "./run/engine.js";
import { reapOrphanPids } from "./run/orphans.js";
import { armRetention } from "./run/retention.js";
import { reschedule, stopScheduler } from "./run/scheduler.js";
import { restoreWorkflowState } from "./run/workflow.js";
import { threadsRoute } from "./routes/threads.js";
import { uploadsRoute } from "./routes/uploads.js";
import { backupRoute } from "./routes/backup.js";

export interface BootedServer {
  /** 실제 바인딩된 포트 (LOOM_PORT=0 이면 OS 가 고른 빈 포트). */
  port: number;
  /** 실행 중 run 정리 + 스케줄러 정지 + 소켓 닫기. 종료 경로에서 호출. */
  shutdown: () => Promise<void>;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

// 빌드된 SPA 를 webDir 에서 내준다. 라우터 없는 단일 화면이라 알 수 없는 경로는
// index.html 로 폴백(딥 새로고침 안전). traversal 은 normalize 후 상위참조 제거로 차단.
function mountStatic(app: Hono, webDir: string): void {
  app.get("/*", async (c) => {
    const pathname = decodeURIComponent(new URL(c.req.url).pathname);
    const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const safe = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
    let file = path.join(webDir, safe);
    try {
      if (!fs.statSync(file).isFile()) throw new Error("not a file");
    } catch {
      file = path.join(webDir, "index.html"); // SPA 폴백
    }
    const buf = await fs.promises.readFile(file);
    const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    return c.body(buf, 200, { "Content-Type": type });
  });
}

export async function bootServer(): Promise<BootedServer> {
  ensureOffice();
  // run 스코프 loadout 잔재 청소 — 크래시로 finish 를 못 거친 디렉토리가 쌓이지 않게.
  fs.rmSync(paths.loadouts, { recursive: true, force: true });
  // 하드 크래시(서버 SIGKILL) 후 살아남은 자식 프로세스 그룹 회수 — DB 정리 전에.
  const reaped = reapOrphanPids();
  if (reaped > 0) logger.warn({ reaped }, "reaped orphan child process groups from a previous crash");
  // 직전 서버와 함께 죽은 run 들 — "running" 좀비로 남아 UI 에서 멈출 수 없게 되는 것 방지.
  const orphans = failOrphanRuns();
  if (orphans > 0) logger.warn({ orphans }, "marked orphan running runs as failed");
  // DB 에 없는 run 의 로그 파일 prune — 삭제가 파일을 안 지우던 시절 누적분 정리.
  const prunedLogs = pruneOrphanLogs();
  if (prunedLogs > 0) logger.info({ prunedLogs }, "pruned orphan run log files");
  // 구 run(adapter 컬럼 도입 전)에 adapter 를 agent→cli 로 역추론해 채운다 — 기존 대화의
  // CLI 세션도 정리 대상에 포함되게.
  const filledAdapters = backfillRunAdapters(Object.fromEntries(readAgents().map((a) => [a.name, a.adapter])));
  if (filledAdapters > 0) logger.info({ filledAdapters }, "backfilled adapter on legacy runs");
  reschedule(); // 저장된 활성 스케줄을 cron 으로 무장 (서버 프로세스 수명 동안)
  restoreWorkflowState(); // 재시작 전에 멈춰 있던 게이트·join 도착분 복원
  armRetention(); // 오래된 run·로그 자동 정리(즉시 1회 + 하루 간격) — 디스크 무한 누적 방지

  const app = new Hono();

  app.route("/api/health", healthRoute);
  app.route("/api/adapters", adaptersRoute);
  app.route("/api/cli-sessions", cliSessionsRoute);
  app.route("/api/office", officeRoute);
  app.route("/api/fs", fsRoute);
  app.route("/api/mcp", mcpRoute);
  app.route("/api/delegate", delegateRoute);
  app.route("/api/projects", projectsRoute);
  app.route("/api/projects", projectFilesRoute);
  app.route("/api/threads", threadsRoute);
  app.route("/api/uploads", uploadsRoute);
  app.route("/api/runs", runsRoute);
  app.route("/api/schedules", schedulesRoute);
  app.route("/api/usage", usageRoute);
  app.route("/api/gates", gatesRoute);
  app.route("/api/meetings", meetingsRoute);
  app.route("/api/backup", backupRoute);

  app.onError((err, c) => {
    logger.error({ err }, "unhandled request error");
    return c.json({ error: "internal" }, 500);
  });

  // 데스크톱: 빌드된 웹을 같은 오리진에서. API 라우트 뒤에 등록해 /api 가 우선.
  if (config.webDir) mountStatic(app, config.webDir);

  return new Promise<BootedServer>((resolve) => {
    const server = serve(
      { fetch: app.fetch, port: config.port, hostname: config.host },
      (info) => {
        logger.info({ addr: `http://${info.address}:${info.port}` }, "loom v2-core listening");
        const shutdown = async () => {
          // 실행 중 run 들을 kill+cancelled 마감 — DB 에 "running" 좀비를 남기지 않는다.
          stopScheduler();
          const cancelled = cancelAllRunning();
          logger.info({ cancelled }, "shutting down");
          await new Promise<void>((done) => {
            server.close(() => done());
            // close 가 keep-alive 연결로 늦어져도 종료는 보장.
            setTimeout(() => done(), 2000).unref();
          });
        };
        resolve({ port: info.port, shutdown });
      },
    );
  });
}
