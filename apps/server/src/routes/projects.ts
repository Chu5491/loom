import { Hono } from "hono";
import { z } from "zod";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from "../db/projects.js";

const createSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  description: z.string().nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
});

export const projectsRoute = new Hono();

projectsRoute.get("/", (c) => c.json({ projects: listProjects() }));

projectsRoute.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  }
  const project = createProject(parsed.data);
  return c.json({ project }, 201);
});

projectsRoute.get("/:id", (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "not_found" }, 404);
  return c.json({ project });
});

projectsRoute.patch("/:id", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  }
  const project = updateProject(c.req.param("id"), parsed.data);
  if (!project) return c.json({ error: "not_found" }, 404);
  return c.json({ project });
});

projectsRoute.delete("/:id", (c) => {
  const ok = deleteProject(c.req.param("id"));
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.body(null, 204);
});
