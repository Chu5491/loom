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
import { MARKETPLACE as BUILTIN_MARKETPLACE } from "../marketplace/mcp-catalog.js";
import { fetchOfficialMcpRegistry } from "../services/mcp-registry.js";
import {
  fetchSmitheryCatalog,
  smitheryAvailable,
} from "../services/smithery.js";

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

/**
 * MCP 마켓플레이스. 세 가지 source 를 섞거나 골라서:
 *
 *   - "official": registry.modelcontextprotocol.io (런타임 fetch, 24h 캐시).
 *                 official MCP Registry 가 source of truth — 수천 개 server.
 *   - "smithery": registry.smithery.ai (LOOM_SMITHERY_API_KEY 있을 때만)
 *   - "builtin":  src/marketplace/mcp-catalog.ts (오프라인용 fallback,
 *                 official 이 unreachable 일 때 빈 카탈로그 대신 보여줌)
 *
 * `?source=` 가 없으면 official + smithery (builtin 은 명시적으로만).
 */
mcpServersRoute.get("/marketplace", async (c) => {
  const source = c.req.query("source") ?? "all";
  const sources = {
    smitheryEnabled: smitheryAvailable(),
  };
  if (source === "builtin") {
    return c.json({ entries: BUILTIN_MARKETPLACE, sources });
  }
  if (source === "official") {
    const official = await fetchOfficialMcpRegistry();
    // registry 가 비어있으면 (offline 등) builtin 으로 fallback — 빈 화면 회피.
    return c.json({
      entries: official.length > 0 ? official : BUILTIN_MARKETPLACE,
      sources,
    });
  }
  if (source === "smithery") {
    const smithery = await fetchSmitheryCatalog();
    return c.json({ entries: smithery, sources });
  }
  // all — official + smithery 합쳐서. official 비어있으면 builtin fallback.
  const [official, smithery] = await Promise.all([
    fetchOfficialMcpRegistry(),
    fetchSmitheryCatalog(),
  ]);
  const officialOrFallback =
    official.length > 0 ? official : BUILTIN_MARKETPLACE;
  return c.json({
    entries: [...officialOrFallback, ...smithery],
    sources,
  });
});

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
