import { randomUUID } from "node:crypto";
import type { Thread, ThreadStatus } from "@loom/core";
import { getDb } from "./client.js";

interface ThreadRow {
  id: string;
  project_id: string;
  name: string;
  status: string;
  context_bundle: string;
  worktree_path: string | null;
  created_at: string;
  updated_at: string;
}

function rowToThread(row: ThreadRow): Thread {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    status: row.status as ThreadStatus,
    contextBundle: row.context_bundle,
    worktreePath: row.worktree_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateThreadInput {
  projectId: string;
  name: string;
}

export function createThread(input: CreateThreadInput): Thread {
  const id = randomUUID();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO threads (id, project_id, name, status, context_bundle, created_at, updated_at)
       VALUES (?, ?, ?, 'active', '', ?, ?)`,
    )
    .run(id, input.projectId, input.name, now, now);
  return getThread(id)!;
}

export function getThread(id: string): Thread | null {
  const row = getDb()
    .prepare<[string], ThreadRow>("SELECT * FROM threads WHERE id = ?")
    .get(id);
  return row ? rowToThread(row) : null;
}

export interface ListThreadsFilter {
  projectId?: string;
  status?: ThreadStatus;
  limit?: number;
}

/**
 * List threads. Order is "most recently active first" — measured by
 * `updated_at`, which run-service bumps every time a run lands in the
 * thread. That keeps the active conversation pinned at the top of the
 * sidebar without anyone having to track "last activity" separately.
 */
export function listThreads(filter: ListThreadsFilter = {}): Thread[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.projectId) {
    where.push("project_id = ?");
    params.push(filter.projectId);
  }
  if (filter.status) {
    where.push("status = ?");
    params.push(filter.status);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = filter.limit ?? 200;
  const sql = `SELECT * FROM threads ${whereSql} ORDER BY updated_at DESC LIMIT ?`;
  const rows = getDb()
    .prepare<unknown[], ThreadRow>(sql)
    .all(...params, limit);
  return rows.map(rowToThread);
}

export interface UpdateThreadInput {
  name?: string;
  status?: ThreadStatus;
  contextBundle?: string;
}

export function updateThread(
  id: string,
  patch: UpdateThreadInput,
): Thread | null {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    params.push(patch.name);
  }
  if (patch.status !== undefined) {
    sets.push("status = ?");
    params.push(patch.status);
  }
  if (patch.contextBundle !== undefined) {
    sets.push("context_bundle = ?");
    params.push(patch.contextBundle);
  }
  if (sets.length === 0) return getThread(id);
  sets.push("updated_at = ?");
  params.push(new Date().toISOString());
  params.push(id);
  getDb()
    .prepare(`UPDATE threads SET ${sets.join(", ")} WHERE id = ?`)
    .run(...params);
  return getThread(id);
}

export function setThreadWorktreePath(
  id: string,
  path: string | null,
): void {
  getDb()
    .prepare("UPDATE threads SET worktree_path = ?, updated_at = ? WHERE id = ?")
    .run(path, new Date().toISOString(), id);
}

/**
 * Bump a thread's `updated_at` without changing other fields. Called
 * from run-service whenever a new run lands in the thread so the list
 * order in the UI tracks real activity, not the create-once timestamp.
 */
export function touchThread(id: string): void {
  getDb()
    .prepare("UPDATE threads SET updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
}

export function listAllThreadIds(): Set<string> {
  const rows = getDb()
    .prepare<[], { id: string }>("SELECT id FROM threads")
    .all();
  return new Set(rows.map((r) => r.id));
}

export function deleteThread(id: string): boolean {
  const r = getDb().prepare("DELETE FROM threads WHERE id = ?").run(id);
  return r.changes > 0;
}

// ── Thread ↔ Agent membership ─────────────────────────────────────

/** List agent IDs that have been added to a thread for @mention routing. */
export function listThreadAgentIds(threadId: string): string[] {
  return getDb()
    .prepare<[string], { agent_id: string }>(
      `SELECT agent_id FROM thread_agents WHERE thread_id = ? ORDER BY joined_at ASC`,
    )
    .all(threadId)
    .map((r) => r.agent_id);
}

/** Add an agent to a thread (idempotent — duplicate is silently ignored). */
export function addAgentToThread(threadId: string, agentId: string): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO thread_agents (thread_id, agent_id, joined_at) VALUES (?, ?, ?)`,
    )
    .run(threadId, agentId, new Date().toISOString());
}

/** Remove an agent from a thread. */
export function removeAgentFromThread(threadId: string, agentId: string): void {
  getDb()
    .prepare(`DELETE FROM thread_agents WHERE thread_id = ? AND agent_id = ?`)
    .run(threadId, agentId);
}
