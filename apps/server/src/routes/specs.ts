import { Hono } from "hono";
import { z } from "zod";
import {
  createSpec,
  deleteSpec,
  getSpec,
  listSpecs,
  updateSpec,
} from "../db/specs.js";
import { SKILLS as BUILTIN_SKILLS } from "../marketplace/skill-catalog.js";
import {
  fetchSkillsShCatalog,
  fetchSkillsShDetail,
} from "../services/skills-sh.js";

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

/**
 * Skill 마켓플레이스. 두 source:
 *
 *   - "skills.sh": skills.sh/api/v1/skills (런타임 fetch, 24h 캐시).
 *                  8000+ 개 — 우리가 운영하지 않는 외부 source. 가장 풍부.
 *   - "builtin":   loom 팀의 starter skills (오프라인용 + skills.sh 가 죽었을
 *                  때 fallback). publisher: "loom" 으로 표시.
 *
 * 기본값(`?source=all`) 은 두 개 합치고, skills.sh 가 비면 builtin 만.
 *
 * 응답의 entries 는 list metadata 만 포함 — content 는 빈 문자열. 사용자가
 * "Install" 클릭 시 클라가 detail endpoint 로 본문을 받아 prefill.
 */
specsRoute.get("/marketplace", async (c) => {
  const source = c.req.query("source") ?? "all";
  if (source === "builtin") {
    return c.json({ entries: BUILTIN_SKILLS });
  }
  if (source === "skills.sh") {
    const remote = await fetchSkillsShCatalog();
    return c.json({ entries: remote });
  }
  // all
  const remote = await fetchSkillsShCatalog();
  const merged = remote.length > 0
    ? [...BUILTIN_SKILLS, ...remote]
    : BUILTIN_SKILLS;
  return c.json({ entries: merged });
});

/**
 * skills.sh entry 의 SKILL.md 본문. 카드 보는 단계엔 metadata 만 받고,
 * 사용자가 Install 클릭한 시점에 이 endpoint 로 본문을 fetch → spec.content
 * 로 박음. builtin 은 entry 안에 content 가 이미 있어 이 endpoint 안 거침.
 *
 * id 형식: "skills.sh:<source>/<slug>" (예: "skills.sh:vercel-labs/agent-skills/next-js-development")
 */
specsRoute.get("/marketplace/content", async (c) => {
  const id = c.req.query("id");
  if (!id) return c.json({ error: "missing_id" }, 400);

  // builtin 도 같은 endpoint 로 처리 — 클라가 source 구분 안 해도 되게.
  const builtin = BUILTIN_SKILLS.find((s) => s.id === id);
  if (builtin) {
    return c.json({ content: builtin.content });
  }

  if (id.startsWith("skills.sh:")) {
    const content = await fetchSkillsShDetail(id);
    if (content === null) {
      return c.json({ error: "fetch_failed" }, 502);
    }
    return c.json({ content });
  }

  return c.json({ error: "unknown_id" }, 404);
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
