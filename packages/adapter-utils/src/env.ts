import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const IS_WIN = process.platform === "win32";
const SEP = IS_WIN ? ";" : ":";

// CLI 인스톨러가 바이너리를 떨구는 위치 중, GUI 앱이나 비로그인 셸에서 띄운
// 서버의 PATH 가 자주 놓치는 디렉토리들(macOS .app / 맨 셸에서 pnpm dev 문제).
// 서버를 어떻게 띄웠든 설치된 CLI 를 찾도록 이들을 PATH 에 덧붙인다.
function extraBinDirs(): string[] {
  if (IS_WIN) return []; // Windows 는 레지스트리 PATH 라 패턴이 다름 — 필요 시 별도 처리
  const home = os.homedir();
  return [
    path.join(home, ".opencode", "bin"),
    path.join(home, ".local", "bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, ".cargo", "bin"),
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".deno", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** base PATH 끝에 dirs 를 덧붙인다(중복 제거, 기존 항목 우선). 순수 함수. */
export function appendPathDirs(base: string, dirs: string[]): string {
  const parts = base.split(SEP).filter(Boolean);
  const have = new Set(parts);
  for (const d of dirs) {
    if (!have.has(d)) {
      parts.push(d);
      have.add(d);
    }
  }
  return parts.join(SEP);
}

/** env 의 PATH 를 알려진 CLI 설치 디렉토리(실존하는 것만)까지 포함하도록 확장.
 *  실제 PATH 가 우선 — 거기 있으면 그걸 쓰고, 없을 때만 보강 디렉토리가 잡는다. */
export function withAugmentedPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base = env.PATH ?? process.env.PATH ?? "";
  return { ...env, PATH: appendPathDirs(base, extraBinDirs().filter(isDir)) };
}
