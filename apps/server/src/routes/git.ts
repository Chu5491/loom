// 프로젝트의 git 상태/diff/스테이지/커밋/로그 엔드포인트.

import { Hono } from "hono";
import { z } from "zod";
import { getProject } from "../db/projects.js";
import {
  applyPatch,
  applyStash,
  checkout,
  commit,
  createBranch,
  createPullRequest,
  deleteBranch,
  dropStash,
  fetch as gitFetchOp,
  getCollaborators,
  getCommitFileDiff,
  getCommitInfo,
  getDiff,
  getLog,
  getStatus,
  getUntrackedDiff,
  getWorkingTreeSides,
  GhNotInstalledError,
  listBranches,
  listStash,
  popStash,
  probeGh,
  pull as gitPullOp,
  push as gitPushOp,
  renameBranch,
  saveStash,
  stage,
  unstage,
} from "../services/git.js";
import { gitError, isResponse, parseBody } from "./helpers.js";

export const gitRoute = new Hono();

const stageSchema = z.object({
  paths: z.array(z.string().min(1)).min(1),
});
const commitSchema = z.object({
  message: z.string().min(1),
});
const checkoutSchema = z.object({
  branch: z.string().min(1),
});
const fetchSchema = z
  .object({
    remote: z.string().optional(),
    prune: z.boolean().optional(),
  })
  .optional();
const pullSchema = z
  .object({
    remote: z.string().optional(),
    branch: z.string().optional(),
    rebase: z.boolean().optional(),
  })
  .optional();
const pushSchema = z
  .object({
    remote: z.string().optional(),
    branch: z.string().optional(),
    setUpstream: z.boolean().optional(),
    force: z.boolean().optional(),
  })
  .optional();

const branchNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[^\s][^\s]*$/, "no_whitespace");

const createBranchSchema = z.object({
  name: branchNameSchema,
  startPoint: z.string().optional(),
  checkout: z.boolean().optional(),
});
const renameBranchSchema = z.object({
  oldName: branchNameSchema,
  newName: branchNameSchema,
});
const deleteBranchSchema = z
  .object({
    force: z.boolean().optional(),
  })
  .optional();

const stashSaveSchema = z
  .object({
    message: z.string().max(500).optional(),
    includeUntracked: z.boolean().optional(),
  })
  .optional();

const applyPatchSchema = z.object({
  patch: z.string().min(1).max(4 * 1024 * 1024),
  cached: z.boolean().optional(),
  reverse: z.boolean().optional(),
});

const createPrSchema = z.object({
  title: z.string().min(1).max(280),
  body: z.string().max(64 * 1024),
  base: z.string().optional(),
  draft: z.boolean().optional(),
});

gitRoute.get("/projects/:id/git/status", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  try {
    return c.json({ status: await getStatus(project.path) });
  } catch (err) {
    return gitError(c, err);
  }
});

gitRoute.get("/projects/:id/git/diff", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const path = c.req.query("path");
  if (!path) return c.json({ error: "missing_path" }, 400);
  const staged = c.req.query("staged") === "1";
  const untracked = c.req.query("untracked") === "1";
  try {
    const diff = untracked
      ? await getUntrackedDiff(project.path, path)
      : await getDiff(project.path, path, staged);
    return c.json({ diff });
  } catch (err) {
    return gitError(c, err);
  }
});

gitRoute.get("/projects/:id/git/sides", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const path = c.req.query("path");
  if (!path) return c.json({ error: "missing_path" }, 400);
  const staged = c.req.query("staged") === "1";
  const untracked = c.req.query("untracked") === "1";
  try {
    const sides = await getWorkingTreeSides(project.path, path, staged, untracked);
    return c.json(sides);
  } catch (err) {
    return gitError(c, err);
  }
});

gitRoute.post("/projects/:id/git/stage", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const data = await parseBody(c, stageSchema);
  if (isResponse(data)) return data;
  try {
    await stage(project.path, data.paths);
    return c.json({ ok: true });
  } catch (err) {
    return gitError(c, err);
  }
});

gitRoute.post("/projects/:id/git/unstage", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const data = await parseBody(c, stageSchema);
  if (isResponse(data)) return data;
  try {
    await unstage(project.path, data.paths);
    return c.json({ ok: true });
  } catch (err) {
    return gitError(c, err);
  }
});

gitRoute.post("/projects/:id/git/commit", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const data = await parseBody(c, commitSchema);
  if (isResponse(data)) return data;
  try {
    const result = await commit(project.path, data.message);
    return c.json(result);
  } catch (err) {
    return gitError(c, err);
  }
});

gitRoute.get("/projects/:id/git/log", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const limitParam = c.req.query("limit");
  const limit = limitParam ? Math.min(500, Math.max(1, parseInt(limitParam, 10) || 100)) : 100;
  const all = c.req.query("all") === "1";
  try {
    const entries = await getLog(project.path, { limit, allBranches: all });
    return c.json({ entries });
  } catch (err) {
    return gitError(c, err);
  }
});

gitRoute.get("/projects/:id/git/collaborators", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  try {
    const collaborators = await getCollaborators(project.path);
    return c.json({ collaborators });
  } catch (err) {
    return gitError(c, err);
  }
});

gitRoute.get("/projects/:id/git/branches", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  try {
    const branches = await listBranches(project.path);
    return c.json({ branches });
  } catch (err) {
    return gitError(c, err);
  }
});

gitRoute.post("/projects/:id/git/checkout", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const data = await parseBody(c, checkoutSchema);
  if (isResponse(data)) return data;
  try {
    await checkout(project.path, data.branch);
    return c.json({ ok: true });
  } catch (err) {
    return gitError(c, err);
  }
});

// ── branches: create / rename / delete ───────────────────────────────────

gitRoute.post("/projects/:id/git/branches", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const data = await parseBody(c, createBranchSchema);
  if (isResponse(data)) return data;
  try {
    await createBranch(project.path, data.name, {
      startPoint: data.startPoint,
      checkout: data.checkout,
    });
    return c.json({ ok: true }, 201);
  } catch (err) {
    return gitError(c, err);
  }
});

gitRoute.patch("/projects/:id/git/branches", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const data = await parseBody(c, renameBranchSchema);
  if (isResponse(data)) return data;
  try {
    await renameBranch(project.path, data.oldName, data.newName);
    return c.json({ ok: true });
  } catch (err) {
    return gitError(c, err);
  }
});

gitRoute.delete("/projects/:id/git/branches/:name", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const name = c.req.param("name");
  const force = c.req.query("force") === "1";
  if (!name) return c.json({ error: "missing_name" }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = deleteBranchSchema.safeParse(body);
  const opts = { force: force || (parsed.success && parsed.data?.force) || false };
  try {
    await deleteBranch(project.path, name, opts);
    return c.json({ ok: true });
  } catch (err) {
    return gitError(c, err);
  }
});

// ── stash ────────────────────────────────────────────────────────────────

gitRoute.get("/projects/:id/git/stash", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  try {
    const entries = await listStash(project.path);
    return c.json({ entries });
  } catch (err) {
    return gitError(c, err);
  }
});

gitRoute.post("/projects/:id/git/stash", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const data = await parseBody(c, stashSaveSchema);
  if (isResponse(data)) return data;
  try {
    await saveStash(project.path, data ?? {});
    return c.json({ ok: true }, 201);
  } catch (err) {
    return gitError(c, err);
  }
});

gitRoute.post("/projects/:id/git/stash/:idx/pop", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const idx = Number(c.req.param("idx"));
  if (!Number.isInteger(idx) || idx < 0) return c.json({ error: "invalid_index" }, 400);
  try {
    await popStash(project.path, idx);
    return c.json({ ok: true });
  } catch (err) {
    return gitError(c, err);
  }
});

gitRoute.post("/projects/:id/git/stash/:idx/apply", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const idx = Number(c.req.param("idx"));
  if (!Number.isInteger(idx) || idx < 0) return c.json({ error: "invalid_index" }, 400);
  try {
    await applyStash(project.path, idx);
    return c.json({ ok: true });
  } catch (err) {
    return gitError(c, err);
  }
});

gitRoute.delete("/projects/:id/git/stash/:idx", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const idx = Number(c.req.param("idx"));
  if (!Number.isInteger(idx) || idx < 0) return c.json({ error: "invalid_index" }, 400);
  try {
    await dropStash(project.path, idx);
    return c.json({ ok: true });
  } catch (err) {
    return gitError(c, err);
  }
});

// ── apply-patch (hunk-level staging) ─────────────────────────────────────

gitRoute.post("/projects/:id/git/apply-patch", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const data = await parseBody(c, applyPatchSchema);
  if (isResponse(data)) return data;
  try {
    await applyPatch(project.path, data.patch, {
      cached: data.cached,
      reverse: data.reverse,
    });
    return c.json({ ok: true });
  } catch (err) {
    return gitError(c, err);
  }
});

// ── PR (gh CLI wrapper) ──────────────────────────────────────────────────

gitRoute.get("/projects/:id/git/pr-probe", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  return c.json(await probeGh());
});

gitRoute.post("/projects/:id/git/pr", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const data = await parseBody(c, createPrSchema);
  if (isResponse(data)) return data;
  try {
    const r = await createPullRequest(project.path, data);
    return c.json({ ok: true, ...r });
  } catch (err) {
    if (err instanceof GhNotInstalledError) {
      return c.json({ error: "gh_not_installed" }, 412);
    }
    return gitError(c, err);
  }
});

gitRoute.get("/projects/:id/git/commits/:sha", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const sha = c.req.param("sha");
  if (!/^[0-9a-f]{4,64}$/i.test(sha)) {
    return c.json({ error: "invalid_sha" }, 400);
  }
  try {
    const info = await getCommitInfo(project.path, sha);
    return c.json({ commit: info });
  } catch (err) {
    return gitError(c, err);
  }
});

gitRoute.get("/projects/:id/git/commits/:sha/diff", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const sha = c.req.param("sha");
  const path = c.req.query("path");
  if (!/^[0-9a-f]{4,64}$/i.test(sha)) {
    return c.json({ error: "invalid_sha" }, 400);
  }
  if (!path) return c.json({ error: "missing_path" }, 400);
  try {
    const diff = await getCommitFileDiff(project.path, sha, path);
    return c.json({ diff });
  } catch (err) {
    return gitError(c, err);
  }
});

gitRoute.post("/projects/:id/git/fetch", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const data = await parseBody(c, fetchSchema);
  if (isResponse(data)) return data;
  try {
    const result = await gitFetchOp(project.path, data ?? {});
    return c.json({ ok: true, output: result.output });
  } catch (err) {
    return gitError(c, err);
  }
});

gitRoute.post("/projects/:id/git/pull", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const data = await parseBody(c, pullSchema);
  if (isResponse(data)) return data;
  try {
    const result = await gitPullOp(project.path, data ?? {});
    return c.json({ ok: true, output: result.output });
  } catch (err) {
    return gitError(c, err);
  }
});

gitRoute.post("/projects/:id/git/push", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const data = await parseBody(c, pushSchema);
  if (isResponse(data)) return data;
  try {
    const result = await gitPushOp(project.path, data ?? {});
    return c.json({ ok: true, output: result.output });
  } catch (err) {
    return gitError(c, err);
  }
});
