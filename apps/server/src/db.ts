// 런 기록(history) 영속 — data/loom.db. 정의(office/)가 아니라 "기록"이므로
// gitignore 되고, sqlite 는 여기에만 돌아온다(헌법: 정의는 git, 기록은 로컬).
// 슬림하게 두 테이블뿐: runs + run_events(OfficeEvent JSON 순서대로).

import Database from "better-sqlite3";
import fs from "node:fs";
import type { OfficeEvent, Project, RunInfo, Thread } from "@loom/core";
import { paths } from "./config.js";

export type DB = Database.Database;

let _db: DB | null = null;

export function getDb(): DB {
  if (_db) return _db;
  fs.mkdirSync(paths.data, { recursive: true });
  const db = new Database(paths.db);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id            TEXT PRIMARY KEY,
      agent         TEXT NOT NULL,
      prompt        TEXT NOT NULL,
      status        TEXT NOT NULL,
      started_at    TEXT NOT NULL,
      ended_at      TEXT,
      exit_code     INTEGER,
      cost_usd      REAL,
      session_id    TEXT,
      parent_run_id TEXT
    );
    CREATE TABLE IF NOT EXISTS run_events (
      run_id  TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      seq     INTEGER NOT NULL,
      event   TEXT NOT NULL,
      PRIMARY KEY (run_id, seq)
    );
    CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id);
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      path        TEXT NOT NULL UNIQUE,
      created_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS threads (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      project_id  TEXT,
      created_at  TEXT NOT NULL
    );
  `);
  // 이전 버전 db 에 없던 컬럼 자가치유(기록은 disposable이지만 안전하게).
  const cols = db.prepare<[], { name: string }>(`PRAGMA table_info(runs)`).all();
  if (!cols.some((c) => c.name === "parent_run_id")) {
    db.exec(`ALTER TABLE runs ADD COLUMN parent_run_id TEXT`);
  }
  if (!cols.some((c) => c.name === "project_id")) {
    db.exec(`ALTER TABLE runs ADD COLUMN project_id TEXT`);
  }
  if (!cols.some((c) => c.name === "thread_id")) {
    db.exec(`ALTER TABLE runs ADD COLUMN thread_id TEXT`);
    backfillThreads(db);
  }
  _db = db;
  return db;
}

// thread 도입 전의 run 들을 프로젝트별 "이전 대화" 스레드로 묶는다 — 기록 손실 없이.
function backfillThreads(db: DB): void {
  const projectIds = db
    .prepare<[], { project_id: string | null }>(`SELECT DISTINCT project_id FROM runs`)
    .all();
  for (const { project_id } of projectIds) {
    const tid = `legacy-${project_id ?? "home"}`;
    db.prepare(`INSERT OR IGNORE INTO threads (id, name, project_id, created_at) VALUES (?, ?, ?, ?)`)
      .run(tid, "이전 대화", project_id, new Date().toISOString());
    db.prepare(`UPDATE runs SET thread_id = ? WHERE project_id IS ? AND thread_id IS NULL`).run(tid, project_id);
  }
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

interface RunRow {
  id: string;
  agent: string;
  prompt: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  exit_code: number | null;
  parent_run_id: string | null;
  project_id: string | null;
  thread_id: string | null;
  cost_usd: number | null;
}
function toInfo(r: RunRow): RunInfo {
  return {
    id: r.id,
    agent: r.agent,
    prompt: r.prompt,
    status: r.status as RunInfo["status"],
    startedAt: r.started_at,
    endedAt: r.ended_at,
    exitCode: r.exit_code,
    parentRunId: r.parent_run_id,
    projectId: r.project_id,
    threadId: r.thread_id,
    costUsd: r.cost_usd,
  };
}

export function insertRun(info: RunInfo): void {
  getDb()
    .prepare(
      `INSERT INTO runs (id, agent, prompt, status, started_at, ended_at, exit_code, parent_run_id, project_id, thread_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(info.id, info.agent, info.prompt, info.status, info.startedAt, info.endedAt, info.exitCode, info.parentRunId, info.projectId, info.threadId);
}

export function appendEvent(runId: string, seq: number, event: OfficeEvent): void {
  getDb()
    .prepare(`INSERT OR IGNORE INTO run_events (run_id, seq, event) VALUES (?, ?, ?)`)
    .run(runId, seq, JSON.stringify(event));
}

export function finishRun(
  info: RunInfo,
  meta: { costUsd?: number; sessionId?: string },
): void {
  getDb()
    .prepare(
      `UPDATE runs SET status = ?, ended_at = ?, exit_code = ?, cost_usd = ?, session_id = ?
       WHERE id = ?`,
    )
    .run(info.status, info.endedAt, info.exitCode, meta.costUsd ?? null, meta.sessionId ?? null, info.id);
}

export interface RunFilter {
  projectId?: string | null;
  threadId?: string;
}
export function listRunsDb(filter: RunFilter = {}): RunInfo[] {
  const db = getDb();
  const rows =
    filter.threadId !== undefined
      ? db.prepare<[string], RunRow>(`SELECT * FROM runs WHERE thread_id = ? ORDER BY started_at DESC`).all(filter.threadId)
      : filter.projectId !== undefined
        ? db.prepare<[string | null], RunRow>(`SELECT * FROM runs WHERE project_id IS ? ORDER BY started_at DESC`).all(filter.projectId)
        : db.prepare<[], RunRow>(`SELECT * FROM runs ORDER BY started_at DESC`).all();
  return rows.map(toInfo);
}

/** 같은 스레드에서 이 에이전트가 마지막으로 남긴 CLI 세션 id — resume 용. */
export function lastSessionId(threadId: string, agent: string): string | null {
  const row = getDb()
    .prepare<[string, string], { session_id: string }>(
      `SELECT session_id FROM runs
       WHERE thread_id = ? AND agent = ? AND session_id IS NOT NULL
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get(threadId, agent);
  return row?.session_id ?? null;
}

export function getRunDb(id: string): RunInfo | null {
  const row = getDb().prepare<[string], RunRow>(`SELECT * FROM runs WHERE id = ?`).get(id);
  return row ? toInfo(row) : null;
}

export function getRunEventsDb(id: string): OfficeEvent[] {
  return getDb()
    .prepare<[string], { event: string }>(
      `SELECT event FROM run_events WHERE run_id = ? ORDER BY seq ASC`,
    )
    .all(id)
    .map((r) => JSON.parse(r.event) as OfficeEvent);
}

export function deleteRunDb(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM run_events WHERE run_id = ?`).run(id);
  db.prepare(`DELETE FROM runs WHERE id = ?`).run(id);
}

// ── threads ───────────────────────────────────────────────────────────────────
interface ThreadRow { id: string; name: string; project_id: string | null; created_at: string }
const toThread = (r: ThreadRow): Thread => ({ id: r.id, name: r.name, projectId: r.project_id, createdAt: r.created_at });

export function listThreadsDb(projectId: string | null): Thread[] {
  return getDb()
    .prepare<[string | null], ThreadRow>(`SELECT * FROM threads WHERE project_id IS ? ORDER BY created_at DESC`)
    .all(projectId)
    .map(toThread);
}

export function getThreadDb(id: string): Thread | null {
  const r = getDb().prepare<[string], ThreadRow>(`SELECT * FROM threads WHERE id = ?`).get(id);
  return r ? toThread(r) : null;
}

export function insertThread(t: Thread): void {
  getDb()
    .prepare(`INSERT INTO threads (id, name, project_id, created_at) VALUES (?, ?, ?, ?)`)
    .run(t.id, t.name, t.projectId, t.createdAt);
}

/** 스레드 + 그 안의 run·이벤트까지 삭제(대화 전체 정리). */
export function deleteThreadDb(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM run_events WHERE run_id IN (SELECT id FROM runs WHERE thread_id = ?)`).run(id);
  db.prepare(`DELETE FROM runs WHERE thread_id = ?`).run(id);
  db.prepare(`DELETE FROM threads WHERE id = ?`).run(id);
}

// ── projects ──────────────────────────────────────────────────────────────────
interface ProjectRow { id: string; name: string; path: string; created_at: string }
const toProject = (r: ProjectRow): Project => ({ id: r.id, name: r.name, path: r.path, createdAt: r.created_at });

export function listProjectsDb(): Project[] {
  return getDb().prepare<[], ProjectRow>(`SELECT * FROM projects ORDER BY created_at ASC`).all().map(toProject);
}

export function getProjectDb(id: string): Project | null {
  const r = getDb().prepare<[string], ProjectRow>(`SELECT * FROM projects WHERE id = ?`).get(id);
  return r ? toProject(r) : null;
}

export function insertProject(p: Project): void {
  getDb()
    .prepare(`INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)`)
    .run(p.id, p.name, p.path, p.createdAt);
}

export function deleteProjectDb(id: string): void {
  // run.project_id 는 정리하지 않음 — 기록은 남기되 프로젝트만 등록 해제.
  getDb().prepare(`DELETE FROM projects WHERE id = ?`).run(id);
}

export function projectPathExists(path: string): boolean {
  return !!getDb().prepare<[string], { n: number }>(`SELECT 1 n FROM projects WHERE path = ?`).get(path);
}
