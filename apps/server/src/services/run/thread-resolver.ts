// 새 run의 thread 결정: explicit > parent 상속 > 새로 생성.
// thread는 항상 agent와 같은 project에 속해야 함.
// git-first: 새 thread 생성 시 자동으로 worktree + branch 할당.

import { threadNameFromPrompt } from "../../db/client.js";
import { getProject } from "../../db/projects.js";
import { getRun } from "../../db/runs.js";
import {
  createThread,
  getThread,
  setThreadWorktreePath,
} from "../../db/threads.js";
import { createWorktreeForThread } from "../worktree.js";

export type ThreadResolution =
  | { kind: "ok"; id: string }
  | { kind: "error"; status: 400 | 404; error: string };

export async function resolveThreadForRun(args: {
  explicitThreadId: string | null;
  parentRunId: string | null;
  prompt: string;
  projectId: string;
}): Promise<ThreadResolution> {
  if (args.explicitThreadId) {
    const t = getThread(args.explicitThreadId);
    if (!t) return { kind: "error", status: 404, error: "thread_not_found" };
    if (t.projectId !== args.projectId) {
      return { kind: "error", status: 400, error: "thread_project_mismatch" };
    }
    return { kind: "ok", id: t.id };
  }

  if (args.parentRunId) {
    const parent = getRun(args.parentRunId);
    if (!parent) return { kind: "error", status: 404, error: "parent_run_not_found" };
    if (parent.threadId) return { kind: "ok", id: parent.threadId };
  }

  const fresh = createThread({
    projectId: args.projectId,
    name: threadNameFromPrompt(args.prompt),
  });

  // git-first: 자동 worktree 생성. 실패해도 thread 는 살아남음.
  const project = getProject(args.projectId);
  if (project) {
    const result = await createWorktreeForThread(fresh.id, project.path);
    if (result.ok) {
      setThreadWorktreePath(fresh.id, result.path);
    }
  }

  return { kind: "ok", id: fresh.id };
}
