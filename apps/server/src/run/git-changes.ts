// 평문 CLI(agy/devin)는 출력에 파일 편집 신호가 없어 stream 으로 변경 파일을
// 못 잡는다. 대신 run 종료 후 git 작업트리에서 "이 run 시간대에 만진 파일"을
// 되찾아 귀속한다 — 어댑터 무관, 전 CLI 폴백.
//
// 한계: git 은 누가 고쳤는지 모른다. 같은 repo 에서 두 run 이 동시에 돌면
// mtime 창이 겹쳐 서로의 변경을 귀속할 수 있다 — loom 의 run 직렬화로 창을 좁힌다.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** `git status --porcelain` 의 (상대경로 → 상태코드) 맵. git repo 가 아니거나
 *  git 이 없으면 null. */
function gitDirty(cwd: string): Map<string, string> | null {
  let out: string;
  try {
    out = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd,
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null; // git 없음 / repo 아님 / 타임아웃
  }
  const map = new Map<string, string>();
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const status = line.slice(0, 2);
    const rest = line.slice(3);
    // rename "old -> new" 는 new 쪽이 현재 경로. 따옴표 감싼 경로는 그대로 둔다
    // (공백 포함 경로 — fs.stat 가 처리).
    const rel = rest.includes(" -> ") ? rest.split(" -> ")[1]! : rest;
    map.set(rel.trim().replace(/^"|"$/g, ""), status);
  }
  return map;
}

export interface TouchedFile {
  path: string;
  action: "edit" | "write";
}

/** `sinceMs`(run 시작 직전 epoch ms) 이후 변경된 dirty 파일들 — 이 run 의 소행으로
 *  본다. 이미 dirty 였다 또 고쳐도 mtime 이 갱신되므로 잡힌다. 삭제는 stat 불가라
 *  자연히 빠진다(편집·생성만 귀속). */
export function gitFilesTouchedSince(cwd: string, sinceMs: number): TouchedFile[] {
  const dirty = gitDirty(cwd);
  if (!dirty) return [];
  const out: TouchedFile[] = [];
  for (const [rel, status] of dirty) {
    let mtime: number;
    try {
      mtime = fs.statSync(path.join(cwd, rel)).mtimeMs;
    } catch {
      continue; // 삭제됐거나 접근 불가 — 귀속하지 않음
    }
    // 1s 여유 — mtime 해상도와 spawn 직전 찍은 since 의 미세 오차 흡수.
    if (mtime + 1_000 < sinceMs) continue;
    // 신규(untracked '??' 또는 added 'A') 는 write, 그 외는 edit.
    const action = status.includes("?") || status.includes("A") ? "write" : "edit";
    out.push({ path: rel, action });
  }
  return out;
}
