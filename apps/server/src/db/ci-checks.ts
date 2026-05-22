import { randomUUID } from "node:crypto";
import type { CiCheck, CiCheckStatus, CiOverall, CiProvider } from "@loom/core";
import { getDb } from "./client.js";

interface CiCheckRow {
  id: string;
  thread_id: string;
  provider: string;
  name: string;
  status: string;
  detail_url: string | null;
  sha: string | null;
  created_at: string;
  updated_at: string;
}

function rowToCheck(row: CiCheckRow): CiCheck {
  return {
    id: row.id,
    threadId: row.thread_id,
    provider: row.provider as CiProvider,
    name: row.name,
    status: row.status as CiCheckStatus,
    detailUrl: row.detail_url,
    sha: row.sha,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface UpsertCiCheckInput {
  threadId: string;
  name: string;
  status: CiCheckStatus;
  provider?: CiProvider;
  detailUrl?: string | null;
  sha?: string | null;
}

export function upsertCiCheck(input: UpsertCiCheckInput): CiCheck {
  const now = new Date().toISOString();
  const id = randomUUID();
  getDb()
    .prepare<[string, string, string, string, string, string | null, string | null, string, string]>(
      `INSERT INTO ci_checks (id, thread_id, provider, name, status, detail_url, sha, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (thread_id, name) DO UPDATE SET
         status = excluded.status,
         detail_url = excluded.detail_url,
         sha = excluded.sha,
         provider = excluded.provider,
         updated_at = excluded.updated_at`,
    )
    .run(
      id,
      input.threadId,
      input.provider ?? "custom",
      input.name,
      input.status,
      input.detailUrl ?? null,
      input.sha ?? null,
      now,
      now,
    );
  const row = getDb()
    .prepare<[string, string], CiCheckRow>(
      "SELECT * FROM ci_checks WHERE thread_id = ? AND name = ?",
    )
    .get(input.threadId, input.name);
  return rowToCheck(row!);
}

export function listCiChecks(threadId: string): CiCheck[] {
  const rows = getDb()
    .prepare<[string], CiCheckRow>(
      "SELECT * FROM ci_checks WHERE thread_id = ? ORDER BY updated_at DESC",
    )
    .all(threadId);
  return rows.map(rowToCheck);
}

export function computeOverall(checks: CiCheck[]): CiOverall {
  if (checks.length === 0) return "none";
  if (checks.some((c) => c.status === "failure" || c.status === "error")) return "failure";
  if (checks.some((c) => c.status === "pending" || c.status === "running")) return "pending";
  return "success";
}

export function deleteCiCheck(id: string): boolean {
  return getDb().prepare("DELETE FROM ci_checks WHERE id = ?").run(id).changes > 0;
}
