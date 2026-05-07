// 워크스페이스 단일 행 설정. 단일 행 패턴은 gemini_sync 와 같은 모양 —
// CHECK (id = 1) 로 row 가 한 줄로 강제됨. 새 설정은 컬럼을 추가해 여기에 모음.

import { getDb } from "./client.js";

export interface LoomSettings {
  /** 모든 에이전트의 prompt 위에 prepend 되는 워크스페이스 공통 지시.
   *  비어 있으면 (`""`) 프롬프트에 블록 자체가 빠짐. */
  globalRule: string;
  updatedAt: string;
}

interface Row {
  global_rule: string;
  smithery_api_key: string | null;
  skills_sh_api_key: string | null;
  updated_at: string;
}

function readRow(): Row | undefined {
  return getDb()
    .prepare<[], Row>(
      `SELECT global_rule, smithery_api_key, skills_sh_api_key, updated_at
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

function pickKey(dbValue: string | null, envName: string): string | null {
  const v = dbValue?.trim();
  if (v) return v;
  const e = process.env[envName]?.trim();
  return e || null;
}

export function getSmitheryApiKey(): string | null {
  return pickKey(readRow()?.smithery_api_key ?? null, "LOOM_SMITHERY_API_KEY");
}

export function getSkillsShApiKey(): string | null {
  return pickKey(readRow()?.skills_sh_api_key ?? null, "LOOM_SKILLS_SH_API_KEY");
}

export interface ApiKeyStatus {
  /** 키가 있나 없나. 실제 값은 클라에 절대 안 보냄. */
  configured: boolean;
  /** 어디서 왔나 — UI 가 "DB 에서" / "env 에서" 안내. */
  source: "db" | "env" | "none";
}

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
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE loom_settings SET smithery_api_key = ?, updated_at = ? WHERE id = 1`,
    )
    .run(v, now);
}

export function setSkillsShApiKey(key: string | null): void {
  const v = normalizeKeyInput(key);
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE loom_settings SET skills_sh_api_key = ?, updated_at = ? WHERE id = 1`,
    )
    .run(v, now);
}
