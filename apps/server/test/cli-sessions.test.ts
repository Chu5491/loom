// CLI 세션 정리 — 하나의 프로젝트 안 하나의 대화(스레드)에 여러 CLI 세션이 연결되고,
// 한 번에 삭제되는지. runs 장부(adapter+session_id)가 "loom 이 만든 세션"의 진실이고,
// 각 어댑터가 그 세션의 디스크 파일을 짚는다. db·세션 파일 모두 임시 폴더로 격리.

import { afterAll, beforeAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RunInfo } from "@loom/core";

// 모듈 import 전에 env 를 박는다(config.ts·어댑터가 import/호출 시점에 읽음).
const home = fs.mkdtempSync(path.join(os.tmpdir(), "loom-cleanup-test-"));
process.env.LOOM_HOME = home;
process.env.HOME = home; // claude/codex/agy/factory 세션 root 의 기준
process.env.XDG_DATA_HOME = path.join(home, "share"); // opencode/devin 의 기준

const db = await import("../src/db.js");
const { collectSessionArtifacts, deleteSessionArtifacts } = await import("../src/routes/cli-sessions.js");
const { claudeProjectSlug } = await import("@loom/adapter-claude-code");

const CWD = path.join(home, "myproj");
const SLUG = claudeProjectSlug(CWD);

// adapter ↔ session id ↔ 그 세션이 디스크에 남기는 파일(저장 레이아웃이 CLI마다 다름).
// factory 는 인증 후라야 세션이 생기고 레이아웃이 미검증이라 제외.
const CASES: Array<{ adapter: string; sid: string; files: string[] }> = [
  {
    adapter: "claude-code",
    sid: "claude-sess-1",
    files: [path.join(home, ".claude", "projects", SLUG, "claude-sess-1.jsonl")],
  },
  {
    adapter: "codex",
    sid: "019codexuuid",
    files: [path.join(home, ".codex", "sessions", "2026", "06", "18", "rollout-test-019codexuuid.jsonl")],
  },
  {
    adapter: "opencode",
    sid: "ses_opencode1",
    files: [
      path.join(home, "share", "opencode", "storage", "todo", "ses_opencode1.json"),
      path.join(home, "share", "opencode", "storage", "message", "ses_opencode1", "msg_1.json"),
    ],
  },
  {
    adapter: "devin",
    sid: "alder-devin",
    files: [path.join(home, "share", "devin", "cli", "transcripts", "alder-devin.json")],
  },
  {
    adapter: "antigravity",
    sid: "agy-conv-1",
    files: [path.join(home, ".gemini", "antigravity-cli", "conversations", "agy-conv-1.db")],
  },
];

function touch(p: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, "x");
}

beforeAll(() => {
  db.insertProject({ id: "p1", name: "proj", path: CWD, createdAt: "2026-06-18T00:00:00.000Z" });
  db.insertThread({ id: "t1", name: "대화", projectId: "p1", createdAt: "2026-06-18T00:00:00.000Z" });
  // 같은 다른 대화의 세션은 손대면 안 됨 — 격리 확인용 대조군.
  db.insertThread({ id: "t2", name: "다른 대화", projectId: "p1", createdAt: "2026-06-18T00:00:00.000Z" });
  CASES.forEach((cse, i) => {
    const info: RunInfo = {
      id: `r${i}`,
      agent: cse.adapter,
      prompt: "p",
      status: "succeeded",
      startedAt: "2026-06-18T00:00:00.000Z",
      endedAt: "2026-06-18T00:01:00.000Z",
      exitCode: 0,
      parentRunId: null,
      projectId: "p1",
      threadId: "t1",
      adapter: cse.adapter as RunInfo["adapter"],
      costUsd: null,
    };
    db.insertRun(info);
    db.finishRun(info, { sessionId: cse.sid }); // session_id 는 finish 가 채운다
    cse.files.forEach(touch);
  });
  // 대조군: t2 의 claude 세션 (지워지면 안 됨)
  const other: RunInfo = {
    id: "r-other", agent: "claude-code", prompt: "p", status: "succeeded",
    startedAt: "2026-06-18T00:00:00.000Z", endedAt: "2026-06-18T00:01:00.000Z",
    exitCode: 0, parentRunId: null, projectId: "p1", threadId: "t2",
    adapter: "claude-code", costUsd: null,
  };
  db.insertRun(other);
  db.finishRun(other, { sessionId: "claude-other" });
  touch(path.join(home, ".claude", "projects", SLUG, "claude-other.jsonl"));
});

afterAll(() => {
  db.closeDb();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("CLI 세션: 프로젝트·대화 연결 + 일괄 삭제", () => {
  it("collects every CLI's session in a thread and resolves each to its on-disk files", () => {
    const arts = collectSessionArtifacts({ threadId: "t1" });
    expect(arts.map((a) => a.adapter).sort()).toEqual([
      "antigravity",
      "claude-code",
      "codex",
      "devin",
      "opencode",
    ]);
    for (const a of arts) expect(a.files.length).toBeGreaterThan(0);
  });

  it("scopes to the thread — does not touch another conversation's sessions", () => {
    const arts = collectSessionArtifacts({ threadId: "t1" });
    const all = arts.flatMap((a) => a.files);
    expect(all.some((f) => f.includes("claude-other"))).toBe(false);
  });

  it("deletes all of a thread's session files at once, leaving other threads intact", () => {
    const arts = collectSessionArtifacts({ threadId: "t1" });
    const all = arts.flatMap((a) => a.files);
    expect(all.every((f) => fs.existsSync(f))).toBe(true);

    const { deletedFiles } = deleteSessionArtifacts(arts);
    expect(deletedFiles).toBeGreaterThanOrEqual(CASES.length);
    expect(all.some((f) => fs.existsSync(f))).toBe(false); // 전부 사라짐

    // 대조군(t2)은 그대로
    expect(fs.existsSync(path.join(home, ".claude", "projects", SLUG, "claude-other.jsonl"))).toBe(true);
  });
});
