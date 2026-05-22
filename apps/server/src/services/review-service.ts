import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { Review } from "@loom/core";
import { getAgent } from "../db/agents.js";
import { createReview, setReviewRunId } from "../db/reviews.js";
import { listRuns } from "../db/runs.js";
import { getThread } from "../db/threads.js";
import { getProject } from "../db/projects.js";
import { startRun } from "./run-service.js";

const execFile = promisify(execFileCb);

export type RequestReviewResult =
  | { ok: true; review: Review }
  | { ok: false; status: 400 | 404; error: string };

export async function requestReview(input: {
  threadId: string;
  reviewerAgentId: string;
}): Promise<RequestReviewResult> {
  const thread = getThread(input.threadId);
  if (!thread) return { ok: false, status: 404, error: "thread_not_found" };

  const reviewer = getAgent(input.reviewerAgentId);
  if (!reviewer) return { ok: false, status: 404, error: "reviewer_not_found" };

  const project = getProject(thread.projectId);
  if (!project) return { ok: false, status: 404, error: "project_not_found" };

  const cwd = thread.worktreePath ?? project.path;
  const diff = await computeThreadDiff(input.threadId, cwd);
  if (!diff) {
    return { ok: false, status: 400, error: "no_changes_to_review" };
  }

  const review = createReview({
    threadId: input.threadId,
    reviewerAgentId: input.reviewerAgentId,
  });

  const prompt = formatReviewPrompt(thread.name, diff);
  const result = await startRun({
    agentId: input.reviewerAgentId,
    prompt,
    threadId: input.threadId,
    cwd,
  });

  if (!result.ok) {
    return { ok: false, status: result.status as 400, error: result.error };
  }

  setReviewRunId(review.id, result.run.id);
  return { ok: true, review: { ...review, runId: result.run.id, status: "reviewing" } };
}

async function computeThreadDiff(
  threadId: string,
  cwd: string,
): Promise<string | null> {
  const runs = listRuns({ threadId, limit: 200 });
  if (runs.length === 0) return null;

  const sorted = [...runs].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  const beforeRef = sorted.find((r) => r.beforeRef)?.beforeRef ?? null;
  const afterRef = [...sorted].reverse().find((r) => r.afterRef)?.afterRef ?? null;

  if (!beforeRef || !afterRef || beforeRef === afterRef) return null;

  try {
    const { stdout: stat } = await execFile(
      "git",
      ["diff", "-M", "--stat", `${beforeRef}..${afterRef}`],
      { cwd, maxBuffer: 512 * 1024 },
    );
    const { stdout: patch } = await execFile(
      "git",
      ["diff", "-M", "-U3", `${beforeRef}..${afterRef}`],
      { cwd, maxBuffer: 2 * 1024 * 1024 },
    );
    const trimmed = patch.length > 100_000
      ? patch.slice(0, 100_000) + "\n\n… (diff truncated at 100k chars)"
      : patch;
    return `${stat}\n${trimmed}`;
  } catch {
    return null;
  }
}

function formatReviewPrompt(threadName: string, diff: string): string {
  return `Review the changes in thread "${threadName}":\n\n\`\`\`diff\n${diff}\n\`\`\``;
}
