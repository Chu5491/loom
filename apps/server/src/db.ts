// 런 기록(history) 영속 — data/loom.db. 정의(office/)가 아니라 "기록"이므로
// gitignore 되고, sqlite 는 여기에만 돌아온다(헌법: 정의는 git, 기록은 로컬).
// 슬림하게 두 테이블뿐: runs + run_events(OfficeEvent JSON 순서대로).

import Database from "better-sqlite3";
import fs from "node:fs";
import type { OfficeEvent, Project, RunInfo, Schedule, Thread } from "@loom/core";
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
    CREATE TABLE IF NOT EXISTS schedules (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      agent       TEXT NOT NULL,
      prompt      TEXT NOT NULL,
      cron        TEXT NOT NULL,
      workflow    TEXT,
      feature     TEXT,
      project_id  TEXT,
      enabled     INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gates (
      id          TEXT PRIMARY KEY,
      workflow    TEXT NOT NULL,
      node_id     TEXT NOT NULL,
      prev_run_id TEXT,
      project_id  TEXT,
      thread_id   TEXT,
      result      TEXT NOT NULL,
      chain_id    TEXT NOT NULL,
      input       TEXT NOT NULL,
      steps       INTEGER NOT NULL,
      created_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS join_arrivals (
      chain_id    TEXT NOT NULL,
      node_id     TEXT NOT NULL,
      seq         INTEGER NOT NULL,
      result      TEXT NOT NULL,
      last_run_id TEXT,
      PRIMARY KEY (chain_id, node_id, seq)
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
  if (!cols.some((c) => c.name === "workflow")) {
    db.exec(`ALTER TABLE runs ADD COLUMN workflow TEXT`);
    db.exec(`ALTER TABLE runs ADD COLUMN node TEXT`);
  }
  const schedCols = db.prepare<[], { name: string }>(`PRAGMA table_info(schedules)`).all();
  if (schedCols.length > 0 && !schedCols.some((c) => c.name === "workflow")) {
    db.exec(`ALTER TABLE schedules ADD COLUMN workflow TEXT`);
  }
  if (schedCols.length > 0 && !schedCols.some((c) => c.name === "feature")) {
    db.exec(`ALTER TABLE schedules ADD COLUMN feature TEXT`);
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
  workflow: string | null;
  node: string | null;
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
    workflow: r.workflow,
    node: r.node,
  };
}

export function insertRun(info: RunInfo): void {
  getDb()
    .prepare(
      `INSERT INTO runs (id, agent, prompt, status, started_at, ended_at, exit_code, parent_run_id, project_id, thread_id, workflow, node)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(info.id, info.agent, info.prompt, info.status, info.startedAt, info.endedAt, info.exitCode, info.parentRunId, info.projectId, info.threadId, info.workflow ?? null, info.node ?? null);
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

/** 서버 부팅 시 — 프로세스가 죽어 영원히 "running" 으로 남은 고아 run 정리.
 *  spawn 된 CLI 는 서버와 함께 죽으므로 실패로 마감하는 것이 사실에 부합. */
export function failOrphanRuns(): number {
  const r = getDb()
    .prepare(`UPDATE runs SET status = 'failed', ended_at = ? WHERE status = 'running'`)
    .run(new Date().toISOString());
  return r.changes;
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

/** 에이전트 파일 활동 — 이 프로젝트에서 file 이벤트를 남긴 run 들의 요약(최신순). */
export interface AgentFileActivity {
  runId: string;
  agent: string;
  startedAt: string;
  files: { path: string; action: "edit" | "write" }[];
}
export function listAgentFileActivity(projectId: string): AgentFileActivity[] {
  const rows = getDb()
    .prepare<[string], { id: string; agent: string; started_at: string; event: string }>(
      `SELECT r.id, r.agent, r.started_at, e.event
       FROM runs r JOIN run_events e ON e.run_id = r.id
       WHERE r.project_id = ? AND e.event LIKE '%"kind":"file"%'
       ORDER BY r.started_at DESC, e.seq ASC LIMIT 500`,
    )
    .all(projectId);
  const byRun = new Map<string, AgentFileActivity>();
  for (const r of rows) {
    const ev = JSON.parse(r.event) as OfficeEvent;
    if (ev.kind !== "file") continue;
    let entry = byRun.get(r.id);
    if (!entry) {
      entry = { runId: r.id, agent: r.agent, startedAt: r.started_at, files: [] };
      byRun.set(r.id, entry);
    }
    if (!entry.files.some((f) => f.path === ev.path && f.action === ev.action)) {
      entry.files.push({ path: ev.path, action: ev.action });
    }
  }
  return [...byRun.values()];
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

export function renameThreadDb(id: string, name: string): void {
  getDb().prepare(`UPDATE threads SET name = ? WHERE id = ?`).run(name, id);
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
  // 대시보드용 통계 동봉 — 최근 활동 순(활동 없는 프로젝트는 뒤로).
  return getDb()
    .prepare<[], ProjectRow & { thread_count: number; last_run_at: string | null }>(
      `SELECT p.*,
         (SELECT COUNT(*) FROM threads t WHERE t.project_id = p.id) AS thread_count,
         (SELECT MAX(r.started_at) FROM runs r WHERE r.project_id = p.id) AS last_run_at
       FROM projects p
       ORDER BY last_run_at IS NULL, last_run_at DESC, p.created_at DESC`,
    )
    .all()
    .map((r) => ({ ...toProject(r), threadCount: r.thread_count, lastRunAt: r.last_run_at }));
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

// ── schedules — cron 으로 에이전트 run 을 반복 실행 (머신-로컬 기록) ─────────────
interface ScheduleRow {
  id: string;
  name: string;
  agent: string;
  prompt: string;
  cron: string;
  workflow: string | null;
  feature: string | null;
  project_id: string | null;
  enabled: number;
  last_run_at: string | null;
  created_at: string;
}
function toSchedule(r: ScheduleRow): Schedule {
  return {
    id: r.id,
    name: r.name,
    agent: r.agent,
    prompt: r.prompt,
    cron: r.cron,
    workflow: r.workflow,
    feature: r.feature === "standup" ? "standup" : null,
    projectId: r.project_id,
    enabled: !!r.enabled,
    lastRunAt: r.last_run_at,
    createdAt: r.created_at,
  };
}

export function listSchedulesDb(projectId?: string | null): Schedule[] {
  const db = getDb();
  const rows =
    projectId === undefined
      ? db.prepare<[], ScheduleRow>(`SELECT * FROM schedules ORDER BY created_at DESC`).all()
      : db.prepare<[string | null], ScheduleRow>(`SELECT * FROM schedules WHERE project_id IS ? ORDER BY created_at DESC`).all(projectId);
  return rows.map(toSchedule);
}

export function getScheduleDb(id: string): Schedule | null {
  const r = getDb().prepare<[string], ScheduleRow>(`SELECT * FROM schedules WHERE id = ?`).get(id);
  return r ? toSchedule(r) : null;
}

export function insertSchedule(s: Schedule): void {
  getDb()
    .prepare(
      `INSERT INTO schedules (id, name, agent, prompt, cron, workflow, feature, project_id, enabled, last_run_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(s.id, s.name, s.agent, s.prompt, s.cron, s.workflow ?? null, s.feature ?? null, s.projectId, s.enabled ? 1 : 0, s.lastRunAt, s.createdAt);
}

export function updateScheduleDb(s: Schedule): void {
  getDb()
    .prepare(
      `UPDATE schedules SET name = ?, agent = ?, prompt = ?, cron = ?, workflow = ?, feature = ?, project_id = ?, enabled = ?, last_run_at = ? WHERE id = ?`,
    )
    .run(s.name, s.agent, s.prompt, s.cron, s.workflow ?? null, s.feature ?? null, s.projectId, s.enabled ? 1 : 0, s.lastRunAt, s.id);
}

export function deleteScheduleDb(id: string): boolean {
  return getDb().prepare(`DELETE FROM schedules WHERE id = ?`).run(id).changes > 0;
}

export function touchScheduleLastRun(id: string, at: string): void {
  getDb().prepare(`UPDATE schedules SET last_run_at = ? WHERE id = ?`).run(at, id);
}

/** 이번 달(UTC, 1일 0시 기준) 누적 비용 — 예산 가드용. agent 지정 시 그 에이전트만. */
export function monthCostUsd(agent?: string): number {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const row = agent
    ? getDb()
        .prepare<[string, string], { c: number | null }>(
          `SELECT SUM(COALESCE(cost_usd, 0)) c FROM runs WHERE started_at >= ? AND agent = ?`,
        )
        .get(monthStart, agent)
    : getDb()
        .prepare<[string], { c: number | null }>(
          `SELECT SUM(COALESCE(cost_usd, 0)) c FROM runs WHERE started_at >= ?`,
        )
        .get(monthStart);
  return row?.c ?? 0;
}

// ── 워크플로우 일시정지 상태 — 게이트·join 도착분 (서버 재시작 생존용) ────────────
// exec 컨텍스트(워크플로우 spec·counter)는 복원 시 office 에서 재구성하므로,
// 여기엔 재구성에 필요한 원시 값만 둔다.
export interface GateRow {
  id: string;
  workflow: string;
  nodeId: string;
  prevRunId: string | null;
  projectId: string | null;
  threadId: string | null;
  result: string;
  chainId: string;
  input: string;
  steps: number;
  createdAt: string;
}

export function insertGateDb(g: GateRow): void {
  getDb()
    .prepare(
      `INSERT INTO gates (id, workflow, node_id, prev_run_id, project_id, thread_id, result, chain_id, input, steps, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(g.id, g.workflow, g.nodeId, g.prevRunId, g.projectId, g.threadId, g.result, g.chainId, g.input, g.steps, g.createdAt);
}

export function deleteGateDb(id: string): void {
  getDb().prepare(`DELETE FROM gates WHERE id = ?`).run(id);
}

export function listGatesDb(): GateRow[] {
  interface Row {
    id: string; workflow: string; node_id: string; prev_run_id: string | null;
    project_id: string | null; thread_id: string | null; result: string;
    chain_id: string; input: string; steps: number; created_at: string;
  }
  return getDb()
    .prepare<[], Row>(`SELECT * FROM gates ORDER BY created_at ASC`)
    .all()
    .map((r) => ({
      id: r.id, workflow: r.workflow, nodeId: r.node_id, prevRunId: r.prev_run_id,
      projectId: r.project_id, threadId: r.thread_id, result: r.result,
      chainId: r.chain_id, input: r.input, steps: r.steps, createdAt: r.created_at,
    }));
}

export function insertJoinArrivalDb(chainId: string, nodeId: string, seq: number, result: string, lastRunId: string | null): void {
  getDb()
    .prepare(`INSERT OR REPLACE INTO join_arrivals (chain_id, node_id, seq, result, last_run_id) VALUES (?, ?, ?, ?, ?)`)
    .run(chainId, nodeId, seq, result, lastRunId);
}

export function deleteJoinArrivalsDb(chainId: string, nodeId: string): void {
  getDb().prepare(`DELETE FROM join_arrivals WHERE chain_id = ? AND node_id = ?`).run(chainId, nodeId);
}

export function listJoinArrivalsDb(): { chainId: string; nodeId: string; results: string[]; lastRunId: string | null }[] {
  interface Row { chain_id: string; node_id: string; seq: number; result: string; last_run_id: string | null }
  const rows = getDb()
    .prepare<[], Row>(`SELECT * FROM join_arrivals ORDER BY chain_id, node_id, seq ASC`)
    .all();
  const grouped = new Map<string, { chainId: string; nodeId: string; results: string[]; lastRunId: string | null }>();
  for (const r of rows) {
    const key = `${r.chain_id}:${r.node_id}`;
    const g = grouped.get(key) ?? { chainId: r.chain_id, nodeId: r.node_id, results: [], lastRunId: null };
    g.results.push(r.result);
    g.lastRunId = r.last_run_id ?? g.lastRunId;
    grouped.set(key, g);
  }
  return [...grouped.values()];
}
