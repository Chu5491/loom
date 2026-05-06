// 프로젝트의 git 상태/diff/스테이지/커밋/로그 엔드포인트.

import { Hono } from "hono";
import { z } from "zod";
import { getProject } from "../db/projects.js";
import {
  checkout,
  commit,
  fetch as gitFetchOp,
  getCommitFileDiff,
  getCommitInfo,
  getDiff,
  getLog,
  getStatus,
  getUntrackedDiff,
  listBranches,
  NotAGitRepoError,
  pull as gitPullOp,
  push as gitPushOp,
  stage,
  unstage,
} from "../services/git.js";

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

// 라우트 내부에서 인라인으로 응답 생성 — 헬퍼 추출하면 Context 제네릭 분기가
// `never`로 좁혀지는 Hono 타입 이슈 발생.

gitRoute.get("/projects/:id/git/status", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  try {
    return c.json({ status: await getStatus(project.path) });
  } catch (err) {
    if (err instanceof NotAGitRepoError) return c.json({ error: "not_a_git_repo" }, 409);
    return c.json(
      { error: "git_failed", message: (err as Error).message },
      500,
    );
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
    if (err instanceof NotAGitRepoError) return c.json({ error: "not_a_git_repo" }, 409);
    return c.json(
      { error: "git_failed", message: (err as Error).message },
      500,
    );
  }
});

gitRoute.post("/projects/:id/git/stage", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const body = await c.req.json().catch(() => null);
  const parsed = stageSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  try {
    await stage(project.path, parsed.data.paths);
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof NotAGitRepoError) return c.json({ error: "not_a_git_repo" }, 409);
    return c.json(
      { error: "git_failed", message: (err as Error).message },
      500,
    );
  }
});

gitRoute.post("/projects/:id/git/unstage", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const body = await c.req.json().catch(() => null);
  const parsed = stageSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  try {
    await unstage(project.path, parsed.data.paths);
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof NotAGitRepoError) return c.json({ error: "not_a_git_repo" }, 409);
    return c.json(
      { error: "git_failed", message: (err as Error).message },
      500,
    );
  }
});

gitRoute.post("/projects/:id/git/commit", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const body = await c.req.json().catch(() => null);
  const parsed = commitSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  try {
    const result = await commit(project.path, parsed.data.message);
    return c.json(result);
  } catch (err) {
    if (err instanceof NotAGitRepoError) return c.json({ error: "not_a_git_repo" }, 409);
    return c.json(
      { error: "git_failed", message: (err as Error).message },
      500,
    );
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
    if (err instanceof NotAGitRepoError) return c.json({ error: "not_a_git_repo" }, 409);
    return c.json(
      { error: "git_failed", message: (err as Error).message },
      500,
    );
  }
});

gitRoute.get("/projects/:id/git/branches", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  try {
    const branches = await listBranches(project.path);
    return c.json({ branches });
  } catch (err) {
    if (err instanceof NotAGitRepoError) return c.json({ error: "not_a_git_repo" }, 409);
    return c.json(
      { error: "git_failed", message: (err as Error).message },
      500,
    );
  }
});

gitRoute.post("/projects/:id/git/checkout", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const body = await c.req.json().catch(() => null);
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  try {
    await checkout(project.path, parsed.data.branch);
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof NotAGitRepoError) return c.json({ error: "not_a_git_repo" }, 409);
    return c.json(
      { error: "git_failed", message: (err as Error).message },
      500,
    );
  }
});

gitRoute.get("/projects/:id/git/commits/:sha", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const sha = c.req.param("sha");
  // sha 형식 가벼운 검증 — 영숫자만, 4-64.
  if (!/^[0-9a-f]{4,64}$/i.test(sha)) {
    return c.json({ error: "invalid_sha" }, 400);
  }
  try {
    const info = await getCommitInfo(project.path, sha);
    return c.json({ commit: info });
  } catch (err) {
    if (err instanceof NotAGitRepoError) return c.json({ error: "not_a_git_repo" }, 409);
    return c.json(
      { error: "git_failed", message: (err as Error).message },
      500,
    );
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
    if (err instanceof NotAGitRepoError) return c.json({ error: "not_a_git_repo" }, 409);
    return c.json(
      { error: "git_failed", message: (err as Error).message },
      500,
    );
  }
});

gitRoute.post("/projects/:id/git/fetch", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const body = await c.req.json().catch(() => null);
  const parsed = fetchSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  try {
    const result = await gitFetchOp(project.path, parsed.data ?? {});
    return c.json({ ok: true, output: result.output });
  } catch (err) {
    if (err instanceof NotAGitRepoError) return c.json({ error: "not_a_git_repo" }, 409);
    return c.json(
      { error: "git_failed", message: (err as Error).message },
      500,
    );
  }
});

gitRoute.post("/projects/:id/git/pull", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const body = await c.req.json().catch(() => null);
  const parsed = pullSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  try {
    const result = await gitPullOp(project.path, parsed.data ?? {});
    return c.json({ ok: true, output: result.output });
  } catch (err) {
    if (err instanceof NotAGitRepoError) return c.json({ error: "not_a_git_repo" }, 409);
    return c.json(
      { error: "git_failed", message: (err as Error).message },
      500,
    );
  }
});

gitRoute.post("/projects/:id/git/push", async (c) => {
  const project = getProject(c.req.param("id"));
  if (!project) return c.json({ error: "project_not_found" }, 404);
  const body = await c.req.json().catch(() => null);
  const parsed = pushSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  try {
    const result = await gitPushOp(project.path, parsed.data ?? {});
    return c.json({ ok: true, output: result.output });
  } catch (err) {
    if (err instanceof NotAGitRepoError) return c.json({ error: "not_a_git_repo" }, 409);
    return c.json(
      { error: "git_failed", message: (err as Error).message },
      500,
    );
  }
});
