// 프로젝트 디렉토리 파일 검색 — Talk 컴포저의 @file 멘션용.
// 가벼운 substring 매칭(fuzzy 아님). 깊이·개수 cap 으로 거대 레포에서도 안전.

import fs from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "out", ".next", ".cache",
  "coverage", "data", ".devin", ".venv", "venv", "__pycache__", "target",
]);
const MAX_DEPTH = 8;
const MAX_SCAN = 20_000; // 디렉토리 엔트리 방문 상한 — 폭주 방지

/** root 아래 파일 중 상대경로에 q(소문자 substring)가 들어가는 것 — 최대 limit개. */
export function searchFiles(root: string, q: string, limit = 20): string[] {
  const needle = q.toLowerCase();
  const hits: string[] = [];
  let scanned = 0;

  const walk = (dir: string, rel: string, depth: number): void => {
    if (hits.length >= limit || scanned >= MAX_SCAN || depth > MAX_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 권한 등 — 그 디렉토리만 건너뜀
    }
    for (const e of entries) {
      if (hits.length >= limit || ++scanned >= MAX_SCAN) return;
      if (e.name.startsWith(".") && e.isDirectory()) continue;
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), relPath, depth + 1);
      } else if (e.isFile()) {
        if (!needle || relPath.toLowerCase().includes(needle)) hits.push(relPath);
      }
    }
  };

  walk(root, "", 0);
  return hits;
}
