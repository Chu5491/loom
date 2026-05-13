// 프로젝트 cwd에 대한 git 상태/diff/스테이지/커밋/로그 헬퍼.
// `git` CLI를 execFile로 호출하는 얇은 래퍼 — 의존성 추가 없이 동작.
// 모든 entry-point는 git 저장소가 아니거나 실패 시 명시적 에러를 던짐 — 라우트가
// 매핑해서 4xx/5xx 응답.

import { execFile as execFileCb, spawn } from "node:child_process";
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

/**
 * Stage all changes + commit in one shot. Returns null when the working
 * tree is clean (nothing to commit). Used by run-service to auto-commit
 * after a run finishes in a thread worktree.
 */
export async function autoCommitAll(
  cwd: string,
  message: string,
): Promise<{ sha: string } | null> {
  if (!(await isGitRepo(cwd))) return null;
  // git add -A 로 untracked / modified / deleted 전부.
  await git(cwd, ["add", "-A"]);
  // 커밋할 게 있는지 먼저 확인 — 빈 커밋 방지.
  const status = await git(cwd, ["status", "--porcelain"]);
  if (!status.trim()) return null;
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
  /** 추적하는 upstream의 짧은 이름, 예: origin/main. local 만 의미. */
  upstream: string | null;
  head: string;
  /** local: refs/heads, remote: refs/remotes. UI 가 그룹핑할 때 사용. */
  kind: "local" | "remote";
}

export async function listBranches(cwd: string): Promise<BranchInfo[]> {
  if (!(await isGitRepo(cwd))) throw new NotAGitRepoError();
  // local + remote 둘 다 한 번에 — refs/heads 와 refs/remotes 를 같이 훑음.
  // remote-tracking 의 origin/HEAD 는 alias 라 필터링.
  // for-each-ref 의 hex escape 는 `%xx` (e.g. `%1f`) 형태 — `git log` /
  // `git show` 의 `%xNN` 과 *다름*. `%x1f` 라고 쓰면 실제 0x1f 바이트가 아니라
  // 리터럴 문자열 "%x1f" 가 박혀나옴. 이전 코드가 그래서 빈 배열을 반환했음.
  const out = await git(cwd, [
    "for-each-ref",
    "--format=%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(objectname:short)%1f%(refname)",
    "refs/heads",
    "refs/remotes",
  ]);
  const entries: BranchInfo[] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [name, head, upstream, sha, fullRef] = line.split("\x1f");
    if (!name || !fullRef) continue;
    // origin/HEAD 같은 symref alias 는 스킵 — 실제 브랜치 entry 가 따로 있음.
    if (fullRef.endsWith("/HEAD")) continue;
    const kind: "local" | "remote" = fullRef.startsWith("refs/remotes/")
      ? "remote"
      : "local";
    entries.push({
      name,
      current: head === "*",
      upstream: upstream ? upstream : null,
      head: sha ?? "",
      kind,
    });
  }
  return entries;
}

export async function checkout(cwd: string, branch: string): Promise<void> {
  if (!(await isGitRepo(cwd))) throw new NotAGitRepoError();
  await git(cwd, ["checkout", branch]);
}

export async function createBranch(
  cwd: string,
  name: string,
  opts: { startPoint?: string; checkout?: boolean } = {},
): Promise<void> {
  if (!(await isGitRepo(cwd))) throw new NotAGitRepoError();
  const args = opts.checkout ? ["checkout", "-b", name] : ["branch", name];
  if (opts.startPoint) args.push(opts.startPoint);
  await git(cwd, args);
}

export async function deleteBranch(
  cwd: string,
  name: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  if (!(await isGitRepo(cwd))) throw new NotAGitRepoError();
  // -d 는 머지 안 된 브랜치 거부, -D 는 강제. 사용자가 force 명시했을 때만.
  await git(cwd, ["branch", opts.force ? "-D" : "-d", name]);
}

export async function renameBranch(
  cwd: string,
  oldName: string,
  newName: string,
): Promise<void> {
  if (!(await isGitRepo(cwd))) throw new NotAGitRepoError();
  await git(cwd, ["branch", "-m", oldName, newName]);
}

// ────────────────────────────────────────────────────────────────────────────
// stash

export interface StashEntry {
  /** stash@{N} 의 N. */
  index: number;
  /** "WIP on main: ..." 같은 git 의 자체 메시지 (사용자 메시지가 들어 있는 그 본문). */
  message: string;
  /** 스태시할 때 있던 브랜치. parse 실패하면 null. */
  branch: string | null;
  /** ISO. */
  createdAt: string;
}

export async function listStash(cwd: string): Promise<StashEntry[]> {
  if (!(await isGitRepo(cwd))) throw new NotAGitRepoError();
  // %gd = stash@{N}, %gs = subject, %ai = author date.
  const out = await git(cwd, [
    "stash",
    "list",
    "--format=%gd%x1f%gs%x1f%ai",
  ]);
  const entries: StashEntry[] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [refRaw, subject, ai] = line.split("\x1f");
    const m = /stash@\{(\d+)\}/.exec(refRaw ?? "");
    if (!m) continue;
    const index = Number(m[1]);
    if (!Number.isFinite(index)) continue;
    const branch = parseStashBranch(subject ?? "");
    entries.push({
      index,
      message: subject ?? "",
      branch,
      createdAt: ai ?? "",
    });
  }
  return entries;
}

/** "WIP on main: 1234567 …" / "On main: …" 패턴에서 브랜치만 뽑음. */
function parseStashBranch(subject: string): string | null {
  const m = /^(?:WIP on|On)\s+([^:]+):/i.exec(subject);
  return m ? m[1]!.trim() : null;
}

export async function saveStash(
  cwd: string,
  opts: { message?: string; includeUntracked?: boolean } = {},
): Promise<void> {
  if (!(await isGitRepo(cwd))) throw new NotAGitRepoError();
  const args = ["stash", "push"];
  if (opts.includeUntracked) args.push("--include-untracked");
  if (opts.message?.trim()) {
    args.push("--message", opts.message.trim());
  }
  await git(cwd, args);
}

export async function popStash(cwd: string, index: number): Promise<void> {
  if (!(await isGitRepo(cwd))) throw new NotAGitRepoError();
  await git(cwd, ["stash", "pop", `stash@{${index}}`]);
}

export async function applyStash(cwd: string, index: number): Promise<void> {
  if (!(await isGitRepo(cwd))) throw new NotAGitRepoError();
  await git(cwd, ["stash", "apply", `stash@{${index}}`]);
}

export async function dropStash(cwd: string, index: number): Promise<void> {
  if (!(await isGitRepo(cwd))) throw new NotAGitRepoError();
  await git(cwd, ["stash", "drop", `stash@{${index}}`]);
}

// ────────────────────────────────────────────────────────────────────────────
// hunk-level staging — partial patch apply
//
// 클라가 다이프 텍스트를 hunk 단위로 잘라 우리에게 보내면, 우리는 git apply 에
// stdin 으로 그대로 흘려넣는다. 파서는 클라가 가짐 — 어차피 클라가 diff 를
// 표시하고 있어서 같은 데이터로 만든 patch 가 가장 정확.

export interface ApplyPatchResult {
  ok: true;
}

export async function applyPatch(
  cwd: string,
  patch: string,
  opts: { cached?: boolean; reverse?: boolean } = {},
): Promise<ApplyPatchResult> {
  if (!(await isGitRepo(cwd))) throw new NotAGitRepoError();
  const args = ["apply"];
  if (opts.cached) args.push("--cached");
  if (opts.reverse) args.push("-R");
  // unidiff zero-context hunks 도 통과시킴.
  args.push("--unidiff-zero", "-");
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("git", args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    proc.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code: number | null) => {
      if (code === 0) resolve();
      else
        reject(
          new GitCommandError(
            `git apply exited ${code ?? "?"}`.trim(),
            stderr,
          ),
        );
    });
    proc.stdin?.end(patch);
  });
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// PR — wraps `gh pr create`. gh 자체의 auth / scope 를 그대로 신뢰.

export interface PrProbe {
  installed: boolean;
  /** `gh --version` 의 첫 줄 — UI 에 짧게 표시하려고. installed=false 면 빈 문자열. */
  version: string;
}

export async function probeGh(): Promise<PrProbe> {
  try {
    const { stdout } = await execFile("gh", ["--version"], {});
    const version = stdout.split("\n")[0]?.trim() ?? "";
    return { installed: true, version };
  } catch {
    return { installed: false, version: "" };
  }
}

export class GhNotInstalledError extends Error {
  constructor() {
    super("gh_not_installed");
    this.name = "GhNotInstalledError";
  }
}

export interface CreatePrInput {
  title: string;
  body: string;
  base?: string;
  draft?: boolean;
}

export interface CreatePrResult {
  /** gh 가 출력하는 PR URL. */
  url: string;
  /** 추가로 보여줄 출력 — gh 가 가끔 경고 등을 같이 출력. */
  output: string;
}

export async function createPullRequest(
  cwd: string,
  input: CreatePrInput,
): Promise<CreatePrResult> {
  if (!(await isGitRepo(cwd))) throw new NotAGitRepoError();
  const args = ["pr", "create", "--title", input.title, "--body", input.body];
  if (input.base) args.push("--base", input.base);
  if (input.draft) args.push("--draft");
  try {
    const { stdout, stderr } = await execFile("gh", args, {
      cwd,
      maxBuffer: 4 * 1024 * 1024,
    });
    const out = `${stderr ?? ""}${stdout ?? ""}`.trim();
    // gh 의 PR create 는 URL 을 stdout 마지막 줄에 출력. fallback 으로 본문에서 첫 https URL.
    const lastLine = stdout.split("\n").filter(Boolean).pop() ?? "";
    const urlMatch = /(https?:\/\/[^\s]+)/.exec(lastLine);
    const url = urlMatch
      ? urlMatch[1]!
      : (/(https?:\/\/[^\s]+)/.exec(out)?.[1] ?? "");
    return { url, output: out };
  } catch (err) {
    const e = err as { code?: string; stderr?: string; message?: string };
    if (e.code === "ENOENT") throw new GhNotInstalledError();
    throw new GitCommandError(
      e.message ?? "gh failed",
      (e.stderr ?? "").toString(),
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// commit detail (show)

export interface CommitInfo {
  sha: string;
  shortSha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  subject: string;
  /** subject 다음 줄들 — body 가 없으면 ""다. */
  body: string;
  /** 이 커밋이 건드린 파일들 (M / A / D / R / C 코드 + path). */
  files: WorkingChange[];
}

export async function getCommitInfo(
  cwd: string,
  sha: string,
): Promise<CommitInfo> {
  if (!(await isGitRepo(cwd))) throw new NotAGitRepoError();
  // Header (hash, parents, author, subject+body) + body sentinel + name-status.
  // -z 로 NUL 구분이 가장 안전. %x00 = NUL, %B 는 subject + body.
  const SEP = "\x1f";
  // `--no-patch` 와 `--name-status` 는 같이 못 씀 — `--name-status` 만으로
  // 이미 patch 없이 이름+상태만. (git 2.45+ 에서 명시적 에러.)
  const out = await git(cwd, [
    "show",
    "--name-status",
    "-z",
    `--format=%H${SEP}%h${SEP}%P${SEP}%an${SEP}%ae${SEP}%aI${SEP}%s${SEP}%b%x00`,
    sha,
  ]);
  // 헤더 + body 까지 첫 NUL 까지 스캔, 그 후가 name-status (NUL 구분).
  const nullIdx = out.indexOf("\x00");
  if (nullIdx < 0) {
    throw new GitCommandError("unexpected git show output", out.slice(0, 200));
  }
  const header = out.slice(0, nullIdx);
  const tail = out.slice(nullIdx + 1);
  const parts = header.split(SEP);
  const [
    fullSha,
    shortSha,
    parentsRaw,
    authorName,
    authorEmail,
    authoredAt,
    subject,
    body,
  ] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const parents = parentsRaw ? parentsRaw.split(" ").filter(Boolean) : [];

  // git show 는 헤더 다음에 빈 줄(`\n`) 을 끼운 뒤 name-status 를 출력.
  // -z 모드에선 entry 들이 NUL 로 끝나지만, 헤더-바디 사이의 `\n` 은 여전히
  // 살아있어 첫 token 의 status 코드 앞에 붙음. trimStart 로 잘라줌.
  const tokens = tail
    .split("\x00")
    .map((t) => t.replace(/^\s+/, ""))
    .filter((t) => t.length > 0);
  const files: WorkingChange[] = [];
  let i = 0;
  while (i < tokens.length) {
    const code = tokens[i++]!;
    const status = code[0]!; // R100 → 'R'
    if (status === "R" || status === "C") {
      const fromPath = tokens[i++];
      const toPath = tokens[i++];
      if (toPath) files.push({ path: toPath, fromPath, status });
    } else {
      const p = tokens[i++];
      if (p) files.push({ path: p, status });
    }
  }

  return {
    sha: fullSha ?? sha,
    shortSha: shortSha ?? "",
    parents,
    authorName: authorName ?? "",
    authorEmail: authorEmail ?? "",
    authoredAt: authoredAt ?? "",
    subject: subject ?? "",
    body: body ?? "",
    files,
  };
}

/** 단일 커밋이 한 파일에 가한 변경의 unified diff. parent 가 없는 root 커밋은
 *  empty-tree 와 비교. merge 커밋(parent 2+) 은 first-parent 와 비교 — 충분치
 *  않으면 추후 m 옵션 노출. */
export async function getCommitFileDiff(
  cwd: string,
  sha: string,
  path: string,
): Promise<string> {
  if (!(await isGitRepo(cwd))) throw new NotAGitRepoError();
  const out = await git(
    cwd,
    ["show", "--format=", "--first-parent", sha, "--", path],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// remote — fetch / pull / push
//
// 인증은 사용자의 git credential helper / ssh-agent 에 위임. loom 은 자격증명을
// 만지지 않음 — credential 프롬프트가 떠야 하는 상황(HTTPS without helper)이면
// non-interactive 환경에선 실패. UI 가 stderr 를 보여주면 사용자가 터미널에서
// 처리할 수 있게.

export interface RemoteResult {
  /** stdout + stderr 합본 — git 의 진행 출력은 stderr 로 나감. */
  output: string;
}

export async function fetch(
  cwd: string,
  opts: { remote?: string; prune?: boolean } = {},
): Promise<RemoteResult> {
  if (!(await isGitRepo(cwd))) throw new NotAGitRepoError();
  const args = ["fetch"];
  if (opts.prune ?? true) args.push("--prune");
  // 기본은 --all — 사용자가 특정 remote 만 원하면 명시. 단일 origin 환경에선
  // --all 이 그대로 origin 가져옴.
  if (opts.remote) args.push(opts.remote);
  else args.push("--all");
  return runRemote(cwd, args);
}

export async function pull(
  cwd: string,
  opts: { remote?: string; branch?: string; rebase?: boolean } = {},
): Promise<RemoteResult> {
  if (!(await isGitRepo(cwd))) throw new NotAGitRepoError();
  const args = ["pull"];
  if (opts.rebase) args.push("--rebase");
  if (opts.remote) args.push(opts.remote);
  if (opts.branch) args.push(opts.branch);
  return runRemote(cwd, args);
}

export async function push(
  cwd: string,
  opts: { remote?: string; branch?: string; setUpstream?: boolean; force?: boolean } = {},
): Promise<RemoteResult> {
  if (!(await isGitRepo(cwd))) throw new NotAGitRepoError();
  const args = ["push"];
  // setUpstream 이 명시 true 거나, 현재 브랜치가 upstream 없을 때 자동으로 -u.
  if (opts.setUpstream) args.push("-u");
  // force-with-lease — 사용자 의도가 force 면 lease 가 그래도 안전망.
  // 단순 force 는 다른 사람의 푸시를 덮어쓸 수 있어서 lease 만 노출.
  if (opts.force) args.push("--force-with-lease");
  if (opts.remote) args.push(opts.remote);
  if (opts.branch) args.push(opts.branch);
  return runRemote(cwd, args);
}

/** fetch/pull/push 공통 실행 — stderr 도 같이 캡처해서 진행 메시지를 살림.
 *  실패 시 GitCommandError 그대로 던져 라우트가 4xx 매핑. */
async function runRemote(cwd: string, args: string[]): Promise<RemoteResult> {
  try {
    const { stdout, stderr } = await execFile("git", args, {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { output: [stderr, stdout].filter(Boolean).join("").trim() };
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
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
