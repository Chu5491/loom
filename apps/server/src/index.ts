import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config } from "./config.js";
import { getDb, closeDb } from "./db/client.js";
import { fixStaleSessionIds, markOrphanedRunsFailed } from "./db/runs.js";
import { listAllThreadIds } from "./db/threads.js";
import { logger } from "./logger.js";
import { autoBackupOnStartup } from "./services/backup.js";
import { pruneOrphanedWorktrees } from "./services/worktree.js";
import { adaptersRoute } from "./routes/adapters.js";
import { backupsRoute } from "./routes/backups.js";
import { agentsRoute } from "./routes/agents.js";
import { healthRoute } from "./routes/health.js";
import { gitRoute } from "./routes/git.js";
import { gitAccountRoute } from "./routes/git-account.js";
import { geminiSyncRoute } from "./routes/gemini-sync.js";
import { insightsRoute } from "./routes/insights.js";
import { mcpServersRoute } from "./routes/mcp-servers.js";
import { projectsRoute } from "./routes/projects.js";
import { runsRoute } from "./routes/runs.js";
import { searchRoute } from "./routes/search.js";
import { settingsRoute } from "./routes/settings.js";
import { specsRoute } from "./routes/specs.js";
import { threadsRoute } from "./routes/threads.js";
import { reviewsRoute } from "./routes/reviews.js";
import { webhooksRoute } from "./routes/webhooks.js";

getDb();

const orphans = markOrphanedRunsFailed();
if (orphans > 0) {
  logger.warn({ orphans }, "marked orphaned runs as failed");
}

const fixedSessions = fixStaleSessionIds();
if (fixedSessions > 0) {
  logger.warn({ fixedSessions }, "corrected stale session ids");
}

// fire-and-forget — disk cleanup + auto-backup shouldn't block server startup
pruneOrphanedWorktrees(listAllThreadIds()).catch(() => undefined);
autoBackupOnStartup().catch(() => undefined);

const app = new Hono();

app.route("/api/health", healthRoute);
app.route("/api/adapters", adaptersRoute);
app.route("/api/projects", projectsRoute);
app.route("/api/agents", agentsRoute);
app.route("/api/specs", specsRoute);
app.route("/api/mcp-servers", mcpServersRoute);
app.route("/api/gemini-sync", geminiSyncRoute);
app.route("/api/runs", runsRoute);
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
