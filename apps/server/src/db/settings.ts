// 워크스페이스 단일 행 설정. 단일 행 패턴은 gemini_sync 와 같은 모양 —
// CHECK (id = 1) 로 row 가 한 줄로 강제됨. 새 설정은 컬럼을 추가해 여기에 모음.

import type { ApiKeyStatus, LoomSettings } from "@loom/core";
import { decryptSecret, encryptSecret, isEncrypted, tryDecryptSecret } from "../crypto.js";
import { getDb } from "./client.js";

export type { ApiKeyStatus, LoomSettings };

interface Row {
  global_rule: string;
  smithery_api_key: string | null;
  skills_sh_api_key: string | null;
  webhook_secret: string | null;
  updated_at: string;
}

function readRow(): Row | undefined {
  return getDb()
    .prepare<[], Row>(
      `SELECT global_rule, smithery_api_key, skills_sh_api_key, webhook_secret, updated_at
         FROM loom_settings WHERE id = 1`,
    )
    .get();
}

export function getSettings(): LoomSettings {
  const row = readRow();
  // 마이그레이션이 INSERT OR IGNORE 로 시드를 박아 두므로 row 가 없을 일은
  // 정상적으로 없음 — 그래도 방어적으로 빈 값.
  if (!row) return { globalRule: "", updatedAt: new Date().toISOString() };
  return { globalRule: row.global_rule, updatedAt: row.updated_at };
}

export function getGlobalRule(): string {
  return getSettings().globalRule;
}

export function setGlobalRule(content: string): LoomSettings {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE loom_settings SET global_rule = ?, updated_at = ? WHERE id = 1`,
    )
    .run(content, now);
  return { globalRule: content, updatedAt: now };
}

// ─── External API keys ────────────────────────────────────────────────────
//
// DB 가 우선, env 가 fallback. 둘 다 비면 source 비활성.
// 정책:
//   - getter 는 raw 값 반환 (서비스에서 Authorization header 로 보냄)
//   - 외부 API 응답은 클라에 절대 노출 안 함 (configured boolean 만)
//   - DB row 는 user 가 명시적으로 set 한 값만. 빈 문자열 = clear (NULL).

function decryptDbKey(
  dbValue: string | null,
  column: "smithery_api_key" | "skills_sh_api_key",
): string | null {
  const v = dbValue?.trim();
  if (!v) return null;
  if (isEncrypted(v)) {
    // Corrupt/key-rotated value → treat as unset rather than crashing.
    return tryDecryptSecret(v);
  }
  // Auto-encrypt plaintext found in DB (legacy migration).
  const encrypted = encryptSecret(v);
  getDb()
    .prepare(`UPDATE loom_settings SET ${column} = ? WHERE id = 1`)
    .run(encrypted);
  return v;
}

function pickKey(
  dbValue: string | null,
  envName: string,
  column: "smithery_api_key" | "skills_sh_api_key",
): string | null {
  const decrypted = decryptDbKey(dbValue, column);
  if (decrypted) return decrypted;
  const e = process.env[envName]?.trim();
  return e || null;
}

export function getSmitheryApiKey(): string | null {
  return pickKey(readRow()?.smithery_api_key ?? null, "LOOM_SMITHERY_API_KEY", "smithery_api_key");
}

export function getSkillsShApiKey(): string | null {
  return pickKey(readRow()?.skills_sh_api_key ?? null, "LOOM_SKILLS_SH_API_KEY", "skills_sh_api_key");
}

// ApiKeyStatus 는 @loom/core 에서 import. 위에서 re-export 됨.

function statusFor(dbValue: string | null, envName: string): ApiKeyStatus {
  if (dbValue?.trim()) return { configured: true, source: "db" };
  if (process.env[envName]?.trim()) return { configured: true, source: "env" };
  return { configured: false, source: "none" };
}

export function getApiKeyStatuses(): {
  smithery: ApiKeyStatus;
  skillsSh: ApiKeyStatus;
} {
  const row = readRow();
  return {
    smithery: statusFor(
      row?.smithery_api_key ?? null,
      "LOOM_SMITHERY_API_KEY",
    ),
    skillsSh: statusFor(
      row?.skills_sh_api_key ?? null,
      "LOOM_SKILLS_SH_API_KEY",
    ),
  };
}

/** 빈 문자열 / undefined → NULL (clear). 그 외 값은 trim 해서 저장. */
function normalizeKeyInput(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function setSmitheryApiKey(key: string | null): void {
  const v = normalizeKeyInput(key);
  const stored = v ? encryptSecret(v) : null;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE loom_settings SET smithery_api_key = ?, updated_at = ? WHERE id = 1`,
    )
    .run(stored, now);
}

export function setSkillsShApiKey(key: string | null): void {
  const v = normalizeKeyInput(key);
  const stored = v ? encryptSecret(v) : null;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE loom_settings SET skills_sh_api_key = ?, updated_at = ? WHERE id = 1`,
    )
    .run(stored, now);
}

// ─── Webhook Secret ──────────────────────────────────────────────────────
//
// CI/CD webhook 인증용 Bearer token. 최초 조회 시 자동 생성.
// 재생성(rotate)은 setWebhookSecret(null) → 다음 get에서 신규 발행.

import { randomBytes } from "node:crypto";

export function getWebhookSecret(): string {
  const row = readRow();
  if (row?.webhook_secret) return row.webhook_secret;
  const secret = `loom_wh_${randomBytes(24).toString("hex")}`;
  getDb()
    .prepare(
      `UPDATE loom_settings SET webhook_secret = ?, updated_at = ? WHERE id = 1`,
    )
    .run(secret, new Date().toISOString());
  return secret;
}

export function rotateWebhookSecret(): string {
  getDb()
    .prepare(
      `UPDATE loom_settings SET webhook_secret = NULL, updated_at = ? WHERE id = 1`,
    )
    .run(new Date().toISOString());
  return getWebhookSecret();
}
