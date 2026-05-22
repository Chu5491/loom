// Gemini settings.json 자동 동기화.
//
// 왜 필요한가: gemini CLI는 런타임 --mcp-config 플래그를 지원하지 않고
// XDG 기반도 아니라 ~/.gemini/settings.json을 hard-coded로 읽음. 사용자가
// UI에서만 작업하길 원하면 누군가는 그 파일을 만져야 함. paperclip은 안 했지만
// 우리는 합니다.
//
// 안전 장치:
//   - settings.json의 mcpServers 필드만 만짐. 다른 키는 절대 안 건드림.
//   - DB의 mcp_servers.gemini_synced_at으로 "loom이 쓴 적 있는 이름" 트래킹.
//     사용자가 직접 등록한 같은 이름의 서버는 (이 컬럼이 NULL이라) 안 건드림.
//   - 매 sync 직전에 settings.json.bak.<ISO>로 백업. 최근 5개 보관, 나머지 삭제.
//   - atomic write: temp 파일에 쓴 뒤 rename. 중간에 죽어도 원본 유지.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { GeminiSyncStatus, McpServer } from "@loom/core";
import { getDb } from "../db/client.js";
import { listMcpServers } from "../db/mcp-servers.js";

export type { GeminiSyncStatus } from "@loom/core";

const GEMINI_HOME = path.join(os.homedir(), ".gemini");
const SETTINGS_PATH = path.join(GEMINI_HOME, "settings.json");
const MAX_BACKUPS = 5;

interface GeminiSyncRow {
  enabled: number;
  last_synced_at: string | null;
  last_error: string | null;
}

export function getGeminiSyncRow(): GeminiSyncRow {
  return getDb()
    .prepare<[], GeminiSyncRow>(
      "SELECT enabled, last_synced_at, last_error FROM gemini_sync WHERE id = 1",
    )
    .get()!;
}

export function setGeminiSyncEnabled(enabled: boolean): void {
  getDb()
    .prepare("UPDATE gemini_sync SET enabled = ? WHERE id = 1")
    .run(enabled ? 1 : 0);
}

function setGeminiSyncResult(args: {
  ts: string | null;
  error: string | null;
}): void {
  getDb()
    .prepare(
      "UPDATE gemini_sync SET last_synced_at = ?, last_error = ? WHERE id = 1",
    )
    .run(args.ts, args.error);
}

function listLoomManagedNames(): string[] {
  return getDb()
    .prepare<[], { name: string }>(
      "SELECT name FROM mcp_servers WHERE gemini_synced_at IS NOT NULL",
    )
    .all()
    .map((r) => r.name);
}

function markServerSyncedAt(names: string[], ts: string): void {
  if (names.length === 0) return;
  const stmt = getDb().prepare(
    "UPDATE mcp_servers SET gemini_synced_at = ? WHERE name = ?",
  );
  const tx = getDb().transaction((nms: string[]) => {
    for (const n of nms) stmt.run(ts, n);
  });
  tx(names);
}

function clearServerSyncedAt(names: string[]): void {
  if (names.length === 0) return;
  const stmt = getDb().prepare(
    "UPDATE mcp_servers SET gemini_synced_at = NULL WHERE name = ?",
  );
  const tx = getDb().transaction((nms: string[]) => {
    for (const n of nms) stmt.run(n);
  });
  tx(names);
}

/** McpServer → gemini settings.json의 mcpServers 항목 한 개.
 *
 *  Gemini CLI는 transport를 키로 구분 (type 필드 없음):
 *    stdio: { command, args, env, cwd? }
 *    http : { httpUrl, headers }      ← HTTP는 httpUrl
 *    sse  : { url, headers }          ← SSE는 url (HTTP와 키가 다름!)
 *
 *  Ref: https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md
 */
export function toGeminiMcpEntry(server: McpServer): Record<string, unknown> {
  if (server.kind === "stdio") {
    return {
      ...(server.command ? { command: server.command } : {}),
      ...(server.args.length > 0 ? { args: server.args } : {}),
      ...(Object.keys(server.env).length > 0 ? { env: server.env } : {}),
    };
  }
  // HTTP는 httpUrl, SSE는 url — gemini docs 명시 차이.
  const urlKey = server.kind === "http" ? "httpUrl" : "url";
  return {
    ...(server.url ? { [urlKey]: server.url } : {}),
    ...(Object.keys(server.headers).length > 0
      ? { headers: server.headers }
      : {}),
  };
}

interface MergeResult {
  /** 새 mcpServers 객체 (write할 것). */
  next: Record<string, unknown>;
  /** Loom 카탈로그에서 사라져 settings.json에서도 제거할 이름들. */
  removedFromSettings: string[];
  /** Loom 카탈로그에 있고 settings.json에 새로 들어갈 이름들. */
  addedToSettings: string[];
  /** Catalog에 있는데 settings에 이미 사용자가 같은 이름으로 등록 — 우리는 안 건드림. */
  conflicts: string[];
}

export function mergeGeminiMcpServers(
  currentMcp: Record<string, unknown> | undefined,
  loomCatalog: McpServer[],
  loomManagedNames: ReadonlySet<string>,
): MergeResult {
  const next: Record<string, unknown> = { ...(currentMcp ?? {}) };
  const removedFromSettings: string[] = [];
  const addedToSettings: string[] = [];
  const conflicts: string[] = [];

  const catalogNames = new Set(loomCatalog.map((s) => s.name));

  // 1. Catalog에서 사라진 + loom이 이전에 쓴 이름 → settings에서 제거.
  for (const name of loomManagedNames) {
    if (!catalogNames.has(name) && name in next) {
      delete next[name];
      removedFromSettings.push(name);
    }
  }

  // 2. Catalog의 모든 항목 → settings에 upsert. 단 loom이 안 쓴 이름인데
  //    이미 settings에 존재하면 사용자 것이라 건드리지 않음 (충돌).
  for (const server of loomCatalog) {
    const existsInSettings = server.name in next;
    const wasOurs = loomManagedNames.has(server.name);
    if (existsInSettings && !wasOurs) {
      conflicts.push(server.name);
      continue;
    }
    next[server.name] = toGeminiMcpEntry(server);
    if (!existsInSettings) addedToSettings.push(server.name);
  }

  return { next, removedFromSettings, addedToSettings, conflicts };
}

interface SettingsShape {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

function readSettings(): SettingsShape {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as SettingsShape)
      : {};
  } catch {
    // settings file missing or malformed → fresh start
    return {};
  }
}

function backupSettings(): string | null {
  if (!fs.existsSync(SETTINGS_PATH)) return null;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${SETTINGS_PATH}.loom-bak-${ts}`;
  fs.copyFileSync(SETTINGS_PATH, backupPath);
  pruneOldBackups();
  return backupPath;
}

function pruneOldBackups(): void {
  try {
    const files = fs
      .readdirSync(GEMINI_HOME)
      .filter((f) => f.startsWith("settings.json.loom-bak-"))
      .map((f) => path.join(GEMINI_HOME, f))
      .sort();
    const stale = files.slice(0, Math.max(0, files.length - MAX_BACKUPS));
    for (const f of stale) {
      try {
        fs.unlinkSync(f);
      } catch {
        // 무시 — 다음번에 다시 시도
      }
    }
  } catch {
    // GEMINI_HOME 자체가 없으면 정리할 것도 없음.
  }
}

function atomicWriteSettings(content: string): void {
  fs.mkdirSync(GEMINI_HOME, { recursive: true });
  const tmp = `${SETTINGS_PATH}.loom-tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, "utf8");
  // POSIX: rename은 같은 파일 시스템 내에서 원자적. 중간에 프로세스 죽어도
  // 원본 settings.json은 그대로.
  fs.renameSync(tmp, SETTINGS_PATH);
}

import type { GeminiSyncReport } from "@loom/core";
export type { GeminiSyncReport } from "@loom/core";
/** @deprecated GeminiSyncReport 를 사용하세요. */
export type SyncReport = GeminiSyncReport;

/** 현재 catalog와 settings.json을 안전 머지. enabled가 false면 skipped. */
export function runGeminiSync(args: { force?: boolean } = {}): SyncReport {
  const row = getGeminiSyncRow();
  if (!row.enabled && !args.force) {
    return {
      ok: true,
      skipped: "disabled",
      removedFromSettings: [],
      addedToSettings: [],
      conflicts: [],
      backupPath: null,
    };
  }

  try {
    const before = readSettings();
    const catalog = listMcpServers();
    const managed = new Set(listLoomManagedNames());
    const merged = mergeGeminiMcpServers(before.mcpServers, catalog, managed);

    const next: SettingsShape = { ...before, mcpServers: merged.next };
    // 객체가 비어 있으면 mcpServers 키 자체를 빼서 깔끔히.
    if (Object.keys(merged.next).length === 0) delete next.mcpServers;

    const backupPath = backupSettings();
    atomicWriteSettings(JSON.stringify(next, null, 2) + "\n");

    const ts = new Date().toISOString();
    // catalog 안에 있고 충돌이 아닌 이름들 → loom-managed로 mark.
    const conflictSet = new Set(merged.conflicts);
    const successfullySynced = catalog
      .map((s) => s.name)
      .filter((n) => !conflictSet.has(n));
    markServerSyncedAt(successfullySynced, ts);
    // settings에서 제거된 이름들의 mark도 클리어.
    clearServerSyncedAt(merged.removedFromSettings);

    setGeminiSyncResult({ ts, error: null });

    return {
      ok: true,
      removedFromSettings: merged.removedFromSettings,
      addedToSettings: merged.addedToSettings,
      conflicts: merged.conflicts,
      backupPath,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setGeminiSyncResult({ ts: null, error: msg });
    return {
      ok: false,
      error: msg,
      removedFromSettings: [],
      addedToSettings: [],
      conflicts: [],
      backupPath: null,
    };
  }
}

/** UI에서 토글 + 상태 표시할 때 쓰는 통합 read. 충돌 / 사용자 서버까지 분류. */
export function getGeminiSyncStatus(): GeminiSyncStatus {
  const row = getGeminiSyncRow();
  const settings = readSettings();
  const settingsNames = new Set(Object.keys(settings.mcpServers ?? {}));
  const catalog = listMcpServers();
  const catalogNames = new Set(catalog.map((s) => s.name));
  const managed = new Set(listLoomManagedNames());

  const userManagedNames = [...settingsNames].filter((n) => !managed.has(n));
  const conflicts = catalog
    .filter((s) => settingsNames.has(s.name) && !managed.has(s.name))
    .map((s) => s.name);
  const loomManagedNames = [...managed].filter(
    (n) => catalogNames.has(n) || settingsNames.has(n),
  );

  return {
    enabled: row.enabled === 1,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
    loomManagedNames,
    userManagedNames,
    conflicts,
    settingsPath: SETTINGS_PATH,
  };
}

/** "수동 모드" 폴백: 사용자에게 보여줄 settings.json mcpServers 스니펫. */
export function buildGeminiSnippet(): string {
  const catalog = listMcpServers();
  const mcpServers: Record<string, unknown> = {};
  for (const s of catalog) mcpServers[s.name] = toGeminiMcpEntry(s);
  return JSON.stringify({ mcpServers }, null, 2);
}
