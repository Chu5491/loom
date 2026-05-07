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
  fs.mkdirSync(paths.agents, { recursive: true });

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

// schema_migrations 테이블이 적용된 마이그레이션 버전을 기록.
// 컬럼-존재 가드는 belt-and-suspenders로 유지 — 기존 DB는 가드가 no-op으로 통과시키고
// 새 DB는 실제로 ALTER 실행. 어느 쪽이든 끝나면 schema_migrations에 기록.
function ensureMigrationsTable(db: DB): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version    INTEGER PRIMARY KEY,
       name       TEXT NOT NULL,
       applied_at TEXT NOT NULL
     )`,
  );
}

function hasMigration(db: DB, version: number): boolean {
  const row = db
    .prepare<[number], { version: number }>(
      `SELECT version FROM schema_migrations WHERE version = ?`,
    )
    .get(version);
  return !!row;
}

function recordMigration(db: DB, version: number, name: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`,
  ).run(version, name, new Date().toISOString());
}

function migration(db: DB, version: number, name: string, fn: () => void): void {
  if (hasMigration(db, version)) return;
  fn();
  recordMigration(db, version, name);
}

function applyMigrations(db: DB): void {
  ensureMigrationsTable(db);

  migration(db, 1, "runs.attached_spec_ids", () => {
    if (!columnExists(db, "runs", "attached_spec_ids")) {
      db.exec(
        `ALTER TABLE runs ADD COLUMN attached_spec_ids TEXT NOT NULL DEFAULT '[]'`,
      );
    }
  });

  migration(db, 2, "projects + agents.project_id", () => {
    if (!columnExists(db, "agents", "project_id")) {
      db.exec(
        `ALTER TABLE agents ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE`,
      );
    }
    // NULL project_id 백필 — 이전 실패 마이그레이션 / 사전 데이터를 "Default" 프로젝트에 묶음.
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
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_agents_project ON agents(project_id)`,
    );
  });

  migration(db, 3, "agents.prompt", () => {
    if (!columnExists(db, "agents", "prompt")) {
      db.exec(`ALTER TABLE agents ADD COLUMN prompt TEXT NOT NULL DEFAULT ''`);
    }
  });

  migration(db, 4, "agent_skills join table", () => {
    db.exec(
      `CREATE TABLE IF NOT EXISTS agent_skills (
         agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
         skill_id    TEXT NOT NULL REFERENCES specs(id) ON DELETE CASCADE,
         created_at  TEXT NOT NULL,
         PRIMARY KEY (agent_id, skill_id)
       )`,
    );
  });

  migration(db, 5, "runs.before_ref + after_ref", () => {
    if (!columnExists(db, "runs", "before_ref")) {
      db.exec(`ALTER TABLE runs ADD COLUMN before_ref TEXT`);
    }
    if (!columnExists(db, "runs", "after_ref")) {
      db.exec(`ALTER TABLE runs ADD COLUMN after_ref TEXT`);
    }
  });

  migration(db, 6, "run_changes table", () => {
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
  });

  migration(db, 7, "threads + runs.thread_id", () => {
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
    db.exec(`CREATE INDEX IF NOT EXISTS idx_threads_status ON threads(status)`);
    if (!columnExists(db, "runs", "thread_id")) {
      db.exec(
        `ALTER TABLE runs ADD COLUMN thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL`,
      );
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_runs_thread ON runs(thread_id)`);
    backfillThreadsForOrphanedRuns(db);
  });

  migration(db, 8, "runs.cost_usd", () => {
    if (!columnExists(db, "runs", "cost_usd")) {
      db.exec(`ALTER TABLE runs ADD COLUMN cost_usd REAL`);
    }
  });

  migration(db, 9, "threads.worktree_path", () => {
    if (!columnExists(db, "threads", "worktree_path")) {
      db.exec(`ALTER TABLE threads ADD COLUMN worktree_path TEXT`);
    }
  });

  migration(db, 10, "runs.session_id", () => {
    if (!columnExists(db, "runs", "session_id")) {
      db.exec(`ALTER TABLE runs ADD COLUMN session_id TEXT`);
    }
  });

  migration(db, 11, "runs.resumed_session_id", () => {
    if (!columnExists(db, "runs", "resumed_session_id")) {
      db.exec(`ALTER TABLE runs ADD COLUMN resumed_session_id TEXT`);
    }
  });

  migration(db, 12, "project_env table", () => {
    db.exec(
      `CREATE TABLE IF NOT EXISTS project_env (
         project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
         key         TEXT NOT NULL,
         value       TEXT NOT NULL,
         PRIMARY KEY (project_id, key)
       )`,
    );
  });

  migration(db, 13, "projects.preferred_editor", () => {
    if (!columnExists(db, "projects", "preferred_editor")) {
      // 외부 IDE 핸들러. NULL이면 클라이언트가 기본값(vscode) 사용.
      db.exec(`ALTER TABLE projects ADD COLUMN preferred_editor TEXT`);
    }
  });

  migration(db, 14, "mcp_servers + agent_mcp_servers", () => {
    db.exec(
      `CREATE TABLE IF NOT EXISTS mcp_servers (
         id          TEXT PRIMARY KEY,
         name        TEXT NOT NULL UNIQUE,
         description TEXT,
         kind        TEXT NOT NULL DEFAULT 'stdio',
         command     TEXT,
         args        TEXT NOT NULL DEFAULT '[]',
         env         TEXT NOT NULL DEFAULT '{}',
         url         TEXT,
         headers     TEXT NOT NULL DEFAULT '{}',
         created_at  TEXT NOT NULL,
         updated_at  TEXT NOT NULL
       )`,
    );
    db.exec(
      `CREATE TABLE IF NOT EXISTS agent_mcp_servers (
         agent_id      TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
         mcp_server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
         created_at    TEXT NOT NULL,
         PRIMARY KEY (agent_id, mcp_server_id)
       )`,
    );
  });

  migration(db, 15, "gemini_sync + mcp_servers.gemini_synced_at", () => {
    db.exec(
      `CREATE TABLE IF NOT EXISTS gemini_sync (
         id              INTEGER PRIMARY KEY CHECK (id = 1),
         enabled         INTEGER NOT NULL DEFAULT 1,
         last_synced_at  TEXT,
         last_error      TEXT
       )`,
    );
    db.exec(`INSERT OR IGNORE INTO gemini_sync (id, enabled) VALUES (1, 1)`);
    if (!columnExists(db, "mcp_servers", "gemini_synced_at")) {
      // 이 컬럼이 NOT NULL이면 "loom이 settings.json에 이 이름으로 쓴 적 있음".
      // 안전 머지에서 "loom-managed"인지 식별 — 사용자가 직접 같은 이름을 추가했다면
      // 이 컬럼은 NULL이고 그 row는 절대 안 건드림.
      db.exec(`ALTER TABLE mcp_servers ADD COLUMN gemini_synced_at TEXT`);
    }
  });

  migration(db, 16, "loom_settings (single row, global rule)", () => {
    // 워크스페이스 단위의 단일 설정 묶음. 지금은 global_rule 하나뿐이지만,
    // 단일 행 KV 테이블로 두면 다음 워크스페이스 settings(예: 기본 모델, default
    // autonomy)도 컬럼만 추가해 같은 자리에 모이게 됨. gemini_sync 와 같은 패턴.
    db.exec(
      `CREATE TABLE IF NOT EXISTS loom_settings (
         id           INTEGER PRIMARY KEY CHECK (id = 1),
         global_rule  TEXT NOT NULL DEFAULT '',
         updated_at   TEXT NOT NULL
       )`,
    );
    db.exec(
      `INSERT OR IGNORE INTO loom_settings (id, global_rule, updated_at)
       VALUES (1, '', datetime('now'))`,
    );
  });

  migration(db, 17, "projects.clone_url", () => {
    if (!columnExists(db, "projects", "clone_url")) {
      // git URL 로 만든 프로젝트면 채워짐. 사용자가 "Local path" 로 만들었으면
      // NULL — 기존 동작과 100% 호환.
      db.exec(`ALTER TABLE projects ADD COLUMN clone_url TEXT`);
    }
  });

  migration(db, 18, "loom_settings external API keys", () => {
    // 마켓플레이스 외부 source 의 API 키를 DB 에 — env 변수 대신 UI 에서 관리.
    // 둘 다 NULL 이면 env (LOOM_SMITHERY_API_KEY / LOOM_SKILLS_SH_API_KEY) 로
    // fallback. 환경변수도 안 두면 그 source 비활성.
    if (!columnExists(db, "loom_settings", "smithery_api_key")) {
      db.exec(`ALTER TABLE loom_settings ADD COLUMN smithery_api_key TEXT`);
    }
    if (!columnExists(db, "loom_settings", "skills_sh_api_key")) {
      db.exec(`ALTER TABLE loom_settings ADD COLUMN skills_sh_api_key TEXT`);
    }
  });
}

interface OrphanRunRow {
  id: string;
  parent_run_id: string | null;
  agent_id: string;
  prompt: string;
  created_at: string;
}

// 매 parent_run_id 체인을 한 thread로 묶음. 체인 루트의 prompt가 thread 이름이 됨.
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

  // 50단계 cap — 레거시 데이터의 우발적 cycle 방어.
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

  const projectStmt = db.prepare<[string], { project_id: string }>(
    "SELECT project_id FROM agents WHERE id = ?",
  );
  const insertThread = db.prepare(
    `INSERT INTO threads (id, project_id, name, status, context_bundle, created_at, updated_at)
     VALUES (?, ?, ?, 'active', '', ?, ?)`,
  );
  const updateRun = db.prepare(`UPDATE runs SET thread_id = ? WHERE id = ?`);

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

// run-service의 새 thread 생성에서도 같은 컨벤션 사용.
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
