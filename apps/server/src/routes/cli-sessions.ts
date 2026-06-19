// CLI 세션 저장 — 측정 + 정리. loom 이 만든 세션은 어느 프로젝트의 어느 대화에 속하는지
// runs 장부(adapter+session_id)로 추적되며, 사용자가 대화를 지울 때 그 CLI 세션 파일을
// 함께 정리할 수 있다. 헌법 3조(CLI root 불가침)는 CLI 전역설정 *주입/오염* 금지이지,
// 사용자가 요청한 자기 세션 정리 금지가 아니다 — 어느 파일을 지울지는 각 어댑터가 안다.

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { Hono } from "hono";
import { z } from "zod";
import { getAdapter } from "../adapters/registry.js";
import { listRunsDb, getProjectDb } from "../db.js";
import type { RunInfo } from "@loom/core";
import { isResponse, parseBody } from "./helpers.js";
import { logger } from "../logger.js";

const HOME = os.homedir();
const XDG_DATA = process.env.XDG_DATA_HOME || path.join(HOME, ".local", "share");

// 측정 대상 — 각 CLI 의 세션 root. (정리는 세션 단위로 어댑터가 경로를 짚는다.)
const STORES: Array<{ kind: string; path: string }> = [
  { kind: "claude-code", path: path.join(HOME, ".claude", "projects") },
  { kind: "codex", path: path.join(HOME, ".codex", "sessions") },
  { kind: "opencode", path: path.join(XDG_DATA, "opencode") },
  { kind: "devin", path: path.join(XDG_DATA, "devin", "cli", "sessions.db") },
  { kind: "antigravity", path: path.join(HOME, ".gemini", "antigravity-cli", "conversations") },
  { kind: "factory", path: path.join(HOME, ".factory", "sessions") },
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

export interface SessionArtifact {
  adapter: string;
  sessionId: string;
  files: string[];
  bytes: number;
}

/** 이 스레드/프로젝트에서 loom 이 만든 세션들의 디스크 파일을 어댑터별로 모은다.
 *  runs 장부(adapter+session_id)가 "loom 것"의 진실 — 직접 쓴 세션은 안 잡힌다.
 *  cwd 는 claude 처럼 경로가 cwd 에 의존하는 CLI 를 위해 프로젝트 path 로 채운다. */
export function collectSessionArtifacts(filter: { threadId?: string; projectId?: string }): SessionArtifact[] {
  return sessionArtifactsFromRuns(listRunsDb(filter));
}

/** run 행 목록 → loom 이 만든 세션들의 디스크 아티팩트. filter 가 아니라 run 행을 받아,
 *  리텐션 스윕(컷오프로 고른 run)도 같은 로직으로 세션을 정리할 수 있게 한다. */
export function sessionArtifactsFromRuns(runs: RunInfo[]): SessionArtifact[] {
  const seen = new Set<string>();
  const out: SessionArtifact[] = [];
  for (const r of runs) {
    if (!r.sessionId || !r.adapter || seen.has(r.sessionId)) continue;
    seen.add(r.sessionId);
    const adapter = getAdapter(r.adapter);
    if (!adapter?.sessionFiles) continue;
    const cwd = r.projectId ? getProjectDb(r.projectId)?.path ?? "" : "";
    const files = adapter.sessionFiles(r.sessionId, cwd);
    if (files.length === 0) continue;
    out.push({ adapter: r.adapter, sessionId: r.sessionId, files, bytes: files.reduce((s, f) => s + sizeOf(f), 0) });
  }
  return out;
}

/** 세션 파일 삭제 — 디스크 쓰기지만 사용자가 명시 요청한 자기 세션 정리(헌법 3조 위배 아님).
 *  반환: 지운 파일 수 + 회수 바이트. 개별 실패는 로그만 남기고 계속한다. */
export function deleteSessionArtifacts(artifacts: SessionArtifact[]): { deletedFiles: number; freedBytes: number } {
  let deletedFiles = 0;
  let freedBytes = 0;
  for (const a of artifacts) {
    for (const f of a.files) {
      try {
        const sz = sizeOf(f);
        fs.rmSync(f, { recursive: true, force: true });
        deletedFiles++;
        freedBytes += sz;
      } catch (err) {
        logger.warn({ file: f, err: (err as Error).message }, "session file delete failed");
      }
    }
  }
  return { deletedFiles, freedBytes };
}

export const cliSessionsRoute = new Hono();

// 전체 용량 측정 — 각 CLI root 의 footprint.
cliSessionsRoute.get("/", (c) => {
  const stores = STORES.map((s) => {
    const exists = fs.existsSync(s.path);
    return { kind: s.kind, path: s.path, exists, bytes: exists ? sizeOf(s.path) : 0 };
  });
  return c.json({ stores });
});

// 미리보기(dry-run) — 무엇이 지워질지 파일·용량을 먼저 보여준다.
cliSessionsRoute.get("/preview", (c) => {
  const threadId = c.req.query("threadId") || undefined;
  const projectId = c.req.query("projectId") || undefined;
  if (!threadId && !projectId) return c.json({ error: "threadId_or_projectId_required" }, 400);
  const sessions = collectSessionArtifacts({ threadId, projectId });
  return c.json({ sessions, totalBytes: sessions.reduce((s, x) => s + x.bytes, 0) });
});

const cleanupSchema = z.object({
  threadId: z.string().optional(),
  projectId: z.string().optional(),
});

// 정리 — loom 이 만든 세션 파일 삭제(스레드/프로젝트 단위).
cliSessionsRoute.post("/cleanup", async (c) => {
  const data = await parseBody(c, cleanupSchema);
  if (isResponse(data)) return data;
  if (!data.threadId && !data.projectId) return c.json({ error: "threadId_or_projectId_required" }, 400);
  const sessions = collectSessionArtifacts(data);
  const result = deleteSessionArtifacts(sessions);
  logger.info({ ...data, ...result, sessions: sessions.length }, "cli sessions cleaned");
  return c.json({ ...result, sessions: sessions.length });
});
