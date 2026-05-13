import { Hono } from "hono";
import { z } from "zod";
import type { ThreadStatus } from "@loom/core";
import { getProject } from "../db/projects.js";
import { clearThreadSessionIds } from "../db/runs.js";
import type { UpdateThreadInput } from "../db/threads.js";
import {
  createThread,
  deleteThread,
  getThread,
  listThreads,
  setThreadWorktreePath,
  updateThread,
} from "../db/threads.js";
import {
  createWorktreeForThread,
  removeWorktreeForThread,
} from "../services/worktree.js";

/**
 * Threads API.
 *
 *   GET    /api/threads?projectId=…&status=…  list
 *   POST   /api/threads                       create (manual "New thread")
 *   GET    /api/threads/:id                   single
 *   PATCH  /api/threads/:id                   rename / status / contextBundle
 *   DELETE /api/threads/:id                   hard delete (runs become
 *                                             thread-less; UI hides them)
 *
 * Most threads are *implicitly* created by run-service when a run
 * starts without an explicit threadId. The POST endpoint exists for
 * the workspace's "+ New thread" button — letting the user open a
 * fresh conversation before any agent has anything to say.
 */

const createSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(120),
  /** false 를 명시하면 worktree 생성을 건너뛰고 프로젝트 path 를 공유.
   *  기본값은 true — git-first 체제에서 thread = branch + worktree. */
  isolate: z.boolean().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  status: z.enum(["active", "done", "archived"]).optional(),
  contextBundle: z.string().max(64_000).optional(),
});

export const threadsRoute = new Hono();

threadsRoute.get("/", (c) => {
  const projectId = c.req.query("projectId") ?? undefined;
  const status = c.req.query("status") as ThreadStatus | undefined;
  const limitRaw = c.req.query("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  const threads = listThreads({ projectId, status, limit });
  return c.json({ threads });
});

threadsRoute.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  }
  const project = getProject(parsed.data.projectId);
  if (!project) {
    return c.json({ error: "project_not_found" }, 404);
  }
  const thread = createThread(parsed.data);

  // git-first: 모든 thread 에 worktree + branch 를 기본 생성.
  // isolate=false 명시 시에만 건너뜀 (레거시 호환 / non-git 프로젝트 fallback).
  // 실패해도 thread 자체는 살아남고 프로젝트 path 를 공유.
  const shouldIsolate = parsed.data.isolate !== false;
  let worktreeError: string | undefined;
  if (shouldIsolate) {
    const result = await createWorktreeForThread(thread.id, project.path);
    if (result.ok) {
      setThreadWorktreePath(thread.id, result.path);
    } else {
      worktreeError = result.reason;
    }
  }

  const refreshed = getThread(thread.id) ?? thread;
  return c.json(
    worktreeError
      ? { thread: refreshed, worktreeError }
      : { thread: refreshed },
    201,
  );
});

threadsRoute.get("/:id", (c) => {
  const thread = getThread(c.req.param("id"));
  if (!thread) return c.json({ error: "not_found" }, 404);
  return c.json({ thread });
});

threadsRoute.patch("/:id", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  }
  const thread = updateThread(
    c.req.param("id"),
    parsed.data as UpdateThreadInput,
  );
  if (!thread) return c.json({ error: "not_found" }, 404);
  return c.json({ thread });
});

/**
 * Reset CLI session ids in this thread. The next run won't have a
 * resume token, so the agent starts fresh — useful when the prior
 * session went stale ("no conversation found …") or when the user
 * just wants a clean slate without creating a new thread.
 */
threadsRoute.post("/:id/reset-session", (c) => {
  const id = c.req.param("id");
  const thread = getThread(id);
  if (!thread) return c.json({ error: "not_found" }, 404);
  const cleared = clearThreadSessionIds(id);
  return c.json({ cleared });
});

threadsRoute.delete("/:id", async (c) => {
  // Capture worktree info before the row goes away so we can clean
  // up the on-disk checkout. Best-effort — delete() succeeds even if
  // worktree removal fails (the directory might already be gone).
  const thread = getThread(c.req.param("id"));
  if (!thread) return c.json({ error: "not_found" }, 404);
  const project = thread ? getProject(thread.projectId) : null;
  const ok = deleteThread(c.req.param("id"));
  if (!ok) return c.json({ error: "not_found" }, 404);
  if (thread.worktreePath && project) {
    await removeWorktreeForThread(thread.id, project.path).catch(() => {
      // already logged inside the helper
    });
  }
  return c.body(null, 204);
});
