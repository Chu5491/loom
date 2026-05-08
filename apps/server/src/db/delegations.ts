// 멀티 에이전트 위임 (Task tool 호출) 의 시도/결과 추적.
//
// run.parent_run_id 가 thread-level 핸드오프 (사용자가 다른 에이전트에게 답변
// 넘기기) 용이라면, 이 테이블은 *run 내부* 의 위임 — claude/codex 등이
// Task tool 로 sub-agent 를 호출했을 때의 시도, 결과, 실패 추적.
//
// Phase 1: 스키마 + DB 헬퍼만. 어댑터 단의 자동 추출은 Phase 2 (각 CLI 의
// stream-json 포맷에서 Task 시도를 파싱하는 어댑터 코드).

import { getDb } from "./client.js";

export interface DelegationRow {
  id: number;
  parent_run_id: string;
  child_run_id: string | null;
  target_agent_id: string | null;
  target_agent_name: string | null;
  task_description: string;
  status: "pending" | "running" | "succeeded" | "failed";
  result_summary: string | null;
  initiated_at: string;
  completed_at: string | null;
}

export interface Delegation {
  id: number;
  parentRunId: string;
  childRunId: string | null;
  targetAgentId: string | null;
  targetAgentName: string | null;
  taskDescription: string;
  status: "pending" | "running" | "succeeded" | "failed";
  resultSummary: string | null;
  initiatedAt: string;
  completedAt: string | null;
}

function rowToDelegation(row: DelegationRow): Delegation {
  return {
    id: row.id,
    parentRunId: row.parent_run_id,
    childRunId: row.child_run_id,
    targetAgentId: row.target_agent_id,
    targetAgentName: row.target_agent_name,
    taskDescription: row.task_description,
    status: row.status,
    resultSummary: row.result_summary,
    initiatedAt: row.initiated_at,
    completedAt: row.completed_at,
  };
}

export function recordDelegation(input: {
  parentRunId: string;
  taskDescription: string;
  targetAgentId?: string | null;
  targetAgentName?: string | null;
}): number {
  const db = getDb();
  const stmt = db.prepare<
    [string, string | null, string | null, string, string]
  >(
    `INSERT INTO delegations
       (parent_run_id, target_agent_id, target_agent_name, task_description, initiated_at)
       VALUES (?, ?, ?, ?, ?)`,
  );
  const result = stmt.run(
    input.parentRunId,
    input.targetAgentId ?? null,
    input.targetAgentName ?? null,
    input.taskDescription,
    new Date().toISOString(),
  );
  return Number(result.lastInsertRowid);
}

export function completeDelegation(
  id: number,
  result: { status: "succeeded" | "failed"; summary?: string; childRunId?: string },
): void {
  getDb()
    .prepare<[string, string | null, string | null, string, number]>(
      `UPDATE delegations
       SET status = ?, result_summary = ?, child_run_id = ?, completed_at = ?
       WHERE id = ?`,
    )
    .run(
      result.status,
      result.summary ?? null,
      result.childRunId ?? null,
      new Date().toISOString(),
      id,
    );
}

export function listDelegationsForRun(parentRunId: string): Delegation[] {
  const rows = getDb()
    .prepare<[string], DelegationRow>(
      `SELECT * FROM delegations WHERE parent_run_id = ? ORDER BY initiated_at ASC`,
    )
    .all(parentRunId);
  return rows.map(rowToDelegation);
}

export function listDelegationsForRuns(
  parentRunIds: string[],
): Map<string, Delegation[]> {
  const m = new Map<string, Delegation[]>();
  if (parentRunIds.length === 0) return m;
  const placeholders = parentRunIds.map(() => "?").join(",");
  const rows = getDb()
    .prepare<string[], DelegationRow>(
      `SELECT * FROM delegations
       WHERE parent_run_id IN (${placeholders})
       ORDER BY initiated_at ASC`,
    )
    .all(...parentRunIds);
  for (const row of rows) {
    const d = rowToDelegation(row);
    if (!m.has(d.parentRunId)) m.set(d.parentRunId, []);
    m.get(d.parentRunId)!.push(d);
  }
  return m;
}
