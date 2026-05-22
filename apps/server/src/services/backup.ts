// SQLite online backup via better-sqlite3's .backup() API.
// Backups go to <dataDir>/backups/<timestamp>.db, auto-pruned to keep N.

import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { getDb } from "../db/client.js";

const BACKUP_DIR = path.join(config.dataDir, "backups");
const MAX_BACKUPS = 5;

export interface BackupInfo {
  filename: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
}

function ensureBackupDir(): void {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

export async function createBackup(): Promise<BackupInfo> {
  ensureBackupDir();
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `loom-${ts}.db`;
  const dest = path.join(BACKUP_DIR, filename);
  await getDb().backup(dest);
  const stat = fs.statSync(dest);
  pruneOldBackups();
  return {
    filename,
    path: dest,
    sizeBytes: stat.size,
    createdAt: new Date().toISOString(),
  };
}

export function listBackups(): BackupInfo[] {
  ensureBackupDir();
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("loom-") && f.endsWith(".db"))
    .sort()
    .reverse();
  return files.map((filename) => {
    const fullPath = path.join(BACKUP_DIR, filename);
    const stat = fs.statSync(fullPath);
    return {
      filename,
      path: fullPath,
      sizeBytes: stat.size,
      createdAt: stat.mtime.toISOString(),
    };
  });
}

function pruneOldBackups(): void {
  const backups = listBackups();
  for (const old of backups.slice(MAX_BACKUPS)) {
    try {
      fs.unlinkSync(old.path);
    } catch {
      // best-effort cleanup
    }
  }
}

export async function autoBackupOnStartup(): Promise<void> {
  const backups = listBackups();
  if (backups.length === 0) {
    await createBackup();
    return;
  }
  const latest = backups[0]!;
  const age = Date.now() - new Date(latest.createdAt).getTime();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  if (age > ONE_DAY) {
    await createBackup();
  }
}
