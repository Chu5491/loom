import { Hono } from "hono";
import { z } from "zod";
import { isResponse, parseBody } from "./helpers.js";
import {
  createAgent,
  deleteAgent,
  getAgent,
  listAgents,
  updateAgent,
} from "../db/agents.js";
import { getProject } from "../db/projects.js";
import {
  addAgentToProject,
  isAgentInProject,
  removeAgentFromProject,
} from "../db/project-agents.js";
import { deleteEdgesForAgentInProject } from "../db/harness-edges.js";

const adapterConfigSchema = z.record(z.string(), z.unknown());

const roleSchema = z
  .enum(["engineer", "researcher", "reviewer", "writer", "other"])
  .nullable();

const adapterKindSchema = z.enum([
  "claude-code",
  "antigravity",
  "codex",
  "opencode",
  "devin",
]);

const createSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  mentionName: z.string().min(1).max(30).regex(/^\w[\w-]*$/).nullable().optional(),
  prompt: z.string().optional(),
  skillIds: z.array(z.string()).optional(),
  mcpServerIds: z.array(z.string()).optional(),
  role: roleSchema.optional(),
  adapterKind: adapterKindSchema,
  adapterConfig: adapterConfigSchema.optional(),
  defaultCwd: z.string().nullable().optional(),
});

const updateSchema = z.object({
  projectId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  mentionName: z.string().min(1).max(30).regex(/^\w[\w-]*$/).nullable().optional(),
  prompt: z.string().optional(),
  skillIds: z.array(z.string()).optional(),
  mcpServerIds: z.array(z.string()).optional(),
  role: roleSchema.optional(),
  adapterKind: adapterKindSchema.optional(),
  adapterConfig: adapterConfigSchema.optional(),
  defaultCwd: z.string().nullable().optional(),
});

export const agentsRoute = new Hono();

agentsRoute.get("/", (c) => {
  const projectId = c.req.query("projectId") || undefined;
  return c.json({ agents: listAgents({ projectId }) });
});

agentsRoute.post("/", async (c) => {
  const data = await parseBody(c, createSchema);
  if (isResponse(data)) return data;
  if (!getProject(data.projectId)) {
    return c.json({ error: "project_not_found" }, 404);
  }
  const agent = createAgent(data);
  return c.json({ agent }, 201);
});

// ── Team membership: 전역 에이전트를 프로젝트 팀에 넣고 빼기 ────────────────
const teamSchema = z.object({ projectId: z.string().min(1) });

agentsRoute.post("/:id/team", async (c) => {
  const id = c.req.param("id");
  if (!getAgent(id)) return c.json({ error: "agent_not_found" }, 404);
  const data = await parseBody(c, teamSchema);
  if (isResponse(data)) return data;
  if (!getProject(data.projectId)) {
    return c.json({ error: "project_not_found" }, 404);
  }
  addAgentToProject(data.projectId, id);
  return c.json({ ok: true });
});

agentsRoute.delete("/:id/team/:projectId", (c) => {
  const id = c.req.param("id");
  const projectId = c.req.param("projectId");
  if (!isAgentInProject(projectId, id)) {
    return c.json({ error: "not_in_team" }, 404);
  }
  // 팀에서 빠지면 그 프로젝트의 관련 하네스 엣지도 정리.
  deleteEdgesForAgentInProject(projectId, id);
  removeAgentFromProject(projectId, id);
  return c.json({ ok: true });
});

agentsRoute.get("/:id", (c) => {
  const agent = getAgent(c.req.param("id"));
  if (!agent) return c.json({ error: "not_found" }, 404);
  return c.json({ agent });
});

agentsRoute.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const data = await parseBody(c, updateSchema);
  if (isResponse(data)) return data;
  const existing = getAgent(id);
  if (!existing) return c.json({ error: "not_found" }, 404);
  if (data.projectId && !getProject(data.projectId)) {
    return c.json({ error: "project_not_found" }, 404);
  }
  const agent = updateAgent(id, data);
  if (!agent) return c.json({ error: "not_found" }, 404);
  return c.json({ agent });
});

agentsRoute.delete("/:id", (c) => {
  const ok = deleteAgent(c.req.param("id"));
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.body(null, 204);
});
