import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config } from "./config.js";
import { getDb, closeDb } from "./db/client.js";
import { markOrphanedRunsFailed } from "./db/runs.js";
import { adaptersRoute } from "./routes/adapters.js";
import { agentsRoute } from "./routes/agents.js";
import { healthRoute } from "./routes/health.js";
import { projectsRoute } from "./routes/projects.js";
import { runsRoute } from "./routes/runs.js";
import { specsRoute } from "./routes/specs.js";

getDb();

const orphans = markOrphanedRunsFailed();
if (orphans > 0) {
  console.warn(`[loom] marked ${orphans} orphaned run(s) as failed`);
}

const app = new Hono();

app.route("/api/health", healthRoute);
app.route("/api/adapters", adaptersRoute);
app.route("/api/projects", projectsRoute);
app.route("/api/agents", agentsRoute);
app.route("/api/specs", specsRoute);
app.route("/api/runs", runsRoute);

app.onError((err, c) => {
  console.error("[loom] unhandled error:", err);
  return c.json({ error: "internal", message: err.message }, 500);
});

const server = serve(
  { fetch: app.fetch, port: config.port, hostname: config.host },
  (info) => {
    console.log(`[loom] listening on http://${info.address}:${info.port}`);
    console.log(`[loom] data dir: ${config.dataDir}`);
  },
);

const shutdown = () => {
  console.log("\n[loom] shutting down...");
  server.close(() => {
    closeDb();
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
