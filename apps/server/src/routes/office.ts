// office CRUD — 파일이 정의의 원천이라 라우트는 얇은 패스스루.
// 모든 자원은 per-name (rules/skills/agents) 또는 single-file (mcp/harness).

import { Hono } from "hono";
import { z } from "zod";
import { isResponse, parseBody } from "./helpers.js";
import {
  agentSchema,
  deleteAgent,
  deleteRule,
  deleteSkill,
  deleteSkillFile,
  edgesListSchema,
  mcpListSchema,
  readOffice,
  readSkillFile,
  ruleSchema,
  safeName,
  skillSchema,
  writeAgent,
  writeEdges,
  writeMcp,
  writeRule,
  writeSkill,
  writeSkillFile,
} from "../office.js";

export const officeRoute = new Hono();

// 전체 오피스 (Office 화면이 한 번에 로드).
officeRoute.get("/", (c) => c.json({ office: readOffice() }));

// ── rules ──────────────────────────────────────────────────────────────────
officeRoute.put("/rules/:name", async (c) => {
  const data = await parseBody(c, ruleSchema);
  if (isResponse(data)) return data;
  try {
    return c.json({ rule: writeRule(safeName(c.req.param("name")), data.body) });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});
officeRoute.delete("/rules/:name", (c) =>
  deleteRule(c.req.param("name"))
    ? c.json({ ok: true })
    : c.json({ error: "not_found" }, 404),
);

// ── skills ─────────────────────────────────────────────────────────────────
officeRoute.put("/skills/:name", async (c) => {
  const data = await parseBody(c, skillSchema);
  if (isResponse(data)) return data;
  try {
    const skill = writeSkill(
      safeName(c.req.param("name")),
      data.description,
      data.body,
    );
    return c.json({ skill });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});
officeRoute.delete("/skills/:name", (c) =>
  deleteSkill(c.req.param("name"))
    ? c.json({ ok: true })
    : c.json({ error: "not_found" }, 404),
);

// 스킬 딸린 파일(폴더 스킬) — path 는 슬래시 포함이라 query/body 로 받는다.
officeRoute.get("/skills/:name/file", (c) => {
  try {
    return c.json({ content: readSkillFile(c.req.param("name"), c.req.query("path") ?? "") });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 404);
  }
});

const skillFileSchema = z.object({ path: z.string().min(1), content: z.string().max(500_000) });
officeRoute.put("/skills/:name/file", async (c) => {
  const data = await parseBody(c, skillFileSchema);
  if (isResponse(data)) return data;
  try {
    // 단일 .md 스킬이면 자동으로 폴더(<name>/SKILL.md)로 승격된다.
    return c.json({ skill: writeSkillFile(c.req.param("name"), data.path, data.content) });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

officeRoute.delete("/skills/:name/file", async (c) => {
  const data = await parseBody(c, z.object({ path: z.string().min(1) }));
  if (isResponse(data)) return data;
  try {
    return deleteSkillFile(c.req.param("name"), data.path)
      ? c.json({ ok: true })
      : c.json({ error: "not_found" }, 404);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

// ── agents ─────────────────────────────────────────────────────────────────
officeRoute.put("/agents/:name", async (c) => {
  const data = await parseBody(c, agentSchema);
  if (isResponse(data)) return data;
  try {
    return c.json({ agent: writeAgent(safeName(c.req.param("name")), data) });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});
officeRoute.delete("/agents/:name", (c) =>
  deleteAgent(c.req.param("name"))
    ? c.json({ ok: true })
    : c.json({ error: "not_found" }, 404),
);

// ── mcp (single file) ────────────────────────────────────────────────────────
officeRoute.put("/mcp", async (c) => {
  const data = await parseBody(c, mcpListSchema);
  if (isResponse(data)) return data;
  return c.json({ servers: writeMcp(data.servers) });
});

// ── harness (single file) ─────────────────────────────────────────────────────
officeRoute.put("/harness", async (c) => {
  const data = await parseBody(c, edgesListSchema);
  if (isResponse(data)) return data;
  return c.json({ edges: writeEdges(data.edges) });
});
