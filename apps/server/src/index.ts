import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config } from "./config.js";
import { getDb, closeDb } from "./db/client.js";
import { markOrphanedRunsFailed } from "./db/runs.js";
import { logger } from "./logger.js";
import { adaptersRoute } from "./routes/adapters.js";
import { agentsRoute } from "./routes/agents.js";
import { healthRoute } from "./routes/health.js";
import { gitRoute } from "./routes/git.js";
import { gitAccountRoute } from "./routes/git-account.js";
import { geminiSyncRoute } from "./routes/gemini-sync.js";
import { insightsRoute } from "./routes/insights.js";
import { mcpServersRoute } from "./routes/mcp-servers.js";
import { projectsRoute } from "./routes/projects.js";
import { runsRoute } from "./routes/runs.js";
import { settingsRoute } from "./routes/settings.js";
import { specsRoute } from "./routes/specs.js";
import { threadsRoute } from "./routes/threads.js";

getDb();

const orphans = markOrphanedRunsFailed();
if (orphans > 0) {
  logger.warn({ orphans }, "marked orphaned runs as failed");
}

const app = new Hono();

app.route("/api/health", healthRoute);
app.route("/api/adapters", adaptersRoute);
app.route("/api/projects", projectsRoute);
app.route("/api/agents", agentsRoute);
app.route("/api/specs", specsRoute);
app.route("/api/mcp-servers", mcpServersRoute);
app.route("/api/gemini-sync", geminiSyncRoute);
app.route("/api/runs", runsRoute);
app.route("/api/insights", insightsRoute);
app.route("/api/settings", settingsRoute);
app.route("/api/threads", threadsRoute);
app.route("/api/git-account", gitAccountRoute);
app.route("/api", gitRoute);

app.onError((err, c) => {
  logger.error({ err }, "unhandled request error");
  return c.json({ error: "internal", message: err.message }, 500);
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
