import { Hono } from "hono";
import { config } from "../config.js";

export const healthRoute = new Hono();

healthRoute.get("/", (c) =>
  c.json({
    status: "ok",
    name: "loom",
    version: "0.1.0",
    dataDir: config.dataDir,
    time: new Date().toISOString(),
  }),
);
