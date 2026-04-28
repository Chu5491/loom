import { randomUUID } from "node:crypto";
import type { Run, RunStatus } from "@loom/core";
import { getDb } from "./client.js";

interface RunRow {
  id: string;
  agent_id: string;
  parent_run_id: string | null;
  prompt: string;
  attached_spec_ids: string;
  cwd: string;
  status: string;
  exit_code: number | null;
  pid: number | null;
  log_path: string | null;
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
    parentRunId: row.parent_run_id,
    prompt: row.prompt,
    attachedSpecIds,
    cwd: row.cwd,
    status: row.status as RunStatus,
    exitCode: row.exit_code,
    pid: row.pid,
    logPath: row.log_path,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
  };
}

export interface CreateRunInput {
  agentId: string;
  parentRunId?: string | null;
  prompt: string;
  attachedSpecIds?: string[];
  cwd: string;
}

export function createRun(input: CreateRunInput): Run {
  const id = randomUUID();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO runs (id, agent_id, parent_run_id, prompt, attached_spec_ids,
                         cwd, status, exit_code, pid, log_path,
                         started_at, ended_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', NULL, NULL, NULL, NULL, NULL, ?)`,
    )
    .run(
      id,
      input.agentId,
      input.parentRunId ?? null,
      input.prompt,
      JSON.stringify(input.attachedSpecIds ?? []),
      input.cwd,
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

export function setRunLogPath(id: string, logPath: string): void {
  getDb().prepare("UPDATE runs SET log_path = ? WHERE id = ?").run(logPath, id);
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
