import { Hono } from "hono";
import { z } from "zod";
import {
  createMcpServer,
  deleteMcpServer,
  getMcpServer,
  listMcpServers,
  updateMcpServer,
} from "../db/mcp-servers.js";

const kindSchema = z.enum(["stdio", "http", "sse"]);

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  kind: kindSchema,
  command: z.string().nullable().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().nullable().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  kind: kindSchema.optional(),
  command: z.string().nullable().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().nullable().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

export const mcpServersRoute = new Hono();

mcpServersRoute.get("/", (c) => c.json({ servers: listMcpServers() }));

mcpServersRoute.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  }
  try {
    const server = createMcpServer(parsed.data);
    return c.json({ server }, 201);
  } catch (err) {
    // UNIQUE name 충돌이 가장 흔한 실패 경로 — 메시지를 그대로 surface.
    return c.json(
      { error: "create_failed", detail: (err as Error).message },
      400,
    );
  }
});

mcpServersRoute.get("/:id", (c) => {
  const server = getMcpServer(c.req.param("id"));
  if (!server) return c.json({ error: "not_found" }, 404);
  return c.json({ server });
});

mcpServersRoute.patch("/:id", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  }
  const server = updateMcpServer(c.req.param("id"), parsed.data);
  if (!server) return c.json({ error: "not_found" }, 404);
  return c.json({ server });
});

mcpServersRoute.delete("/:id", (c) => {
  const ok = deleteMcpServer(c.req.param("id"));
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.body(null, 204);
});
