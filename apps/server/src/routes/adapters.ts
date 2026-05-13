import { Hono } from "hono";
import { z } from "zod";
import { isResponse, parseBody } from "./helpers.js";
import {
  getManifest,
  listManifests,
  listModelsForAdapter,
  probeAdapter,
  testAdapter,
} from "../adapters/registry.js";

export const adaptersRoute = new Hono();

adaptersRoute.get("/", (c) => c.json({ adapters: listManifests() }));

adaptersRoute.get("/:kind", (c) => {
  const manifest = getManifest(c.req.param("kind"));
  if (!manifest) return c.json({ error: "not_found" }, 404);
  return c.json({ adapter: manifest });
});

adaptersRoute.get("/:kind/probe", async (c) => {
  const command = c.req.query("command") || undefined;
  const refresh = c.req.query("refresh") === "1";
  const result = await probeAdapter(c.req.param("kind"), { command, refresh });
  if (!result) return c.json({ error: "not_found" }, 404);
  return c.json({ probe: result });
});

const testBodySchema = z.object({
  config: z.record(z.string(), z.unknown()),
  prompt: z.string().min(1).optional(),
  cwd: z.string().optional(),
});

adaptersRoute.post("/:kind/test", async (c) => {
  const data = await parseBody(c, testBodySchema);
  if (isResponse(data)) return data;
  const result = await testAdapter(c.req.param("kind"), data);
  if (!result) return c.json({ error: "not_found" }, 404);
  return c.json({ test: result });
});

adaptersRoute.get("/:kind/models", async (c) => {
  const command = c.req.query("command") || undefined;
  const refresh = c.req.query("refresh") === "1";
  const result = await listModelsForAdapter(c.req.param("kind"), {
    command,
    refresh,
  });
  if (!result) return c.json({ error: "not_found" }, 404);
  return c.json({ models: result });
});
