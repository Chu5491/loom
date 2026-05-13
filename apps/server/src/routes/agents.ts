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

const adapterConfigSchema = z.record(z.string(), z.unknown());

const roleSchema = z
  .enum(["engineer", "researcher", "reviewer", "writer", "other"])
  .nullable();

const createSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  prompt: z.string().optional(),
  skillIds: z.array(z.string()).optional(),
  mcpServerIds: z.array(z.string()).optional(),
  role: roleSchema.optional(),
  adapterKind: z.string().min(1),
  adapterConfig: adapterConfigSchema.optional(),
  defaultCwd: z.string().nullable().optional(),
});

const updateSchema = z.object({
  projectId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  prompt: z.string().optional(),
  skillIds: z.array(z.string()).optional(),
  mcpServerIds: z.array(z.string()).optional(),
  role: roleSchema.optional(),
  adapterKind: z.string().min(1).optional(),
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
