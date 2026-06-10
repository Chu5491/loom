import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { boot } from "./boot.js";
import { config } from "./config.js";
import { closeDb } from "./db/client.js";
import { logger } from "./logger.js";
import { adaptersRoute } from "./routes/adapters.js";
import { backupsRoute } from "./routes/backups.js";
import { agentsRoute } from "./routes/agents.js";
import { healthRoute } from "./routes/health.js";
import { gitRoute } from "./routes/git.js";
import { gitAccountRoute } from "./routes/git-account.js";
import { geminiSyncRoute } from "./routes/gemini-sync.js";
import { harnessRoute } from "./routes/harness.js";
import { insightsRoute } from "./routes/insights.js";
import { mcpServersRoute } from "./routes/mcp-servers.js";
import { projectsRoute } from "./routes/projects.js";
import { runsRoute } from "./routes/runs.js";
import { schedulesRoute } from "./routes/schedules.js";
import { startScheduler } from "./services/scheduler.js";
import { searchRoute } from "./routes/search.js";
import { settingsRoute } from "./routes/settings.js";
import { specsRoute } from "./routes/specs.js";
import { threadsRoute } from "./routes/threads.js";
import { reviewsRoute } from "./routes/reviews.js";
import { webhooksRoute } from "./routes/webhooks.js";

boot();

// 스케줄러는 서버 프로세스에서만 — 일회성 CLI 명령은 타이머를 띄우지 않음.
startScheduler();

const app = new Hono();

app.route("/api/health", healthRoute);
app.route("/api/adapters", adaptersRoute);
app.route("/api/projects", projectsRoute);
app.route("/api/agents", agentsRoute);
app.route("/api/specs", specsRoute);
app.route("/api/mcp-servers", mcpServersRoute);
app.route("/api/gemini-sync", geminiSyncRoute);
app.route("/api/runs", runsRoute);
app.route("/api/schedules", schedulesRoute);
app.route("/api/harness", harnessRoute);
app.route("/api/search", searchRoute);
app.route("/api/insights", insightsRoute);
app.route("/api/settings", settingsRoute);
app.route("/api/threads", threadsRoute);
app.route("/api/git-account", gitAccountRoute);
app.route("/api/backups", backupsRoute);
app.route("/api/reviews", reviewsRoute);
app.route("/api/webhooks", webhooksRoute);
app.route("/api", gitRoute);

app.onError((err, c) => {
  logger.error({ err }, "unhandled request error");
  return c.json({ error: "internal" }, 500);
});

const server = serve(
  { fetch: app.fetch, port: config.port, hostname: config.host },
  (info) => {
    logger.info(
      { addr: `http://${info.address}:${info.port}`, dataDir: config.dataDir },
      "listening",
    );
  },
);

const shutdown = () => {
  logger.info("shutting down");
  server.close(() => {
    closeDb();
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
