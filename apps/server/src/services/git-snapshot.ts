import { execFile as execFileCb } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

/**
 * Lightweight git working-tree snapshots used to compute "what files did
 * this run change?" without disturbing the user's index, working tree, or
 * stash list.
 *
 * The trick: a temporary GIT_INDEX_FILE lets us stage everything (incl.
 * untracked files) into a throwaway index, write a tree object, then a
 * dangling commit. Two such commits — one before the run and one after —
 * are diffable via plain `git diff <a>..<b>` and stay invisible to the
 * user. They get garbage-collected by git on its own schedule.
 *
 * If the cwd is not a git repository, every entry-point returns null.
 * Callers should treat that as "diff tracking disabled for this run."
 */

async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await execFile("git", ["rev-parse", "--git-dir"], { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * Snapshot the current working tree (tracked + untracked, .gitignore-aware)
 * into a dangling commit and return its SHA. Returns null when `cwd` is
 * not under git.
 */
export async function snapshotWorkTree(cwd: string): Promise<string | null> {
  if (!(await isGitRepo(cwd))) return null;
  const tmpIndex = join(tmpdir(), `loom-snap-${randomUUID()}`);
  const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
  try {
    // Seed the temp index from HEAD so deletions show up correctly. If
    // the repo has no commits yet (empty repo), HEAD is missing — fall
    // back to an empty index, which still works for `add -A`.
    try {
      await execFile("git", ["read-tree", "HEAD"], { cwd, env });
    } catch {
      // empty repo or missing HEAD — leave the temp index empty
    }
    await execFile("git", ["add", "-A"], { cwd, env });
    const { stdout: tree } = await execFile("git", ["write-tree"], {
      cwd,
      env,
    });
    const treeSha = tree.trim();
    const { stdout: commit } = await execFile(
      "git",
      ["commit-tree", treeSha, "-m", "loom-snapshot"],
      { cwd, env },
    );
    return commit.trim();
  } catch {
    return null;
  } finally {
    // Best-effort cleanup. The file may not exist if `git add` failed
    // before any write — that's fine, ignore.
    try {
      fs.unlinkSync(tmpIndex);
    } catch {
      // file may not exist if git add failed before any write
    }
  }
}

export interface ChangeEntry {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  /** Renamed: the previous path. */
  fromPath?: string;
  additions: number;
  deletions: number;
}

/**
 * Per-file change summary between two snapshot SHAs (or any two commit-ish
 * refs). Empty array when refs are equal or either side is missing.
 */
export async function diffStat(
  beforeRef: string | null,
  afterRef: string | null,
  cwd: string,
): Promise<ChangeEntry[]> {
  if (!beforeRef || !afterRef || beforeRef === afterRef) return [];
  try {
    // -z + --name-status gives NUL-separated, rename-aware records.
    // --numstat (run separately, also -z) gives addition/deletion counts.
    const { stdout: nameStatus } = await execFile(
      "git",
      ["diff", "--name-status", "-z", "-M", `${beforeRef}..${afterRef}`],
      { cwd },
    );
    const { stdout: numStat } = await execFile(
      "git",
      ["diff", "--numstat", "-z", "-M", `${beforeRef}..${afterRef}`],
      { cwd },
    );

    const stats = new Map<string, { additions: number; deletions: number }>();
    // numstat -z record:  "<add>\t<del>\t<path>\0"  (renames split path into
    //  three tokens — keeping it simple, we key by the destination path)
    const numTokens = numStat.split("\0").filter(Boolean);
    for (const rec of numTokens) {
      const [add, del, ...rest] = rec.split("\t");
      const path = rest.join("\t");
      const a = add === "-" ? 0 : Number(add);
      const d = del === "-" ? 0 : Number(del);
      if (path) stats.set(path, { additions: a, deletions: d });
    }

    const out: ChangeEntry[] = [];
    const tokens = nameStatus.split("\0").filter((s) => s.length > 0);
    for (let i = 0; i < tokens.length; i++) {
      const code = tokens[i]!;
      if (code.startsWith("R")) {
        const from = tokens[++i] ?? "";
        const to = tokens[++i] ?? "";
        const s = stats.get(to) ?? { additions: 0, deletions: 0 };
        out.push({ path: to, fromPath: from, status: "renamed", ...s });
      } else {
        const path = tokens[++i] ?? "";
        const status =
          code === "A" ? "added" : code === "D" ? "deleted" : "modified";
        const s = stats.get(path) ?? { additions: 0, deletions: 0 };
        out.push({ path, status, ...s });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * 워킹 트리를 어떤 snapshot SHA(=run.beforeRef) 의 상태로 되돌림.
 *
 * 안전망:
 *   1. 되돌리기 전 *현재* 상태를 새 snapshot 으로 떠 둠 — 원하면 다시 되돌릴
 *      수 있게. 그 SHA 를 `safetyRef` 로 반환.
 *   2. tracked 파일은 `git read-tree --reset -u` 로 index + worktree 를 같이.
 *   3. ref 시점에 없었지만 지금 worktree 에 있는 untracked 파일은 `git clean`
 *      으로 제거 — 단, .gitignore 항목은 유지(`-d -f`, `-x` 안 붙임).
 *
 * 호출자는 이 함수가 실패해도 데이터를 잃지 않게 — 실패면 throw 하고 worktree
 * 는 호출 전 상태에 가까이 남음.
 */
export interface RestoreResult {
  safetyRef: string | null;
}

export async function restoreWorkTree(
  cwd: string,
  ref: string,
): Promise<RestoreResult> {
  if (!(await isGitRepo(cwd))) {
    throw new Error("not_a_git_repo");
  }
  // 현재 상태 안전 snapshot 먼저. 실패해도 진행 — 안전망이 없는 거지 막아야
  // 할 이유는 아님.
  const safetyRef = await snapshotWorkTree(cwd);

  // ref 가 valid commit 인지 확인 — invalid 면 read-tree 가 깨진 뒤에 알게
  // 되는 것보단 일찍 throw.
  await execFile("git", ["rev-parse", "--verify", `${ref}^{commit}`], { cwd });

  // index + worktree 동시 reset. tracked 파일은 ref 의 내용으로.
  await execFile("git", ["read-tree", "--reset", "-u", ref], { cwd });

  // ref 에 없던 untracked 파일은 cleanup. -d 디렉터리까지, -f 강제. -x 는
  // 안 붙임 — gitignore 된 빌드 산출물은 유저 데이터일 수 있어 보존.
  await execFile("git", ["clean", "-d", "-f"], { cwd });

  return { safetyRef };
}

/**
 * Unified diff for a single path between two snapshots. Returns null when
 * git fails or refs are missing — UI should treat that as "diff
 * unavailable" rather than empty (an empty diff would mean "no changes").
 */
export async function diffPatch(
  beforeRef: string | null,
  afterRef: string | null,
  path: string,
  cwd: string,
): Promise<string | null> {
  if (!beforeRef || !afterRef) return null;
  try {
    const { stdout } = await execFile(
      "git",
      ["diff", "-M", `${beforeRef}..${afterRef}`, "--", path],
      { cwd, maxBuffer: 16 * 1024 * 1024 },
    );
    return stdout;
  } catch {
    return null;
  }
}

/**
 * 한 snapshot 에서 path 의 raw 파일 콘텐츠를 가져옴. side-by-side diff 가
 * 양쪽을 동시에 보여주려면 unified patch 가 아니라 두 *전체* 텍스트가 필요.
 * 그 ref 에 path 가 존재하지 않으면 빈 문자열 (added / deleted 케이스).
 */
async function showBlob(
  ref: string,
  path: string,
  cwd: string,
): Promise<string> {
  try {
    const { stdout } = await execFile("git", ["show", `${ref}:${path}`], {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch {
    // ref 에 그 path 가 없으면 (added 또는 deleted) "" 반환.
    return "";
  }
}

export interface DiffSides {
  before: string;
  after: string;
}

/**
 * before/after snapshot 에서 path 의 두 버전을 동시에 fetch. side-by-side
 * Monaco DiffEditor 가 그대로 소비.
 */
export async function readDiffSides(
  beforeRef: string | null,
  afterRef: string | null,
  path: string,
  cwd: string,
): Promise<DiffSides | null> {
  if (!beforeRef || !afterRef) return null;
  if (!(await isGitRepo(cwd))) return null;
  const [before, after] = await Promise.all([
    showBlob(beforeRef, path, cwd),
    showBlob(afterRef, path, cwd),
  ]);
  return { before, after };
}
