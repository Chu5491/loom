// 프로젝트 단위 환경변수 — 모든 에이전트 run에 공통 주입되는 KV 페어.
// 보통 API 키, BASE_URL 같은 공유 secret. 에이전트별 env가 우선순위가 높음.

import { encryptSecret, isEncrypted, tryDecryptSecret } from "../crypto.js";
import { getDb } from "./client.js";

interface Row {
  key: string;
  value: string;
}

export function listProjectEnv(projectId: string): Record<string, string> {
  const db = getDb();
  const rows = db
    .prepare<[string], Row>(
      `SELECT key, value FROM project_env WHERE project_id = ? ORDER BY key`,
    )
    .all(projectId);
  const out: Record<string, string> = {};
  const update = db.prepare(
    `UPDATE project_env SET value = ? WHERE project_id = ? AND key = ?`,
  );
  const migrate = db.transaction(() => {
    for (const r of rows) {
      if (isEncrypted(r.value)) {
        const plain = tryDecryptSecret(r.value);
        if (plain !== null) out[r.key] = plain;
      } else {
        out[r.key] = r.value;
        update.run(encryptSecret(r.value), projectId, r.key);
      }
    }
  });
  migrate();
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
      if (!key.trim()) continue;
      insert.run(projectId, key, encryptSecret(value));
    }
  });
  tx();
}
