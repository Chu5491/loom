import { randomUUID } from "node:crypto";
import type { Review, ReviewStatus } from "@loom/core";
import { getDb } from "./client.js";

interface ReviewRow {
  id: string;
  thread_id: string;
  reviewer_agent_id: string;
  run_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

function rowToReview(row: ReviewRow): Review {
  return {
    id: row.id,
    threadId: row.thread_id,
    reviewerAgentId: row.reviewer_agent_id,
    runId: row.run_id,
    status: row.status as ReviewStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createReview(input: {
  threadId: string;
  reviewerAgentId: string;
}): Review {
  const id = randomUUID();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO reviews (id, thread_id, reviewer_agent_id, run_id, status, created_at, updated_at)
       VALUES (?, ?, ?, NULL, 'pending', ?, ?)`,
    )
    .run(id, input.threadId, input.reviewerAgentId, now, now);
  return getReview(id)!;
}

export function getReview(id: string): Review | null {
  const row = getDb()
    .prepare<[string], ReviewRow>("SELECT * FROM reviews WHERE id = ?")
    .get(id);
  return row ? rowToReview(row) : null;
}

export function listReviewsByThread(threadId: string): Review[] {
  const rows = getDb()
    .prepare<[string], ReviewRow>(
      "SELECT * FROM reviews WHERE thread_id = ? ORDER BY created_at DESC",
    )
    .all(threadId);
  return rows.map(rowToReview);
}

export function setReviewRunId(id: string, runId: string): void {
  getDb()
    .prepare("UPDATE reviews SET run_id = ?, status = 'reviewing', updated_at = ? WHERE id = ?")
    .run(runId, new Date().toISOString(), id);
}

export function updateReviewStatus(id: string, status: ReviewStatus): void {
  getDb()
    .prepare("UPDATE reviews SET status = ?, updated_at = ? WHERE id = ?")
    .run(status, new Date().toISOString(), id);
}
