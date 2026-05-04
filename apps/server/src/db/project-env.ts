// 프로젝트 단위 환경변수 — 모든 에이전트 run에 공통 주입되는 KV 페어.
// 보통 API 키, BASE_URL 같은 공유 secret. 에이전트별 env가 우선순위가 높음.

import { getDb } from "./client.js";

interface Row {
  key: string;
  value: string;
}

export function listProjectEnv(projectId: string): Record<string, string> {
  const rows = getDb()
    .prepare<[string], Row>(
      `SELECT key, value FROM project_env WHERE project_id = ? ORDER BY key`,
    )
    .all(projectId);
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/** 한 프로젝트의 env를 통째로 교체. 빈 dict이면 모두 삭제. */
export function replaceProjectEnv(
  projectId: string,
  env: Record<string, string>,
): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM project_env WHERE project_id = ?`).run(projectId);
    const insert = db.prepare(
      `INSERT INTO project_env (project_id, key, value) VALUES (?, ?, ?)`,
    );
    for (const [key, value] of Object.entries(env)) {
      // 빈 문자열 key는 무시 — UI에서 새 row 추가 시 흔히 발생.
      if (!key.trim()) continue;
      insert.run(projectId, key, value);
    }
  });
  tx();
}
