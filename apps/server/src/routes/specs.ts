import { Hono } from "hono";
import { z } from "zod";
import {
  createSpec,
  deleteSpec,
  getSpec,
  listSpecs,
  updateSpec,
} from "../db/specs.js";

const createSchema = z.object({
  name: z.string().min(1),
  content: z.string(),
  agentId: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  content: z.string().optional(),
  agentId: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

export const specsRoute = new Hono();

specsRoute.get("/", (c) => {
  const agentId = c.req.query("agentId") ?? undefined;
  return c.json({ specs: listSpecs({ agentId }) });
});

specsRoute.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  }
  const spec = createSpec(parsed.data);
  return c.json({ spec }, 201);
});

specsRoute.get("/:id", (c) => {
  const spec = getSpec(c.req.param("id"));
  if (!spec) return c.json({ error: "not_found" }, 404);
  return c.json({ spec });
});

specsRoute.patch("/:id", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  }
  const spec = updateSpec(c.req.param("id"), parsed.data);
  if (!spec) return c.json({ error: "not_found" }, 404);
  return c.json({ spec });
});

specsRoute.delete("/:id", (c) => {
  const ok = deleteSpec(c.req.param("id"));
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.body(null, 204);
});
