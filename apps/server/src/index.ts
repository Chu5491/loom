// loom v2-core — CLI 통합 허브. 책임은 딱 하나: 설치된 CLI 에이전트들을
// 발견(probe)·연결(auth)·모델 수집(models)·연동 테스트(test) 하는 API.
// DB 없음, 영속 상태 없음 — 어댑터 레지스트리가 전부다.

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { ensureOffice } from "./office.js";
import { adaptersRoute } from "./routes/adapters.js";
import { healthRoute } from "./routes/health.js";
import { officeRoute } from "./routes/office.js";
import { fsRoute } from "./routes/fs.js";
import { projectFilesRoute } from "./routes/project-files.js";
import { projectsRoute } from "./routes/projects.js";
import { runsRoute } from "./routes/runs.js";
import { threadsRoute } from "./routes/threads.js";

ensureOffice();

const app = new Hono();

app.route("/api/health", healthRoute);
app.route("/api/adapters", adaptersRoute);
app.route("/api/office", officeRoute);
app.route("/api/fs", fsRoute);
app.route("/api/projects", projectsRoute);
app.route("/api/projects", projectFilesRoute);
app.route("/api/threads", threadsRoute);
app.route("/api/runs", runsRoute);

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
  logger.info("shutting down");
  server.close(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
