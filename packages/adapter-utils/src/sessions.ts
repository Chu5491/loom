// 세션 정리 helper — loom 이 만든 세션을 사용자가 지울 때, 세션 id 가 파일명/경로에
// 박힌 CLI(codex rollout, opencode storage, factory)에서 그 흔적을 찾아낸다.
// 디스크 *읽기*만 한다(경로 산출) — 실제 삭제는 서버가 수행.

import fs from "node:fs";
import path from "node:path";

const MAX_ENTRIES = 50_000; // 병적으로 큰 트리 방어

/**
 * `root` 아래에서 이름에 `sessionId` 가 든 파일·디렉토리 경로를 재귀로 수집.
 * 세션 id 가 충분히 고유(UUID·`ses_…`)하다는 전제 — 부분일치(`includes`)로 잡는다.
 * 디렉토리가 매치되면 통째로 반환하고 그 안으론 더 내려가지 않는다(중복 방지).
 */
export function findSessionPaths(root: string, sessionId: string): string[] {
  if (!sessionId || !fs.existsSync(root)) return [];
  const found: string[] = [];
  let seen = 0;
  const walk = (dir: string): void => {
    if (seen >= MAX_ENTRIES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 권한 없음/사라짐 — 건너뜀
    }
    for (const ent of entries) {
      if (seen >= MAX_ENTRIES) return;
      seen++;
      const full = path.join(dir, ent.name);
      if (ent.name.includes(sessionId)) {
        found.push(full); // 디렉토리면 통째 — 안 내려간다
      } else if (ent.isDirectory()) {
        walk(full);
      }
    }
  };
  walk(root);
  return found;
}
