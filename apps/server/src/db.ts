// 런 기록(history) 영속 — data/loom.db. 정의(office/)가 아니라 "기록"이므로
// gitignore 되고, sqlite 는 여기에만 돌아온다(헌법: 정의는 git, 기록은 로컬).
// 슬림하게 두 테이블뿐: runs + run_events(OfficeEvent JSON 순서대로).

import Database from "better-sqlite3";
import fs from "node:fs";
import type { OfficeEvent, RunInfo } from "@loom/core";
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
  `);
  // P3 에서 만든 db 는 parent_run_id 가 없음 — 자가치유(기록은 disposable이지만 안전하게).
  const cols = db.prepare<[], { name: string }>(`PRAGMA table_info(runs)`).all();
  if (!cols.some((c) => c.name === "parent_run_id")) {
    db.exec(`ALTER TABLE runs ADD COLUMN parent_run_id TEXT`);
  }
  _db = db;
  return db;
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
  };
}

export function insertRun(info: RunInfo): void {
  getDb()
    .prepare(
      `INSERT INTO runs (id, agent, prompt, status, started_at, ended_at, exit_code, parent_run_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(info.id, info.agent, info.prompt, info.status, info.startedAt, info.endedAt, info.exitCode, info.parentRunId);
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

export function listRunsDb(): RunInfo[] {
  return getDb()
    .prepare<[], RunRow>(`SELECT * FROM runs ORDER BY started_at DESC`)
    .all()
    .map(toInfo);
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
