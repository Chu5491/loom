import { execFile as execFileCb } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

/**
 * Per-thread git worktree management.
 *
 * Worktrees let two threads work on conflicting files at the same time
 * without clobbering each other — each thread gets its own checkout
 * sharing the same `.git` storage. The cost is one extra working tree
 * on disk per isolated thread (cheap; git stores objects centrally).
 *
 * Worktrees live under `~/.loom/worktrees/<thread-id>` so they're
 * (a) outside the project tree (won't show up in the project's own
 * file listing), (b) one path per thread (predictable), and (c) easy
 * to bulk-purge when the user wants to clear out old isolation.
 *
 * All entry points are best-effort: if the project isn't a git repo,
 * if `git worktree` fails, if the path is gone — we report failure
 * via the return shape rather than throwing. The caller decides
 * whether to fall back to the shared project path.
 */

function worktreesRoot(): string {
  return join(homedir(), ".loom", "worktrees");
}

function worktreePathFor(threadId: string): string {
  return join(worktreesRoot(), threadId);
}

async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await execFile("git", ["rev-parse", "--git-dir"], { cwd });
    return true;
  } catch {
    return false;
  }
}

async function currentBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFile(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd },
    );
    const name = stdout.trim();
    return name === "HEAD" ? null : name; // detached HEAD
  } catch {
    return null;
  }
}

export type CreateWorktreeResult =
  | { ok: true; path: string }
  | { ok: false; reason: string };

/**
 * Create an isolated worktree for a thread off the project's current
 * branch. The new worktree gets a branch named `loom/thread-<id>`
 * (created from HEAD) so the user can `git diff` against the
 * project's branch later.
 *
 * Idempotent on path collision — if the directory already exists
 * we return its path rather than failing, so retries are safe.
 */
export async function createWorktreeForThread(
  threadId: string,
  projectPath: string,
): Promise<CreateWorktreeResult> {
  if (!(await isGitRepo(projectPath))) {
    return { ok: false, reason: "project_not_git" };
  }
  const path = worktreePathFor(threadId);
  await mkdir(dirname(path), { recursive: true });

  // If a previous worktree at this path is still registered with git,
  // skip creation and return the path. Detect via `git worktree list`.
  try {
    const { stdout } = await execFile("git", ["worktree", "list", "--porcelain"], {
      cwd: projectPath,
    });
    if (stdout.includes(`worktree ${path}\n`)) {
      return { ok: true, path };
    }
  } catch {
    // ignore; fresh-create attempt below will surface real errors
  }

  const branch = `loom/thread-${threadId.slice(0, 8)}`;
  const baseBranch = (await currentBranch(projectPath)) ?? "HEAD";
  try {
    // -b creates the branch if it doesn't exist; if it does exist we
    // try again without -b to attach the existing branch to the new
    // worktree (rare race / re-create scenario).
    try {
      await execFile(
        "git",
        ["worktree", "add", "-b", branch, path, baseBranch],
        { cwd: projectPath },
      );
    } catch (err) {
      const msg = (err as Error).message || "";
      if (msg.includes("already exists")) {
        await execFile("git", ["worktree", "add", path, branch], {
          cwd: projectPath,
        });
      } else {
        throw err;
      }
    }
    return { ok: true, path };
  } catch (err) {
    // Best-effort cleanup of the directory git may have partly
    // created — leaving it lying around would block a retry.
    await rm(path, { recursive: true, force: true }).catch(() => undefined);
    return {
      ok: false,
      reason: (err as Error).message || "git_worktree_failed",
    };
  }
}

/**
 * Remove a thread's worktree. Best-effort: tells git to drop its
 * record (`git worktree remove --force`), then nukes the directory
 * if anything remains. Safe to call when the path is already gone.
 */
export async function removeWorktreeForThread(
  threadId: string,
  projectPath: string,
): Promise<void> {
  const path = worktreePathFor(threadId);
  if (await isGitRepo(projectPath)) {
    try {
      await execFile("git", ["worktree", "remove", "--force", path], {
        cwd: projectPath,
      });
    } catch {
      // Worktree may already be gone or unregistered. Fall through to
      // the rm below; if even that fails we silently move on.
    }
  }
  await rm(path, { recursive: true, force: true }).catch(() => undefined);
}
