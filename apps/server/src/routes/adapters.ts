import { Hono } from "hono";
import { z } from "zod";
import type { AdapterKind } from "@loom/core";
import { isResponse, parseBody } from "./helpers.js";
import {
  getManifest,
  listManifests,
  listModelsForAdapter,
  probeAdapter,
  testAdapter,
} from "../adapters/registry.js";

export const adaptersRoute = new Hono();

// URL param은 런타임 string — registry가 unknown kind에 null 반환 → 404.
const kind = (c: { req: { param(k: "kind"): string } }) =>
  c.req.param("kind") as AdapterKind;

adaptersRoute.get("/", (c) => c.json({ adapters: listManifests() }));

adaptersRoute.get("/:kind", (c) => {
  const manifest = getManifest(kind(c));
  if (!manifest) return c.json({ error: "not_found" }, 404);
  return c.json({ adapter: manifest });
});

adaptersRoute.get("/:kind/probe", async (c) => {
  const command = c.req.query("command") || undefined;
  const refresh = c.req.query("refresh") === "1";
  const result = await probeAdapter(kind(c), { command, refresh });
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
  const result = await testAdapter(kind(c), data);
  if (!result) return c.json({ error: "not_found" }, 404);
  return c.json({ test: result });
});

// POST (not GET) so the agent's env — which carries the provider API key for
// adapters that fetch live models over HTTP — never lands in a URL/query log.
const modelsBodySchema = z.object({
  command: z.string().optional(),
  refresh: z.boolean().optional(),
  env: z.record(z.string(), z.string()).optional(),
});

adaptersRoute.post("/:kind/models", async (c) => {
  const data = await parseBody(c, modelsBodySchema);
  if (isResponse(data)) return data;
  const result = await listModelsForAdapter(kind(c), {
    command: data.command,
    refresh: data.refresh,
    env: data.env,
  });
  if (!result) return c.json({ error: "not_found" }, 404);
  return c.json({ models: result });
});
