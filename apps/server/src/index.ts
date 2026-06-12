// loom v2-core — CLI 통합 허브. 책임은 딱 하나: 설치된 CLI 에이전트들을
// 발견(probe)·연결(auth)·모델 수집(models)·연동 테스트(test) 하는 API.
// DB 없음, 영속 상태 없음 — 어댑터 레지스트리가 전부다.

import fs from "node:fs";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config, paths } from "./config.js";
import { failOrphanRuns } from "./db.js";
import { logger } from "./logger.js";
import { ensureOffice } from "./office.js";
import { adaptersRoute } from "./routes/adapters.js";
import { healthRoute } from "./routes/health.js";
import { officeRoute } from "./routes/office.js";
import { fsRoute } from "./routes/fs.js";
import { delegateRoute, mcpRoute } from "./routes/mcp.js";
import { projectFilesRoute } from "./routes/project-files.js";
import { projectsRoute } from "./routes/projects.js";
import { runsRoute } from "./routes/runs.js";
import { gatesRoute } from "./routes/gates.js";
import { schedulesRoute } from "./routes/schedules.js";
import { usageRoute } from "./routes/usage.js";
import { cancelAllRunning } from "./run/engine.js";
import { reschedule, stopScheduler } from "./run/scheduler.js";
import { restoreWorkflowState } from "./run/workflow.js";
import { threadsRoute } from "./routes/threads.js";
import { uploadsRoute } from "./routes/uploads.js";

ensureOffice();
// run 스코프 loadout 잔재 청소 — 크래시로 finish 를 못 거친 디렉토리가 쌓이지 않게.
fs.rmSync(paths.loadouts, { recursive: true, force: true });
// 직전 서버와 함께 죽은 run 들 — "running" 좀비로 남아 UI 에서 멈출 수 없게 되는 것 방지.
const orphans = failOrphanRuns();
if (orphans > 0) logger.warn({ orphans }, "marked orphan running runs as failed");
reschedule(); // 저장된 활성 스케줄을 cron 으로 무장 (서버 프로세스 수명 동안)
restoreWorkflowState(); // 재시작 전에 멈춰 있던 게이트·join 도착분 복원

const app = new Hono();

app.route("/api/health", healthRoute);
app.route("/api/adapters", adaptersRoute);
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

app.onError((err, c) => {
  logger.error({ err }, "unhandled request error");
  return c.json({ error: "internal" }, 500);
});

const server = serve(
  { fetch: app.fetch, port: config.port, hostname: config.host },
  (info) => {
    logger.info(
      { addr: `http://${info.address}:${info.port}` },
      "loom v2-core listening",
    );
  },
);

const shutdown = () => {
  // 실행 중 run 들을 kill+cancelled 마감 — DB 에 "running" 좀비를 남기지 않는다.
  stopScheduler();
  const cancelled = cancelAllRunning();
  logger.info({ cancelled }, "shutting down");
  server.close(() => process.exit(0));
  // close 가 keep-alive 연결로 늦어져도 종료는 보장.
  setTimeout(() => process.exit(0), 2000).unref();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
