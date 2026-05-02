// 새 run의 thread 결정: explicit > parent 상속 > 새로 생성.
// thread는 항상 agent와 같은 project에 속해야 함.

import { threadNameFromPrompt } from "../../db/client.js";
import { getRun } from "../../db/runs.js";
import { createThread, getThread } from "../../db/threads.js";

export type ThreadResolution =
  | { kind: "ok"; id: string }
  | { kind: "error"; status: 400 | 404; error: string };

export function resolveThreadForRun(args: {
  explicitThreadId: string | null;
  parentRunId: string | null;
  prompt: string;
  projectId: string;
}): ThreadResolution {
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
    // parent에 thread 없음 (레거시) → 새로 생성으로 fallthrough
  }

  const fresh = createThread({
    projectId: args.projectId,
    name: threadNameFromPrompt(args.prompt),
  });
  return { kind: "ok", id: fresh.id };
}
