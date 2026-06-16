// CLI 세션 저장 용량 — 읽기 전용. 각 CLI 는 자기 root 에 세션을 무한정 쌓는데,
// 헌법 3조(CLI root 불가침)상 loom 이 지울 수 없다. 그래서 "측정만" 해서 사용자가
// 언제 직접 정리할지 판단하게 돕는다(stat 은 수정이 아니므로 불가침 위배 아님).

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { Hono } from "hono";
import { logger } from "../logger.js";

const HOME = os.homedir();
const XDG_DATA = process.env.XDG_DATA_HOME || path.join(HOME, ".local", "share");

// 세션 저장 위치 — 각 어댑터 주석에서 확인한 경로. antigravity 는 저장 위치가
// 문서화돼 있지 않아 제외(추측해 틀린 경로를 보여주느니 빼는 게 정직).
const STORES: Array<{ kind: string; path: string }> = [
  { kind: "claude-code", path: path.join(HOME, ".claude", "projects") },
  { kind: "codex", path: path.join(HOME, ".codex", "sessions") },
  { kind: "opencode", path: path.join(XDG_DATA, "opencode") },
  { kind: "devin", path: path.join(XDG_DATA, "devin", "cli", "sessions.db") },
];

const MAX_ENTRIES = 100_000; // 병적으로 큰 트리 방어

/** 파일/디렉토리 바이트 합(재귀). 진입 수 상한으로 폭주 방지. */
function sizeOf(target: string): number {
  let total = 0;
  let seen = 0;
  const walk = (p: string): void => {
    if (seen >= MAX_ENTRIES) return;
    let st: fs.Stats;
    try {
      st = fs.lstatSync(p);
    } catch {
      return; // 사라졌거나 권한 없음 — 건너뜀
    }
    seen++;
    if (st.isDirectory()) {
      let names: string[];
      try {
        names = fs.readdirSync(p);
      } catch {
        return;
      }
      for (const name of names) walk(path.join(p, name));
    } else if (st.isFile()) {
      total += st.size;
    }
  };
  walk(target);
  return total;
}

export const cliSessionsRoute = new Hono();

cliSessionsRoute.get("/", (c) => {
  const stores = STORES.map((s) => {
    const exists = fs.existsSync(s.path);
    return { kind: s.kind, path: s.path, exists, bytes: exists ? sizeOf(s.path) : 0 };
  });
  logger.debug({ stores: stores.map((s) => ({ kind: s.kind, bytes: s.bytes })) }, "cli session footprint measured");
  return c.json({ stores });
});
