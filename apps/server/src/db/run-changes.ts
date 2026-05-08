import type { RunChange } from "@loom/core";
import { getDb } from "./client.js";

interface RunChangeRow {
  run_id: string;
  path: string;
  from_path: string | null;
  status: string;
  additions: number;
  deletions: number;
}

function rowToChange(row: RunChangeRow): RunChange {
  return {
    path: row.path,
    fromPath: row.from_path ?? undefined,
    status: row.status as RunChange["status"],
    additions: row.additions,
    deletions: row.deletions,
  };
}

/**
 * Replace the recorded changes for a run with a fresh set. Used after a
 * run finishes — we wipe any partial rows (an earlier crash, a re-run
 * with the same id, etc.) and write the authoritative snapshot.
 *
 * One transaction so we never see a half-written change list.
 */
export function replaceRunChanges(runId: string, changes: RunChange[]): void {
  const db = getDb();
  const del = db.prepare("DELETE FROM run_changes WHERE run_id = ?");
  const ins = db.prepare(
    `INSERT INTO run_changes (run_id, path, from_path, status, additions, deletions)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction((list: RunChange[]) => {
    del.run(runId);
    for (const c of list) {
      ins.run(
        runId,
        c.path,
        c.fromPath ?? null,
        c.status,
        c.additions,
        c.deletions,
      );
    }
  });
  tx(changes);
}

export function listChangesForRun(runId: string): RunChange[] {
  const rows = getDb()
    .prepare<[string], RunChangeRow>(
      `SELECT * FROM run_changes WHERE run_id = ? ORDER BY path`,
    )
    .all(runId);
  return rows.map(rowToChange);
}

export interface FileHistoryEntry {
  runId: string;
  status: RunChange["status"];
  additions: number;
  deletions: number;
  fromPath?: string;
}

export interface TouchedPath {
  path: string;
  /** ISO timestamp of the most recent run that touched this path. */
  lastTouchedAt: string;
  /** Agent that did the most recent touch — UI uses this to color-code. */
  lastAgentId: string;
  /** 누적 추가/삭제 라인 — 파일 트리에 ` +12 -3 ` 표시용. 모든 run 합산. */
  totalAdditions: number;
  totalDeletions: number;
}

/**
 * Every file path touched by any run in this project, with the most
 * recent agent + time + 누적 변경 라인. Used by the file tree to mark
 * "this file has been modified by an agent" with a dot + line counts.
 */
export function listTouchedPaths(projectPath: string): TouchedPath[] {
  // 두 단계로 분리: (1) per-path 누적 +/- 합산, (2) 가장 최근 toucher 찾기.
  // SQLite 의 MAX + non-aggregate column 트릭 (3.7.11+) 으로 한 쿼리에 다.
  const rows = getDb()
    .prepare<
      [string],
      {
        path: string;
        last_touched_at: string;
        last_agent_id: string;
        total_additions: number;
        total_deletions: number;
      }
    >(
      `SELECT rc.path,
              MAX(r.created_at)        as last_touched_at,
              r.agent_id               as last_agent_id,
              COALESCE(SUM(rc.additions), 0) as total_additions,
              COALESCE(SUM(rc.deletions), 0) as total_deletions
       FROM run_changes rc
       JOIN runs r ON r.id = rc.run_id
       WHERE r.cwd = ?
       GROUP BY rc.path`,
    )
    .all(projectPath);
  return rows.map((row) => ({
    path: row.path,
    lastTouchedAt: row.last_touched_at,
    lastAgentId: row.last_agent_id,
    totalAdditions: row.total_additions,
    totalDeletions: row.total_deletions,
  }));
}

/**
 * Every run that touched the given file path, newest first. Joined with
 * `runs` so callers can enrich with agent / timestamp on the way out
 * (kept here as a flat list of run ids + change stats — the route layer
 * fetches the runs).
 */
export function listRunsForPath(
  projectPath: string,
  filePath: string,
): FileHistoryEntry[] {
  // Project scoping: a path can collide across projects (different repos
  // both have src/index.ts). We restrict by joining through the run's
  // cwd matching the project's path, treating identical cwd strings as
  // "same project."
  const rows = getDb()
    .prepare<
      [string, string],
      RunChangeRow & { created_at: string }
    >(
      `SELECT rc.*, r.created_at
       FROM run_changes rc
       JOIN runs r ON r.id = rc.run_id
       WHERE rc.path = ? AND r.cwd = ?
       ORDER BY r.created_at DESC`,
    )
    .all(filePath, projectPath);
  return rows.map((row) => ({
    runId: row.run_id,
    status: row.status as RunChange["status"],
    additions: row.additions,
    deletions: row.deletions,
    fromPath: row.from_path ?? undefined,
  }));
}

export interface FileHistoryHydratedEntry {
  runId: string;
  agentId: string;
  agentName: string | null;
  adapterKind: string | null;
  status: RunChange["status"];
  additions: number;
  deletions: number;
  fromPath: string | undefined;
  runStatus: string;
  createdAt: string;
  endedAt: string | null;
}

interface HydratedRow extends RunChangeRow {
  run_status: string;
  created_at: string;
  ended_at: string | null;
  agent_id: string;
  agent_name: string | null;
  adapter_kind: string | null;
}

// runs + agents 조인된 단일 쿼리. route 핸들러의 N+1을 제거.
export function listFileHistoryHydrated(
  projectPath: string,
  filePath: string,
): FileHistoryHydratedEntry[] {
  const rows = getDb()
    .prepare<[string, string], HydratedRow>(
      `SELECT rc.*,
              r.status     AS run_status,
              r.created_at AS created_at,
              r.ended_at   AS ended_at,
              r.agent_id   AS agent_id,
              a.name       AS agent_name,
              a.adapter_kind AS adapter_kind
       FROM run_changes rc
       JOIN runs r ON r.id = rc.run_id
       LEFT JOIN agents a ON a.id = r.agent_id
       WHERE rc.path = ? AND r.cwd = ?
       ORDER BY r.created_at DESC`,
    )
    .all(filePath, projectPath);
  return rows.map((row) => ({
    runId: row.run_id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    adapterKind: row.adapter_kind,
    status: row.status as RunChange["status"],
    additions: row.additions,
    deletions: row.deletions,
    fromPath: row.from_path ?? undefined,
    runStatus: row.run_status,
    createdAt: row.created_at,
    endedAt: row.ended_at,
  }));
}
