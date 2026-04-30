import { Hono } from "hono";
import { z } from "zod";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from "../db/projects.js";
import { listRunsForPath, listTouchedPaths } from "../db/run-changes.js";
import { getRun } from "../db/runs.js";
import { getAgent } from "../db/agents.js";
import { listForProject as listActiveTouches } from "../services/active-touches.js";
import { listAllFiles, listTree, readProjectFile } from "../services/project-fs.js";

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

/**
 * One directory level inside a project. Lazy on purpose — recursive trees
 * for large repos are huge. The web tree fetches children on expand.
 *
 *   GET /api/projects/:id/tree           → root entries
 *   GET /api/projects/:id/tree?path=src  → entries inside src/
 */
projectsRoute.get("/:id/tree", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "not_found" }, 404);
  const sub = c.req.query("path") ?? "";
  const result = await listTree(project.path, sub);
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 400;
    return c.json({ error: result.reason }, status);
  }
  return c.json({ entries: result.entries });
});

/**
 * Every file in this project that's been touched by an agent, with the
 * most recent toucher and time. The file tree uses this to decorate
 * touched files with a dot — at-a-glance "what's been worked on."
 */
projectsRoute.get("/:id/touched", (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "not_found" }, 404);
  return c.json({ paths: listTouchedPaths(project.path) });
});

/**
 * Files that any currently-running agent is editing right *now*. Backed
 * by an in-memory store fed from CLI tool_use events; entries vanish
 * when the run finishes (run_changes takes over for past edits).
 *
 * The file tree polls this while a project has active runs and pulses
 * the matching rows so the user sees ambient progress without having
 * to scroll the chat.
 */
projectsRoute.get("/:id/active-touches", (c) => {
  const id = c.req.param("id");
  const project = getProject(id);
  if (!project) return c.json({ error: "not_found" }, 404);
  return c.json({ touches: listActiveTouches(id) });
});

/**
 * Every run that touched a given file in this project, newest first.
 * Each entry carries the run id, agent id (so the UI can show "@agent"),
 * status delta (added/modified/deleted), and line counts. Used by the
 * file viewer's "history" rail to bridge files ↔ chat.
 */
projectsRoute.get("/:id/file-history", (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "not_found" }, 404);
  const path = c.req.query("path");
  if (!path) return c.json({ error: "path_required" }, 400);

  const raw = listRunsForPath(project.path, path);
  // Hydrate with the run + agent so the UI doesn't need a second round
  // trip per row. Skip rows where the run is missing (cascade delete
  // race or manual cleanup).
  const entries = [];
  for (const row of raw) {
    const run = getRun(row.runId);
    if (!run) continue;
    const agent = getAgent(run.agentId);
    entries.push({
      runId: row.runId,
      agentId: run.agentId,
      agentName: agent?.name ?? null,
      adapterKind: agent?.adapterKind ?? null,
      status: row.status,
      additions: row.additions,
      deletions: row.deletions,
      fromPath: row.fromPath,
      runStatus: run.status,
      createdAt: run.createdAt,
      endedAt: run.endedAt,
    });
  }
  return c.json({ entries });
});

/**
 * Flat list of every file in the project — powers Cmd+P file search.
 * Recursive walk respecting the same hidden-dir rules as the tree
 * endpoint, capped at 50k entries to keep payloads sane on huge
 * monorepos. Clients do their own fuzzy match against the list.
 */
projectsRoute.get("/:id/files-flat", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "not_found" }, 404);
  const paths = await listAllFiles(project.path);
  return c.json({ paths });
});

/**
 * Read a single file's contents. Refuses paths that escape the project
 * root, files > 2 MiB, or anything that isn't a regular file. Binary
 * files come back with text === null so the UI can render a placeholder.
 */
projectsRoute.get("/:id/file", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "not_found" }, 404);
  const path = c.req.query("path");
  if (!path) return c.json({ error: "path_required" }, 400);
  const result = await readProjectFile(project.path, path);
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 400;
    return c.json({ error: result.reason, size: result.size }, status);
  }
  return c.json({ file: result.file });
});
