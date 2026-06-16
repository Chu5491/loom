// 프로젝트 파일·Git API — 워크스페이스의 파일/Git 뷰가 소비.
// git 은 의존성 없이 execFile("git") — 프로젝트 cwd 에서만 실행, 경로는 검증.

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { Hono } from "hono";
import { z } from "zod";
import { paths } from "../config.js";
import { getProjectDb, getRunEventsDb, listAgentFileActivity } from "../db.js";
import { logger } from "../logger.js";
import { readFunction } from "../office.js";
import { startRun, waitForRun } from "../run/engine.js";
import {
  analysisDocPath,
  analysisReportSchema,
  notesPath,
  renderAnalysisMarkdown,
  type AnalysisRecord,
  type AnalysisReport,
} from "../run/project-memory.js";
import { getStandup, runStandup } from "../run/standup.js";
import { isResponse, parseBody } from "./helpers.js";

const exec = promisify(execFile);
export const projectFilesRoute = new Hono();

const SKIP = new Set([".git", "node_modules", "dist", "build", ".next", "__pycache__", ".venv", "data"]);
const MAX_FILE_BYTES = 1024 * 1024; // 뷰어 1MB cap

// 프로젝트 루트 밖으로 못 나가게 — 상대경로 resolve 후 prefix 검증 + 심볼릭 링크 해소.
// prefix 만 검사하면 프로젝트 안의 심링크(ln -s ~/.ssh evil)로 외부 파일을 읽을 수 있다.
export function resolveInside(root: string, rel: string): string {
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error(`path escapes project: ${rel}`);
  try {
    const real = fs.realpathSync(abs);
    const realRoot = fs.realpathSync(root);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
      throw new Error(`symlink escapes project: ${rel}`);
    }
  } catch (e) {
    // 아직 없는 경로(신규 쓰기 대상)는 통과 — 실존하는 링크만 검사할 수 있다.
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  return abs;
}

function project(c: { req: { param: (k: string) => string } }) {
  return getProjectDb(c.req.param("id"));
}

// ── 파일 트리(한 단계) + 파일 내용 ─────────────────────────────────────────────
projectFilesRoute.get("/:id/tree", (c) => {
  const p = project(c);
  if (!p) return c.json({ error: "not_found" }, 404);
  let abs: string;
  try {
    abs = resolveInside(p.path, c.req.query("path") ?? ".");
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return c.json({ error: "not_a_directory" }, 400);
  }
  const rel = (name: string) => path.relative(p.path, path.join(abs, name));
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP.has(e.name))
    .map((e) => ({ name: e.name, path: rel(e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = entries
    .filter((e) => e.isFile() && !e.name.startsWith("."))
    .map((e) => ({ name: e.name, path: rel(e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return c.json({ dirs, files });
});

projectFilesRoute.get("/:id/file", (c) => {
  const p = project(c);
  if (!p) return c.json({ error: "not_found" }, 404);
  try {
    const abs = resolveInside(p.path, c.req.query("path") ?? "");
    const stat = fs.statSync(abs);
    if (!stat.isFile()) return c.json({ error: "not_a_file" }, 400);
    if (stat.size > MAX_FILE_BYTES) return c.json({ error: "file_too_large" }, 413);
    return c.json({ content: fs.readFileSync(abs, "utf8") });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

// ── Git ───────────────────────────────────────────────────────────────────────
async function git(cwd: string, args: string[]): Promise<string> {
  // GIT_TERMINAL_PROMPT=0 — push/pull 이 자격증명 입력을 요구하면 행되지 않고
  // 즉시 실패하게(서버 요청이 무한 대기하는 것 방지). SSH 키/credential helper 가
  // 설정돼 있으면 정상 동작.
  const { stdout } = await exec("git", args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout;
}

/** upstream 대비 ahead/behind — push/pull 버튼 활성화 판단. upstream 없으면 null. */
async function aheadBehind(cwd: string): Promise<{ ahead: number; behind: number } | null> {
  try {
    const out = (await git(cwd, ["rev-list", "--count", "--left-right", "@{upstream}...HEAD"])).trim();
    const [behind, ahead] = out.split(/\s+/).map((n) => parseInt(n, 10));
    return { ahead: ahead || 0, behind: behind || 0 };
  } catch {
    return null; // upstream 미설정 또는 추적 브랜치 아님
  }
}

projectFilesRoute.get("/:id/git/status", async (c) => {
  const p = project(c);
  if (!p) return c.json({ error: "not_found" }, 404);
  try {
    const branch = (await git(p.path, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    const raw = await git(p.path, ["status", "--porcelain"]);
    const files = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => ({
        staged: line[0] !== " " && line[0] !== "?",
        status: line[0] === "?" ? "?" : (line[0] !== " " ? line[0] : line[1]) ?? "M",
        path: line.slice(3).replace(/^"|"$/g, ""),
      }));
    return c.json({ git: true, branch, files, remote: await aheadBehind(p.path) });
  } catch {
    return c.json({ git: false, branch: null, files: [], remote: null }); // git repo 아님 — Git 뷰가 안내
  }
});

// 변경 개요 — 작업트리의 바뀐 파일 + 파일별 +N/-M 줄 통계(numstat). 리뷰 보드용.
// staged·unstaged·untracked 를 합쳐 "이 작업으로 바뀐 것"을 한 번에 보여준다.
projectFilesRoute.get("/:id/git/changes", async (c) => {
  const p = project(c);
  if (!p) return c.json({ error: "not_found" }, 404);
  try {
    // tracked 변경(staged+unstaged 합산) — `git diff HEAD --numstat`.
    const tracked = await git(p.path, ["diff", "HEAD", "--numstat"]);
    const stats = new Map<string, { added: number; removed: number }>();
    for (const line of tracked.split("\n").filter(Boolean)) {
      const [a, d, ...rest] = line.split("\t");
      const file = rest.join("\t").replace(/^"|"$/g, "");
      if (!file) continue;
      // 바이너리는 numstat 이 "-" — 0 으로.
      stats.set(file, { added: a === "-" ? 0 : Number(a) || 0, removed: d === "-" ? 0 : Number(d) || 0 });
    }
    // status 로 action(추가/수정/삭제) + untracked 파일까지 포함.
    const status = await git(p.path, ["status", "--porcelain", "--untracked-files=all"]);
    const out: { path: string; action: "add" | "edit" | "delete"; added: number; removed: number }[] = [];
    for (const line of status.split("\n").filter(Boolean)) {
      const code = line.slice(0, 2);
      const rel = line.slice(3).split(" -> ").pop()!.replace(/^"|"$/g, "");
      const untracked = code.includes("?");
      const deleted = code.includes("D");
      let added = stats.get(rel)?.added ?? 0;
      let removed = stats.get(rel)?.removed ?? 0;
      if (untracked) {
        // 새 파일 — numstat 에 없으니 줄 수를 직접 센다(텍스트만, 큰 파일 제외).
        try {
          const abs = path.join(p.path, rel);
          if (fs.statSync(abs).size <= MAX_FILE_BYTES) added = fs.readFileSync(abs, "utf8").split("\n").length;
        } catch { /* 접근 불가 — 0 */ }
      }
      out.push({ path: rel, action: untracked || code.includes("A") ? "add" : deleted ? "delete" : "edit", added, removed });
    }
    return c.json({ git: true, changes: out });
  } catch {
    return c.json({ git: false, changes: [] });
  }
});

// Monaco DiffEditor 용 — HEAD 버전과 작업본을 그대로 준다(diff 텍스트 파싱 불필요).
projectFilesRoute.get("/:id/git/versions", async (c) => {
  const p = project(c);
  if (!p) return c.json({ error: "not_found" }, 404);
  const rel = c.req.query("path") ?? "";
  try {
    resolveInside(p.path, rel);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
  let head: string | null = null;
  try {
    head = await git(p.path, ["show", `HEAD:${rel}`]);
  } catch {
    head = null; // 새 파일
  }
  let working: string | null = null;
  try {
    const abs = path.join(p.path, rel);
    if (fs.statSync(abs).size <= MAX_FILE_BYTES) working = fs.readFileSync(abs, "utf8");
  } catch {
    working = null; // 삭제됨
  }
  return c.json({ head, working });
});

const pathsSchema = z.object({ paths: z.array(z.string().min(1)).min(1).max(200) });
projectFilesRoute.post("/:id/git/stage", async (c) => {
  const p = project(c);
  if (!p) return c.json({ error: "not_found" }, 404);
  const data = await parseBody(c, pathsSchema);
  if (isResponse(data)) return data;
  try {
    data.paths.forEach((r) => resolveInside(p.path, r));
    await git(p.path, ["add", "--", ...data.paths]);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

projectFilesRoute.post("/:id/git/unstage", async (c) => {
  const p = project(c);
  if (!p) return c.json({ error: "not_found" }, 404);
  const data = await parseBody(c, pathsSchema);
  if (isResponse(data)) return data;
  try {
    data.paths.forEach((r) => resolveInside(p.path, r));
    await git(p.path, ["reset", "HEAD", "--", ...data.paths]);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

projectFilesRoute.post("/:id/git/commit", async (c) => {
  const p = project(c);
  if (!p) return c.json({ error: "not_found" }, 404);
  const data = await parseBody(c, z.object({ message: z.string().trim().min(1).max(2000) }));
  if (isResponse(data)) return data;
  try {
    const out = await git(p.path, ["commit", "-m", data.message]);
    return c.json({ ok: true, output: out.trim() });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

// 원격 동기화 — push/pull/fetch. 자격증명 프롬프트는 GIT_TERMINAL_PROMPT=0 로 차단
// (SSH 키/credential helper 필요). stderr 까지 출력에 담아 결과를 보여준다.
async function gitRemote(cwd: string, args: string[]): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  try {
    const { stdout, stderr } = await exec("git", args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return { ok: true, output: (stdout + stderr).trim() || "done" };
  } catch (e) {
    // git 은 push/pull 실패를 stderr + 비0 종료로 — 메시지를 그대로 노출.
    const err = e as { stderr?: string; message?: string };
    return { ok: false, error: (err.stderr || err.message || "git failed").trim() };
  }
}

for (const [op, args] of [
  ["push", ["push"]],
  ["pull", ["pull", "--ff-only"]], // 머지 커밋 자동 생성 회피 — 충돌 시 사용자가 처리
  ["fetch", ["fetch", "--all", "--prune"]],
] as const) {
  projectFilesRoute.post(`/:id/git/${op}`, async (c) => {
    const p = project(c);
    if (!p) return c.json({ error: "not_found" }, 404);
    const r = await gitRemote(p.path, [...args]);
    return r.ok ? c.json({ ok: true, output: r.output }) : c.json({ error: r.error }, 400);
  });
}

// ── 커밋 메시지 AI 생성 — staged diff 를 에이전트에게 보내 한 줄 초안을 받는다 ───
// 스레드 없는 유틸 run(Talk 에 안 보임). diff 가 크면 --stat 요약으로 대체.
const MAX_DIFF_CHARS = 30_000;
projectFilesRoute.post("/:id/git/suggest-commit", async (c) => {
  const p = project(c);
  if (!p) return c.json({ error: "not_found" }, 404);

  let diff: string;
  try {
    diff = await git(p.path, ["diff", "--cached"]);
    if (!diff.trim()) return c.json({ error: "nothing_staged" }, 400);
    if (diff.length > MAX_DIFF_CHARS) {
      diff = (await git(p.path, ["diff", "--cached", "--stat"])) + "\n(diff too large — stat summary only)";
    }
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }

  // 양식 = 코드 고정 / 지침(스타일) = office/prompts/git-commit.md. 기능(git-commit)
  // 으로 실행 — 에이전트 선택 없이 기능에 지정된 어댑터·모델로.
  const prompt =
    "Write a git commit message for the staged diff below.\n" +
    "Mandatory format: first line `<scope>: <imperative summary>` under 72 chars; " +
    "optional short body lines explaining WHY. " +
    "Reply with ONLY the commit message — no quotes, no code fences, no explanations.\n\n" +
    "```diff\n" + diff + "\n```";

  const gitFn = readFunction("git-commit");
  const started = await startRun({ fn: { name: gitFn.name, adapter: gitFn.adapter, model: gitFn.model }, prompt, promptOverride: gitFn.prompt });
  if (!started.ok) return c.json({ error: started.error }, started.status);
  try {
    const done = await waitForRun(started.run.id, 120_000);
    const events = getRunEventsDb(started.run.id);
    const result = [...events].reverse().find((e) => e.kind === "result");
    // 모델이 지시를 어기고 펜스/따옴표로 감싸는 경우(opencode 등) 정규화.
    const message = (result && "text" in result ? result.text : "")
      .trim()
      .replace(/^```[a-zA-Z]*\n?/, "")
      .replace(/\n?```$/, "")
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim();
    if (done.status !== "succeeded" || !message) {
      return c.json({ error: `agent run ${done.status}: ${message.slice(0, 200) || "no output"}` }, 502);
    }
    return c.json({ message });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 504);
  }
});

// ── 에이전트 활동 — 어떤 run 이 어떤 파일을 만졌나(file 이벤트 기반) ─────────────
projectFilesRoute.get("/:id/agent-activity", (c) => {
  const p = project(c);
  if (!p) return c.json({ error: "not_found" }, 404);
  return c.json({ activity: listAgentFileActivity(p.id) });
});

// ── 프로젝트 분석 — 분석 에이전트에게 구조화 리포트(JSON 스키마)를 받아 GUI 로 ──
// 결과는 data/analysis/<projectId>.json 에 마지막 1개 보존(기록 — gitignore).
// 모델 출력이 느슨해도 살리는 방향: 점수는 0-100 으로 clamp, 옛 포맷(문자열 배열)도
function analysisPath(projectId: string): string {
  return path.join(paths.data, "analysis", `${projectId}.json`);
}

projectFilesRoute.get("/:id/analysis", (c) => {
  const p = project(c);
  if (!p) return c.json({ error: "not_found" }, 404);
  try {
    const stored = JSON.parse(fs.readFileSync(analysisPath(p.id), "utf8"));
    // 옛 포맷(문자열 risks 등)도 스키마 union 이 흡수 — 읽기 시점에 정규화.
    const normalize = (a: { report?: unknown } | null | undefined) => {
      if (!a) return a;
      const r = analysisReportSchema.safeParse(a.report);
      return r.success ? { ...a, report: r.data } : a;
    };
    return c.json({
      analysis: normalize(stored?.analysis) ?? null,
      history: Array.isArray(stored?.history) ? stored.history.map(normalize) : [],
    });
  } catch {
    return c.json({ analysis: null, history: [] }); // 아직 분석 안 함
  }
});

const ANALYZE_TIMEOUT_MS = 5 * 60_000;
projectFilesRoute.post("/:id/analyze", async (c) => {
  const p = project(c);
  if (!p) return c.json({ error: "not_found" }, 404);
  const data = await parseBody(c, z.object({ lang: z.enum(["en", "ko"]).default("en") }));
  if (isResponse(data)) return data;

  const prompt =
    "Analyze the project in the current working directory: read the key files (README, manifest, entry points, main source dirs) as needed.\n" +
    "Reply with ONLY a JSON object — no code fences, no commentary — matching exactly:\n" +
    "{\n" +
    '  "summary": string,        // 2-3 sentences: what this project is, how it is structured\n' +
    '  "stack": string[],        // languages, frameworks, key dependencies\n' +
    '  "languages": [{"name": string, "percent": number}],  // source language mix, percents sum to ~100\n' +
    '  "health": {"tests": number, "docs": number, "structure": number, "maintainability": number},  // honest 0-100 scores\n' +
    '  "metrics": {"files": number, "loc": number},  // rough source file count and lines of code\n' +
    '  "structure": [{"path": string, "desc": string}],  // the top-level dirs/files that matter, desc under 8 words\n' +
    '  "keyFiles": [{"path": string, "desc": string}],   // entry points / load-bearing files, desc under 8 words\n' +
    '  "risks": [{"text": string, "severity": "high"|"medium"|"low"}],  // tech debt, fragile spots — one short sentence each\n' +
    '  "suggestions": [{"text": string, "effort": "small"|"medium"|"large"}]  // concrete next improvements — one short sentence each\n' +
    "}\n" +
    // JSON 형태는 고정(파서가 의존), 내용의 관점·스타일은 office/prompts/analysis.md.
    "The JSON shape above is mandatory.\n" +
    (data.lang === "ko" ? "Write all string values in Korean.\n" : "");

  const anFn = readFunction("analysis");
  const started = await startRun({ fn: { name: anFn.name, adapter: anFn.adapter, model: anFn.model }, prompt, projectId: p.id, promptOverride: anFn.prompt });
  if (!started.ok) return c.json({ error: started.error }, started.status);
  try {
    const done = await waitForRun(started.run.id, ANALYZE_TIMEOUT_MS);
    const events = getRunEventsDb(started.run.id);
    const result = [...events].reverse().find((e) => e.kind === "result");
    const raw = (result && "text" in result ? result.text : "").trim()
      .replace(/^```[a-zA-Z]*\n?/, "")
      .replace(/\n?```$/, "")
      .trim();
    if (done.status !== "succeeded" || !raw) {
      return c.json({ error: `agent run ${done.status}: ${raw.slice(0, 200) || "no output"}` }, 502);
    }
    // 모델이 JSON 앞뒤에 말을 붙이는 경우 — 첫 { 부터 마지막 } 까지만 시도.
    let report: AnalysisReport;
    try {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      report = analysisReportSchema.parse(JSON.parse(raw.slice(start, end + 1)));
    } catch {
      return c.json({ error: "unparseable_report", raw: raw.slice(0, 2000) }, 502);
    }
    const analysis: AnalysisRecord = { analyzedAt: new Date().toISOString(), agent: `fn:${anFn.name}`, runId: started.run.id, report };
    // 히스토리 — 직전 리포트들을 보존(최신 20개). 건강도 추이의 원천.
    let history: unknown[] = [];
    try {
      const prev = JSON.parse(fs.readFileSync(analysisPath(p.id), "utf8"));
      history = [prev.analysis, ...(Array.isArray(prev.history) ? prev.history : [])].filter(Boolean).slice(0, 19);
    } catch {
      // 첫 분석 — 히스토리 없음
    }
    fs.mkdirSync(path.join(paths.data, "analysis"), { recursive: true });
    fs.writeFileSync(analysisPath(p.id), JSON.stringify({ analysis, history }, null, 2));
    // 에이전트용 뷰 — 프로젝트 cwd 안에 풀어 다른 CLI 도구가 이 분석을 이어 읽게 한다.
    // temp+rename 으로 원자적 쓰기(읽는 도중 깨진 파일 방지).
    try {
      fs.mkdirSync(path.join(p.path, ".loom"), { recursive: true });
      const doc = analysisDocPath(p.path);
      fs.writeFileSync(`${doc}.tmp`, renderAnalysisMarkdown(analysis));
      fs.renameSync(`${doc}.tmp`, doc);
    } catch (e) {
      // 프로젝트 디렉토리 쓰기 실패는 분석 자체를 실패시키지 않는다(정본은 data/ JSON).
      // 다만 에이전트 공유 뷰가 안 생기므로 경고로 남긴다.
      logger.warn({ err: e, projectId: p.id }, "failed to write .loom/analysis.md");
    }
    return c.json({ analysis });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 504);
  }
});

// ── 프로젝트 공유 메모 — <project>/.loom/notes.md (팀의 프로젝트 기억) ──────────
// run 프롬프트에는 파일이 있을 때만 경로가 안내된다(본문 주입 없음). 경로 헬퍼는
// run/project-memory.ts 가 정본(분석 뷰와 한 곳에서 관리).
projectFilesRoute.get("/:id/notes", (c) => {
  const p = project(c);
  if (!p) return c.json({ error: "not_found" }, 404);
  try {
    return c.json({ notes: fs.readFileSync(notesPath(p.path), "utf8") });
  } catch {
    return c.json({ notes: null }); // 아직 없음 — UI 가 "시작" 을 제안
  }
});

projectFilesRoute.put("/:id/notes", async (c) => {
  const p = project(c);
  if (!p) return c.json({ error: "not_found" }, 404);
  const data = await parseBody(c, z.object({ notes: z.string().max(200_000) }));
  if (isResponse(data)) return data;
  fs.mkdirSync(path.join(p.path, ".loom"), { recursive: true });
  fs.writeFileSync(notesPath(p.path), data.notes);
  return c.json({ ok: true });
});

// ── 스탠드업 — 지난 24h run 기록 + git log 로 데일리 리포트 (run/standup.ts) ────
projectFilesRoute.get("/:id/standup", (c) => {
  const p = project(c);
  if (!p) return c.json({ error: "not_found" }, 404);
  return c.json(getStandup(p.id));
});

projectFilesRoute.post("/:id/standup", async (c) => {
  const p = project(c);
  if (!p) return c.json({ error: "not_found" }, 404);
  const data = await parseBody(c, z.object({ agent: z.string().min(1), lang: z.enum(["en", "ko"]).default("en") }));
  if (isResponse(data)) return data;
  const r = await runStandup(p.id, data.agent, data.lang);
  if (!r.ok) return c.json({ error: r.error }, r.status as 400);
  return c.json({ standup: r.standup });
});
