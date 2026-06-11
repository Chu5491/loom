// office CRUD — 파일이 정의의 원천이라 라우트는 얇은 패스스루.
// 모든 자원은 per-name (rules/skills/agents/workflows) 또는 single-file (mcp).

import { Hono } from "hono";
import { z } from "zod";
import { importRulesArchive, importSkillArchive } from "../office-import.js";
import { isResponse, parseBody } from "./helpers.js";
import {
  agentSchema,
  deleteAgent,
  deleteRule,
  deleteSkill,
  deleteSkillFile,
  deleteWorkflow,
  FEATURE_PROMPT_NAMES,
  type FeaturePromptName,
  mcpListSchema,
  readAgents,
  readOffice,
  readSkillFile,
  ruleSchema,
  safeName,
  skillSchema,
  workflowSchema,
  writeAgent,
  writeFeaturePrompt,
  writeMcp,
  writeRule,
  writeSkill,
  writeSkillFile,
  writeWorkflow,
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

// ── 가져오기 (.md / .zip 업로드 — base64 JSON, ~13MB cap) ─────────────────────
const importSchema = z.object({
  filename: z.string().min(1).max(200),
  dataBase64: z.string().min(1).max(18_000_000),
});
officeRoute.post("/skills/import", async (c) => {
  const data = await parseBody(c, importSchema);
  if (isResponse(data)) return data;
  try {
    return c.json({ skill: importSkillArchive(data.filename, Buffer.from(data.dataBase64, "base64")) }, 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});
officeRoute.post("/rules/import", async (c) => {
  const data = await parseBody(c, importSchema);
  if (isResponse(data)) return data;
  try {
    return c.json({ rules: importRulesArchive(data.filename, Buffer.from(data.dataBase64, "base64")) }, 201);
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

// ── feature prompts — 내장 기능(git 커밋·분석)의 조정 가능한 지침 ───────────────
officeRoute.put("/prompts/:name", async (c) => {
  const name = c.req.param("name");
  if (!FEATURE_PROMPT_NAMES.includes(name as FeaturePromptName)) {
    return c.json({ error: `unknown_feature_prompt: ${name}` }, 404);
  }
  const data = await parseBody(c, ruleSchema);
  if (isResponse(data)) return data;
  return c.json({ prompt: writeFeaturePrompt(name as FeaturePromptName, data.body) });
});

// ── workflows (per-name) — 참조 무결성은 저장 경계에서 검증 ────────────────────
officeRoute.put("/workflows/:name", async (c) => {
  const data = await parseBody(c, workflowSchema);
  if (isResponse(data)) return data;
  const ids = new Set(data.nodes.map((n) => n.id));
  if (ids.size !== data.nodes.length) return c.json({ error: "duplicate_node_id" }, 400);
  if (!ids.has(data.entry)) return c.json({ error: "entry_node_not_found" }, 400);
  for (const e of data.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) return c.json({ error: `edge_refers_missing_node: ${e.from}->${e.to}` }, 400);
  }
  const agents = new Set(readAgents().map((a) => a.name));
  for (const n of data.nodes) {
    if (n.kind !== "gate" && !agents.has(n.agent)) return c.json({ error: `unknown_agent: ${n.agent}` }, 400);
  }
  if (data.trigger && !agents.has(data.trigger.agent)) {
    return c.json({ error: `unknown_trigger_agent: ${data.trigger.agent}` }, 400);
  }
  try {
    return c.json({ workflow: writeWorkflow(safeName(c.req.param("name")), data) });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});
officeRoute.delete("/workflows/:name", (c) =>
  deleteWorkflow(c.req.param("name"))
    ? c.json({ ok: true })
    : c.json({ error: "not_found" }, 404),
);
