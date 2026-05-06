import { randomUUID } from "node:crypto";
import type { Run, RunStatus } from "@loom/core";
import { getDb } from "./client.js";

interface RunRow {
  id: string;
  agent_id: string;
  thread_id: string | null;
  parent_run_id: string | null;
  prompt: string;
  attached_spec_ids: string;
  cwd: string;
  status: string;
  exit_code: number | null;
  pid: number | null;
  log_path: string | null;
  before_ref: string | null;
  after_ref: string | null;
  cost_usd: number | null;
  session_id: string | null;
  resumed_session_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

function rowToRun(row: RunRow): Run {
  let attachedSpecIds: string[] = [];
  try {
    const parsed = JSON.parse(row.attached_spec_ids);
    if (Array.isArray(parsed)) attachedSpecIds = parsed.filter((x): x is string => typeof x === "string");
  } catch {
    // legacy rows or malformed JSON → empty
  }
  return {
    id: row.id,
    agentId: row.agent_id,
    threadId: row.thread_id,
    parentRunId: row.parent_run_id,
    prompt: row.prompt,
    attachedSpecIds,
    cwd: row.cwd,
    status: row.status as RunStatus,
    exitCode: row.exit_code,
    pid: row.pid,
    logPath: row.log_path,
    beforeRef: row.before_ref,
    afterRef: row.after_ref,
    costUsd: row.cost_usd,
    sessionId: row.session_id,
    resumedSessionId: row.resumed_session_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
  };
}

export interface CreateRunInput {
  agentId: string;
  threadId: string | null;
  parentRunId?: string | null;
  prompt: string;
  attachedSpecIds?: string[];
  cwd: string;
  /** Session id this run attempts to resume from. Persisted so we can
   *  identify poisoned sessions if this run fails. */
  resumedSessionId?: string | null;
}

export function createRun(input: CreateRunInput): Run {
  const id = randomUUID();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO runs (id, agent_id, thread_id, parent_run_id, prompt, attached_spec_ids,
                         cwd, status, exit_code, pid, log_path,
                         resumed_session_id,
                         started_at, ended_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', NULL, NULL, NULL, ?, NULL, NULL, ?)`,
    )
    .run(
      id,
      input.agentId,
      input.threadId,
      input.parentRunId ?? null,
      input.prompt,
      JSON.stringify(input.attachedSpecIds ?? []),
      input.cwd,
      input.resumedSessionId ?? null,
      now,
    );
  return getRun(id)!;
}

export function getRun(id: string): Run | null {
  const row = getDb()
    .prepare<[string], RunRow>("SELECT * FROM runs WHERE id = ?")
    .get(id);
  return row ? rowToRun(row) : null;
}

export interface ListRunsFilter {
  agentId?: string;
  threadId?: string;
  parentRunId?: string;
  status?: RunStatus;
  limit?: number;
}

export function listRuns(filter: ListRunsFilter = {}): Run[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.agentId) {
    where.push("agent_id = ?");
    params.push(filter.agentId);
  }
  if (filter.threadId) {
    where.push("thread_id = ?");
    params.push(filter.threadId);
  }
  if (filter.parentRunId) {
    where.push("parent_run_id = ?");
    params.push(filter.parentRunId);
  }
  if (filter.status) {
    where.push("status = ?");
    params.push(filter.status);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = filter.limit ?? 100;
  const sql = `SELECT * FROM runs ${whereSql} ORDER BY created_at DESC LIMIT ?`;
  const rows = getDb()
    .prepare<unknown[], RunRow>(sql)
    .all(...params, limit);
  return rows.map(rowToRun);
}

/** 한 프로젝트 안에서 진행 중(queued/running) 인 run 들. agent_id 로 join 해
 *  필터. 사용자가 프로젝트를 떠나기 전에 "지금 N개 돌고 있어요" 알림 띄울 때 사용. */
export function listActiveRunsByProject(projectId: string): Run[] {
  const rows = getDb()
    .prepare<[string], RunRow>(
      `SELECT r.* FROM runs r
       JOIN agents a ON r.agent_id = a.id
       WHERE a.project_id = ?
         AND r.status IN ('queued', 'running')
       ORDER BY r.created_at DESC`,
    )
    .all(projectId);
  return rows.map(rowToRun);
}

export function setRunLogPath(id: string, logPath: string): void {
  getDb().prepare("UPDATE runs SET log_path = ? WHERE id = ?").run(logPath, id);
}

export function setRunBeforeRef(id: string, ref: string | null): void {
  getDb().prepare("UPDATE runs SET before_ref = ? WHERE id = ?").run(ref, id);
}

export function setRunAfterRef(id: string, ref: string | null): void {
  getDb().prepare("UPDATE runs SET after_ref = ? WHERE id = ?").run(ref, id);
}

export function setRunCostUsd(id: string, cost: number): void {
  getDb().prepare("UPDATE runs SET cost_usd = ? WHERE id = ?").run(cost, id);
}

export function setRunSessionId(id: string, sessionId: string): void {
  getDb()
    .prepare("UPDATE runs SET session_id = ? WHERE id = ?")
    .run(sessionId, id);
}

/** Drop every captured CLI session id in this thread, forcing the
 *  next run to start a fresh conversation. Used by the "reset session"
 *  thread-bar action when the user wants to break out of a stale-resume
 *  loop or just clear the context that's been accumulating. */
export function clearThreadSessionIds(threadId: string): number {
  const r = getDb()
    .prepare(
      `UPDATE runs SET session_id = NULL, resumed_session_id = NULL
       WHERE thread_id = ?`,
    )
    .run(threadId);
  return r.changes;
}

/** Most recent (thread, agent) session id that's safe to resume.
 *
 *  Two layers of safety:
 *
 *    1. We only inherit from runs that exited `succeeded` — failed
 *       runs may have left the CLI session in a half-baked state.
 *
 *    2. If a *later* failed run already tried to resume some session
 *       id, that id is "poisoned" and we never hand it out again. The
 *       CLI typically rejects an expired session with a hard error
 *       ("no conversation found with session ID …") which crashes
 *       every subsequent run unless we forget the dead id and start
 *       a fresh session. Cascading skip handles the case where the
 *       prior succeeded run's id is the poisoned one — we move on to
 *       the next-most-recent succeeded session, or fall back to null
 *       (meaning: don't pass --resume, start fresh). */
export function getLatestSessionId(args: {
  threadId: string;
  agentId: string;
}): string | null {
  const recent = getDb()
    .prepare<
      [string, string],
      {
        status: string;
        session_id: string | null;
        resumed_session_id: string | null;
      }
    >(
      `SELECT status, session_id, resumed_session_id
       FROM runs
       WHERE thread_id = ? AND agent_id = ?
       ORDER BY created_at DESC
       LIMIT 30`,
    )
    .all(args.threadId, args.agentId);

  // First pass: collect every session id that a failed/cancelled run
  // tried to resume from. Those are stale on the CLI side.
  const poisoned = new Set<string>();
  for (const r of recent) {
    if (
      (r.status === "failed" || r.status === "cancelled") &&
      r.resumed_session_id
    ) {
      poisoned.add(r.resumed_session_id);
    }
  }

  // Second pass: walk newest → oldest, return the first succeeded
  // session id that hasn't been poisoned.
  for (const r of recent) {
    if (
      r.status === "succeeded" &&
      r.session_id &&
      !poisoned.has(r.session_id)
    ) {
      return r.session_id;
    }
  }
  return null;
}

export function markRunRunning(id: string, pid: number | null): void {
  getDb()
    .prepare(
      `UPDATE runs SET status = 'running', pid = ?, started_at = ? WHERE id = ?`,
    )
    .run(pid, new Date().toISOString(), id);
}

export function markRunFinished(
  id: string,
  status: Extract<RunStatus, "succeeded" | "failed" | "cancelled">,
  exitCode: number | null,
): void {
  getDb()
    .prepare(
      `UPDATE runs SET status = ?, exit_code = ?, ended_at = ? WHERE id = ?`,
    )
    .run(status, exitCode, new Date().toISOString(), id);
}

export function markOrphanedRunsFailed(): number {
  const result = getDb()
    .prepare(
      `UPDATE runs SET status = 'failed', ended_at = ?
       WHERE status IN ('queued', 'running')`,
    )
    .run(new Date().toISOString());
  return result.changes;
}
