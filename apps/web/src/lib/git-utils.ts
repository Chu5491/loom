import type { Thread } from "@loom/core";

export function threadBranchName(thread: Thread): string | null {
  if (!thread.worktreePath) return null;
  return `loom/thread-${thread.id.slice(0, 8)}`;
}

export function shortenBranch(branch: string): string {
  if (branch.startsWith("loom/thread-")) {
    return branch.replace("loom/thread-", "t/");
  }
  return branch;
}

export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}
