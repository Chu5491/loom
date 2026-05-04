import { Hono } from "hono";
import { z } from "zod";
import {
  createMcpServer,
  deleteMcpServer,
  getMcpServer,
  listMcpServers,
  updateMcpServer,
} from "../db/mcp-servers.js";
import { runGeminiSync } from "../services/gemini-sync.js";
import { logger } from "../logger.js";

/** mcp 카탈로그 변경 후 — gemini settings.json 자동 머지. enabled=false면 no-op.
 *  실패해도 CRUD는 성공 응답을 그대로 보냄(sync 실패가 카탈로그 변경을 막으면 안 됨). */
function autoSyncGemini(reason: string): void {
  try {
    const r = runGeminiSync();
    if (r.skipped === "disabled") return;
    if (!r.ok) {
      logger.warn(
        { reason, error: r.error },
        "gemini auto-sync failed (catalog change applied anyway)",
      );
    } else if (
      r.addedToSettings.length > 0 ||
      r.removedFromSettings.length > 0 ||
      r.conflicts.length > 0
    ) {
      logger.info(
        {
          reason,
          added: r.addedToSettings,
          removed: r.removedFromSettings,
          conflicts: r.conflicts,
        },
        "gemini auto-sync applied",
      );
    }
  } catch (err) {
    logger.warn({ reason, err }, "gemini auto-sync threw");
  }
}

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
    autoSyncGemini(`create:${server.name}`);
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
  autoSyncGemini(`update:${server.name}`);
  return c.json({ server });
});

mcpServersRoute.delete("/:id", (c) => {
  const before = getMcpServer(c.req.param("id"));
  const ok = deleteMcpServer(c.req.param("id"));
  if (!ok) return c.json({ error: "not_found" }, 404);
  autoSyncGemini(`delete:${before?.name ?? c.req.param("id")}`);
  return c.body(null, 204);
});
