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
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
