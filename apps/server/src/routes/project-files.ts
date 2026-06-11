// 프로젝트 파일·Git API — 워크스페이스의 파일/Git 뷰가 소비.
// git 은 의존성 없이 execFile("git") — 프로젝트 cwd 에서만 실행, 경로는 검증.

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { Hono } from "hono";
import { z } from "zod";
import { getProjectDb, getRunEventsDb, listAgentFileActivity } from "../db.js";
import { startRun, waitForRun } from "../run/engine.js";
import { isResponse, parseBody } from "./helpers.js";

const exec = promisify(execFile);
export const projectFilesRoute = new Hono();

const SKIP = new Set([".git", "node_modules", "dist", "build", ".next", "__pycache__", ".venv", "data"]);
const MAX_FILE_BYTES = 1024 * 1024; // 뷰어 1MB cap

// 프로젝트 루트 밖으로 못 나가게 — 상대경로를 resolve 해 prefix 검증.
function resolveInside(root: string, rel: string): string {
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error(`path escapes project: ${rel}`);
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
  const { stdout } = await exec("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  return stdout;
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
    return c.json({ git: true, branch, files });
  } catch {
    return c.json({ git: false, branch: null, files: [] }); // git repo 아님 — Git 뷰가 안내
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

// ── 커밋 메시지 AI 생성 — staged diff 를 에이전트에게 보내 한 줄 초안을 받는다 ───
// 스레드 없는 유틸 run(Talk 에 안 보임). diff 가 크면 --stat 요약으로 대체.
const MAX_DIFF_CHARS = 30_000;
projectFilesRoute.post("/:id/git/suggest-commit", async (c) => {
  const p = project(c);
  if (!p) return c.json({ error: "not_found" }, 404);
  const data = await parseBody(c, z.object({ agent: z.string().min(1) }));
  if (isResponse(data)) return data;

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

  const prompt =
    "Write a git commit message for the staged diff below.\n" +
    "Rules: first line `<scope>: <imperative summary>` under 72 chars; " +
    "optionally 1-3 short body lines explaining WHY. Match the language of the diff/codebase comments. " +
    "Reply with ONLY the commit message — no quotes, no code fences, no explanations.\n\n" +
    "```diff\n" + diff + "\n```";

  const started = await startRun({ agent: data.agent, prompt });
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
