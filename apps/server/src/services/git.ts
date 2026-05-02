// 프로젝트 cwd에 대한 git 상태/diff/스테이지/커밋/로그 헬퍼.
// `git` CLI를 execFile로 호출하는 얇은 래퍼 — 의존성 추가 없이 동작.
// 모든 entry-point는 git 저장소가 아니거나 실패 시 명시적 에러를 던짐 — 라우트가
// 매핑해서 4xx/5xx 응답.

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

export class NotAGitRepoError extends Error {
  constructor() {
    super("not_a_git_repo");
    this.name = "NotAGitRepoError";
  }
}

export class GitCommandError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "GitCommandError";
  }
}

async function git(
  cwd: string,
  args: string[],
  opts: { maxBuffer?: number } = {},
): Promise<string> {
  try {
    const { stdout } = await execFile("git", args, {
      cwd,
      maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const stderr = (e.stderr ?? "").toString();
    if (
      stderr.includes("not a git repository") ||
      stderr.includes("fatal: not a git repository")
    ) {
      throw new NotAGitRepoError();
    }
    throw new GitCommandError(e.message ?? "git failed", stderr);
  }
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await git(cwd, ["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// status

export type WorkingChange = {
  /** workspace에서의 path. renamed면 to-path. */
  path: string;
  /** rename 시 원본 path. */
  fromPath?: string;
  /** porcelain v1의 1글자 코드 (M/A/D/R/C/U/?/!) */
  status: string;
};

export interface GitStatus {
  branch: string | null;
  /** detached HEAD면 head sha. */
  head: string | null;
  /** upstream 대비 ahead/behind. upstream 없으면 null. */
  ahead: number | null;
  behind: number | null;
  staged: WorkingChange[];
  unstaged: WorkingChange[];
  untracked: string[];
  conflicted: string[];
  /** 깔끔한 트리(diff 0개)면 true. */
  clean: boolean;
}

/** porcelain=v1 -z 출력 파싱 — NUL 구분이라 경로에 줄바꿈/공백 있어도 안전. */
export async function getStatus(cwd: string): Promise<GitStatus> {
  if (!(await isGitRepo(cwd))) throw new NotAGitRepoError();

  const branchInfo = await readBranchInfo(cwd);
  const out = await git(cwd, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);

  const staged: WorkingChange[] = [];
  const unstaged: WorkingChange[] = [];
  const untracked: string[] = [];
  const conflicted: string[] = [];

  // -z 파싱: 각 엔트리는 "XY <path>\0" — rename(R/C)은 그 뒤에 한 NUL을 더
  // 추가로 가져 "XY <to>\0<from>\0".
  const tokens = out.split("\0");
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    if (!entry) continue;
    const x = entry[0]!;
    const y = entry[1]!;
    const path = entry.slice(3);
    let fromPath: string | undefined;
    if (x === "R" || x === "C" || y === "R" || y === "C") {
      const from = tokens[++i];
      if (from) fromPath = from;
    }
    if (x === "?" && y === "?") {
      untracked.push(path);
      continue;
    }
    if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
      conflicted.push(path);
      continue;
    }
    if (x !== " " && x !== "?") {
      staged.push({ path, fromPath, status: x });
    }
    if (y !== " " && y !== "?") {
      unstaged.push({ path, fromPath, status: y });
    }
  }

  return {
    branch: branchInfo.branch,
    head: branchInfo.head,
    ahead: branchInfo.ahead,
    behind: branchInfo.behind,
    staged,
    unstaged,
    untracked,
    conflicted,
    clean:
      staged.length === 0 &&
      unstaged.length === 0 &&
      untracked.length === 0 &&
      conflicted.length === 0,
  };
}

async function readBranchInfo(cwd: string): Promise<{
  branch: string | null;
  head: string | null;
  ahead: number | null;
  behind: number | null;
}> {
  // detached면 비어있음 — fall back to short sha.
  let branch: string | null = null;
  try {
    const out = (await git(cwd, ["symbolic-ref", "--short", "HEAD"])).trim();
    branch = out || null;
  } catch {
    branch = null;
  }
  let head: string | null = null;
  try {
    head = (await git(cwd, ["rev-parse", "--short", "HEAD"])).trim() || null;
  } catch {
    head = null;
  }

  let ahead: number | null = null;
  let behind: number | null = null;
  if (branch) {
    try {
      const out = (
        await git(cwd, [
          "rev-list",
          "--left-right",
          "--count",
          `${branch}...@{u}`,
        ])
      ).trim();
      const [a, b] = out.split(/\s+/).map((n) => parseInt(n, 10));
      if (Number.isFinite(a) && Number.isFinite(b)) {
        ahead = a!;
        behind = b!;
      }
    } catch {
      // upstream 미설정 — null 유지
    }
  }
  return { branch, head, ahead, behind };
}

// ────────────────────────────────────────────────────────────────────────────
// diff

/** 단일 path의 unified diff. staged=true면 인덱스, 아니면 워킹트리 vs 인덱스. */
export async function getDiff(
  cwd: string,
  path: string,
  staged: boolean,
): Promise<string> {
  if (!(await isGitRepo(cwd))) throw new NotAGitRepoError();
  const args = ["diff", "--no-color"];
  if (staged) args.push("--cached");
  args.push("--", path);
  return await git(cwd, args);
}

/** untracked 파일은 git diff가 못 보므로 /dev/null과 비교한 합성 diff. */
export async function getUntrackedDiff(
  cwd: string,
  path: string,
): Promise<string> {
  if (!(await isGitRepo(cwd))) throw new NotAGitRepoError();
  return await git(cwd, [
    "diff",
    "--no-color",
    "--no-index",
    "--",
    "/dev/null",
    path,
  ]).catch((err) => {
    // git diff --no-index는 차이가 있을 때 exit 1을 내는데 그건 정상.
    if (err instanceof GitCommandError && err.stderr === "") {
      return "";
    }
    throw err;
  });
}

// ────────────────────────────────────────────────────────────────────────────
// stage / unstage / commit

export async function stage(cwd: string, paths: string[]): Promise<void> {
  if (!(await isGitRepo(cwd))) throw new NotAGitRepoError();
  if (paths.length === 0) return;
  await git(cwd, ["add", "--", ...paths]);
}

export async function unstage(cwd: string, paths: string[]): Promise<void> {
  if (!(await isGitRepo(cwd))) throw new NotAGitRepoError();
  if (paths.length === 0) return;
  await git(cwd, ["reset", "HEAD", "--", ...paths]);
}

export async function commit(
  cwd: string,
  message: string,
): Promise<{ sha: string }> {
  if (!(await isGitRepo(cwd))) throw new NotAGitRepoError();
  if (!message.trim()) throw new Error("empty_commit_message");
  await git(cwd, ["commit", "-m", message]);
  const sha = (await git(cwd, ["rev-parse", "HEAD"])).trim();
  return { sha };
}

// ────────────────────────────────────────────────────────────────────────────
// log + branches (graph 용)

export interface LogEntry {
  sha: string;
  /** 짧은 sha (그래프 표기용). */
  shortSha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  /** ISO 문자열. */
  authoredAt: string;
  subject: string;
  /** 이 커밋을 가리키는 ref(들). 보통 branch/tag. HEAD는 별도 표기. */
  refs: string[];
}

const LOG_FORMAT =
  "%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%D%x1f%s";

export async function getLog(
  cwd: string,
  opts: { limit?: number; allBranches?: boolean } = {},
): Promise<LogEntry[]> {
  if (!(await isGitRepo(cwd))) throw new NotAGitRepoError();
  const args = ["log", `--max-count=${opts.limit ?? 100}`, `--pretty=format:${LOG_FORMAT}`];
  if (opts.allBranches) args.push("--all");
  args.push("--date-order");
  let out: string;
  try {
    out = await git(cwd, args);
  } catch (err) {
    // 빈 저장소 (HEAD 없음) — log는 실패하지만 정상 케이스.
    if (err instanceof GitCommandError) return [];
    throw err;
  }
  const entries: LogEntry[] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    const parts = line.split("\x1f");
    if (parts.length < 8) continue;
    const [sha, shortSha, parentsRaw, an, ae, ai, refsRaw, subject] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const parents = parentsRaw.trim() ? parentsRaw.trim().split(" ") : [];
    const refs = refsRaw
      ? refsRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    entries.push({
      sha,
      shortSha,
      parents,
      authorName: an,
      authorEmail: ae,
      authoredAt: ai,
      subject,
      refs,
    });
  }
  return entries;
}

export interface BranchInfo {
  name: string;
  current: boolean;
  /** 추적하는 upstream의 짧은 이름, 예: origin/main. */
  upstream: string | null;
  head: string;
}

export async function listBranches(cwd: string): Promise<BranchInfo[]> {
  if (!(await isGitRepo(cwd))) throw new NotAGitRepoError();
  const out = await git(cwd, [
    "for-each-ref",
    "--format=%(refname:short)%x1f%(HEAD)%x1f%(upstream:short)%x1f%(objectname:short)",
    "refs/heads",
  ]);
  const entries: BranchInfo[] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [name, head, upstream, sha] = line.split("\x1f");
    entries.push({
      name: name ?? "",
      current: head === "*",
      upstream: upstream ? upstream : null,
      head: sha ?? "",
    });
  }
  return entries;
}

export async function checkout(cwd: string, branch: string): Promise<void> {
  if (!(await isGitRepo(cwd))) throw new NotAGitRepoError();
  await git(cwd, ["checkout", branch]);
}
