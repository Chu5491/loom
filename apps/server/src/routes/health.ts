import { Hono } from "hono";

export const healthRoute = new Hono();

healthRoute.get("/", (c) =>
  c.json({
    status: "ok",
    name: "loom",
    version: "2.0.0-core",
    time: new Date().toISOString(),
  }),
);
