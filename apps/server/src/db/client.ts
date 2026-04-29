import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { paths, config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, "schema.sql");

export type DB = Database.Database;

let _db: DB | null = null;

export function getDb(): DB {
  if (_db) return _db;
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(paths.logs, { recursive: true });
  fs.mkdirSync(paths.worktrees, { recursive: true });

  const db = new Database(paths.db);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
  db.exec(schema);
  applyMigrations(db);

  _db = db;
  return db;
}

function columnExists(db: DB, table: string, column: string): boolean {
  const rows = db
    .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
    .all();
  return rows.some((r) => r.name === column);
}

function applyMigrations(db: DB): void {
  // 0001: add runs.attached_spec_ids (v0.6).
  if (!columnExists(db, "runs", "attached_spec_ids")) {
    db.exec(
      `ALTER TABLE runs ADD COLUMN attached_spec_ids TEXT NOT NULL DEFAULT '[]'`,
    );
  }

  // 0002a: add projects + agents.project_id column (v0.8).
  if (!columnExists(db, "agents", "project_id")) {
    db.exec(
      `ALTER TABLE agents ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE`,
    );
  }

  // 0002b: any agent rows with NULL project_id (from a previous failed
  // migration or pre-existing data) get gathered under an auto-created
  // "Default" project. Idempotent — a no-op once nothing is null.
  const orphan = db
    .prepare<[], { count: number }>(
      "SELECT COUNT(*) as count FROM agents WHERE project_id IS NULL",
    )
    .get();
  if (orphan && orphan.count > 0) {
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO projects (id, name, path, description, created_at, updated_at)
       VALUES (?, 'Default', ?, 'Auto-created during the project migration', ?, ?)`,
    ).run(id, os.homedir(), now, now);
    db.prepare(`UPDATE agents SET project_id = ? WHERE project_id IS NULL`).run(id);
  }

  // Always ensure index exists — handles both fresh installs and upgrades.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agents_project ON agents(project_id)`);

  // 0003: agents.prompt (v0.9). Empty default keeps existing behavior.
  if (!columnExists(db, "agents", "prompt")) {
    db.exec(`ALTER TABLE agents ADD COLUMN prompt TEXT NOT NULL DEFAULT ''`);
  }

  // 0004: agent_skills join table (v0.9).
  db.exec(
    `CREATE TABLE IF NOT EXISTS agent_skills (
       agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
       skill_id    TEXT NOT NULL REFERENCES specs(id) ON DELETE CASCADE,
       created_at  TEXT NOT NULL,
       PRIMARY KEY (agent_id, skill_id)
     )`,
  );

  // 0005: runs.before_ref / after_ref (v0.10) — working-tree snapshot
  // commit SHAs used to render per-run file diffs. NULLable; runs that
  // failed to snapshot or ran in non-git cwds simply skip diff tracking.
  if (!columnExists(db, "runs", "before_ref")) {
    db.exec(`ALTER TABLE runs ADD COLUMN before_ref TEXT`);
  }
  if (!columnExists(db, "runs", "after_ref")) {
    db.exec(`ALTER TABLE runs ADD COLUMN after_ref TEXT`);
  }

  // 0006: run_changes — per-run per-file diff stats persisted at finish
  // time so file-history queries don't need live git access and survive
  // git gc reaping the dangling snapshot commits.
  db.exec(
    `CREATE TABLE IF NOT EXISTS run_changes (
       run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
       path        TEXT NOT NULL,
       from_path   TEXT,
       status      TEXT NOT NULL,
       additions   INTEGER NOT NULL DEFAULT 0,
       deletions   INTEGER NOT NULL DEFAULT 0,
       PRIMARY KEY (run_id, path)
     )`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_run_changes_path ON run_changes(path)`,
  );

  // 0007: threads as first-class containers. Migration has three pieces:
  //
  //   a) the threads table itself
  //   b) runs.thread_id FK
  //   c) backfill — every existing run gets attached to a thread, with
  //      runs that share a parent_run_id chain rolled into the same
  //      thread (preserves the implicit grouping the chat already used)
  //
  // The backfill walks parent chains in JS rather than SQL — recursive
  // CTEs work but are awkward for "find the chain root and group", and
  // the data volume here is small enough that a JS pass is the simpler
  // bet.
  db.exec(
    `CREATE TABLE IF NOT EXISTS threads (
       id              TEXT PRIMARY KEY,
       project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
       name            TEXT NOT NULL,
       status          TEXT NOT NULL DEFAULT 'active',
       context_bundle  TEXT NOT NULL DEFAULT '',
       created_at      TEXT NOT NULL,
       updated_at      TEXT NOT NULL
     )`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_threads_project ON threads(project_id)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_threads_status ON threads(status)`,
  );
  if (!columnExists(db, "runs", "thread_id")) {
    db.exec(
      `ALTER TABLE runs ADD COLUMN thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL`,
    );
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_runs_thread ON runs(thread_id)`);
  backfillThreadsForOrphanedRuns(db);

  // 0008: runs.cost_usd — populated from the CLI's result event when the
  // adapter surfaces it (claude-code's stream-json carries
  // total_cost_usd). Stays NULL for adapters that don't report cost,
  // and we never fabricate estimates client-side from token counts.
  if (!columnExists(db, "runs", "cost_usd")) {
    db.exec(`ALTER TABLE runs ADD COLUMN cost_usd REAL`);
  }

  // 0009: threads.worktree_path — optional isolated git worktree per
  // thread. Lets users branch off the project's main checkout for
  // parallel-safe experimentation (multiple threads working on
  // conflicting files at the same time without stepping on each
  // other). NULL = "share the project's path," which is the default.
  if (!columnExists(db, "threads", "worktree_path")) {
    db.exec(`ALTER TABLE threads ADD COLUMN worktree_path TEXT`);
  }
}

interface OrphanRunRow {
  id: string;
  parent_run_id: string | null;
  agent_id: string;
  prompt: string;
  created_at: string;
}

/**
 * Group every thread-less run into one thread per parent_run_id chain.
 * Each chain becomes a single Thread named after the root run's prompt.
 * Runs whose agent no longer exists are skipped — their project is
 * unrecoverable, and we'd rather drop a dangling row than fabricate a
 * placeholder project.
 */
function backfillThreadsForOrphanedRuns(db: DB): void {
  const orphans = db
    .prepare<[], OrphanRunRow>(
      `SELECT id, parent_run_id, agent_id, prompt, created_at
       FROM runs
       WHERE thread_id IS NULL
       ORDER BY created_at ASC`,
    )
    .all();
  if (orphans.length === 0) return;

  const byId = new Map<string, OrphanRunRow>(orphans.map((r) => [r.id, r]));

  // Walk every run's parent chain to a root. Cap the walk to defend
  // against accidental cycles in legacy data.
  const rootOf = new Map<string, string>();
  for (const r of orphans) {
    let cur: OrphanRunRow = r;
    let depth = 0;
    while (cur.parent_run_id && byId.has(cur.parent_run_id) && depth < 50) {
      cur = byId.get(cur.parent_run_id)!;
      depth++;
    }
    rootOf.set(r.id, cur.id);
  }

  const projectStmt = db.prepare<
    [string],
    { project_id: string }
  >("SELECT project_id FROM agents WHERE id = ?");
  const insertThread = db.prepare(
    `INSERT INTO threads (id, project_id, name, status, context_bundle, created_at, updated_at)
     VALUES (?, ?, ?, 'active', '', ?, ?)`,
  );
  const updateRun = db.prepare(
    `UPDATE runs SET thread_id = ? WHERE id = ?`,
  );

  const threadByRoot = new Map<string, string>();
  for (const rootId of new Set(rootOf.values())) {
    const root = byId.get(rootId)!;
    const project = projectStmt.get(root.agent_id);
    if (!project?.project_id) continue;
    const threadId = randomUUID();
    const name = threadNameFromPrompt(root.prompt);
    insertThread.run(
      threadId,
      project.project_id,
      name,
      root.created_at,
      root.created_at,
    );
    threadByRoot.set(rootId, threadId);
  }

  for (const [runId, rootId] of rootOf) {
    const tid = threadByRoot.get(rootId);
    if (tid) updateRun.run(tid, runId);
  }
}

/** Build a thread name from a run's prompt: collapse whitespace, trim,
 *  cap at 60 chars. Empty / pathological prompts get a "Untitled"
 *  fallback so we never insert NULL. Exported because new-thread
 *  creation in run-service uses the exact same convention. */
export function threadNameFromPrompt(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Untitled";
  return cleaned.length > 60 ? cleaned.slice(0, 60) + "…" : cleaned;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
