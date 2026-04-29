import { execFile as execFileCb } from "node:child_process";
import { randomUUID } from "node:crypto";
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
      await execFile("rm", ["-f", tmpIndex]);
    } catch {
      // ignore
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
