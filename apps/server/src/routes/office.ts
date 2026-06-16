// office CRUD — 파일이 정의의 원천이라 라우트는 얇은 패스스루.
// 모든 자원은 per-name (rules/skills/agents/workflows) 또는 single-file (mcp).

import { Hono } from "hono";
import { z } from "zod";
import { importRulesArchive, importSkillArchive } from "../office-import.js";
import { findSkills, importSkill } from "../run/skills-cli.js";
import { generateAgentDraft } from "../run/agent-author.js";
import { isResponse, parseBody } from "./helpers.js";
import {
  agentSchema,
  budgetSchema,
  deleteAgent,
  deleteRule,
  deleteSkill,
  deleteSkillFile,
  deleteWorkflow,
  FEATURE_PROMPT_NAMES,
  type FeaturePromptName,
  mcpListSchema,
  readAgents,
  readBudget,
  readOffice,
  readSkillFile,
  ruleSchema,
  safeName,
  skillSchema,
  workflowSchema,
  writeAgent,
  writeBudget,
  writeFeaturePrompt,
  isFunctionName,
  writeFunction,
  writeMcp,
  writeRule,
  writeSkill,
  writeSkillFile,
  writeWorkflow,
} from "../office.js";

export const officeRoute = new Hono();

// 전체 오피스 (Office 화면이 한 번에 로드).
officeRoute.get("/", (c) => c.json({ office: readOffice() }));

// ── budget — 월 예산 (office/budget.json) ───────────────────────────────────
officeRoute.get("/budget", (c) => c.json({ budget: readBudget() }));
officeRoute.put("/budget", async (c) => {
  const data = await parseBody(c, budgetSchema);
  if (isResponse(data)) return data;
  return c.json({ budget: writeBudget(data) });
});

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
// ── 스킬 생태계 (npx skills / skills.sh) — 검색 + 가져오기 ────────────────────
officeRoute.post("/skills/discover", async (c) => {
  const data = await parseBody(c, z.object({ query: z.string().min(1).max(100) }));
  if (isResponse(data)) return data;
  try {
    return c.json({ candidates: await findSkills(data.query) });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});
officeRoute.post("/skills/install", async (c) => {
  const data = await parseBody(c, z.object({ package: z.string().min(1).max(200) }));
  if (isResponse(data)) return data;
  try {
    return c.json(await importSkill(data.package), 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
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

// 프롬프트로 에이전트 초안 생성 — 실재 스킬/mcp/어댑터만 참조. 저장은 PUT 으로 따로.
officeRoute.post("/agents/generate", async (c) => {
  const data = await parseBody(c, z.object({ prompt: z.string().min(1).max(4000) }));
  if (isResponse(data)) return data;
  try {
    return c.json(await generateAgentDraft(data.prompt));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

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

// ── functions — 기능(깃·분석·스킬/에이전트 생성)의 지침 + 어댑터 + 모델 ───────────
officeRoute.put("/functions/:name", async (c) => {
  const name = c.req.param("name");
  if (!isFunctionName(name)) return c.json({ error: `unknown_function: ${name}` }, 404);
  const data = await parseBody(c, z.object({
    prompt: z.string(),
    adapter: z.string().min(1),
    model: z.string().optional(),
  }));
  if (isResponse(data)) return data;
  return c.json({ function: writeFunction(name, data) });
});

// ── workflows (per-name) — 참조 무결성은 저장 경계에서 검증 ────────────────────
officeRoute.put("/workflows/:name", async (c) => {
  const data = await parseBody(c, workflowSchema);
  if (isResponse(data)) return data;
  const ids = new Set(data.nodes.map((n) => n.id));
  if (ids.size !== data.nodes.length) return c.json({ error: "duplicate_node_id" }, 400);
  if (!ids.has(data.entry)) return c.json({ error: "entry_node_not_found" }, 400);
  // entry 가 게이트면 실행 시점에야 거부됐다(startWorkflow) — 저장 때 막아 사용자가
  // 실행 버튼을 눌러야 잘못을 아는 일이 없게.
  if (data.nodes.find((n) => n.id === data.entry)?.kind === "gate") {
    return c.json({ error: "entry_cannot_be_gate" }, 400);
  }
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
