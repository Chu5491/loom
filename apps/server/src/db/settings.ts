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
  updated_at: string;
}

export function getSettings(): LoomSettings {
  const row = getDb()
    .prepare<[], Row>(
      `SELECT global_rule, updated_at FROM loom_settings WHERE id = 1`,
    )
    .get();
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
