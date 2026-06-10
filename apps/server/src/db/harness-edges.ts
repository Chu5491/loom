// harness_edges CRUD. 순수 DB 계층 — 트리거 판정/발화는 services/harness.ts.

import { randomUUID } from "node:crypto";
import type { HarnessEdge, HarnessMode, HarnessTrigger } from "@loom/core";
import { getDb } from "./client.js";

interface HarnessEdgeRow {
  id: string;
  project_id: string;
  from_agent_id: string;
  to_agent_id: string;
  trigger: string;
  prompt: string | null;
  carry_result: number;
  mode: string;
  created_at: string;
  updated_at: string;
}

function rowToEdge(row: HarnessEdgeRow): HarnessEdge {
  return {
    id: row.id,
    projectId: row.project_id,
    fromAgentId: row.from_agent_id,
    toAgentId: row.to_agent_id,
    trigger: row.trigger as HarnessTrigger,
    prompt: row.prompt,
    carryResult: row.carry_result === 1,
    mode: row.mode as HarnessMode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listHarnessEdges(projectId: string): HarnessEdge[] {
  const rows = getDb()
    .prepare<[string], HarnessEdgeRow>(
      `SELECT * FROM harness_edges WHERE project_id = ? ORDER BY created_at ASC`,
    )
    .all(projectId);
  return rows.map(rowToEdge);
}

/** 한 에이전트가 source 인 엣지 — run 완료 시 트리거 평가에 쓰임. */
export function listEdgesFromAgent(fromAgentId: string): HarnessEdge[] {
  const rows = getDb()
    .prepare<[string], HarnessEdgeRow>(
      `SELECT * FROM harness_edges WHERE from_agent_id = ? ORDER BY created_at ASC`,
    )
    .all(fromAgentId);
  return rows.map(rowToEdge);
}

// 전역 에이전트는 여러 프로젝트 팀에 속할 수 있어 엣지도 프로젝트마다 다름.
// run 완료 시엔 *그 run 의 프로젝트* 엣지만 발화해야 함.
export function listEdgesFromAgentInProject(
  fromAgentId: string,
  projectId: string,
): HarnessEdge[] {
  const rows = getDb()
    .prepare<[string, string], HarnessEdgeRow>(
      `SELECT * FROM harness_edges
       WHERE from_agent_id = ? AND project_id = ?
       ORDER BY created_at ASC`,
    )
    .all(fromAgentId, projectId);
  return rows.map(rowToEdge);
}

export function getHarnessEdge(id: string): HarnessEdge | null {
  const row = getDb()
    .prepare<[string], HarnessEdgeRow>(`SELECT * FROM harness_edges WHERE id = ?`)
    .get(id);
  return row ? rowToEdge(row) : null;
}

/** 같은 from→to→trigger 엣지가 이미 있는지 — 중복 방지. */
export function findDuplicateEdge(args: {
  fromAgentId: string;
  toAgentId: string;
  trigger: HarnessTrigger;
}): HarnessEdge | null {
  const row = getDb()
    .prepare<[string, string, string], HarnessEdgeRow>(
      `SELECT * FROM harness_edges
       WHERE from_agent_id = ? AND to_agent_id = ? AND trigger = ?`,
    )
    .get(args.fromAgentId, args.toAgentId, args.trigger);
  return row ? rowToEdge(row) : null;
}

export interface CreateEdgeInput {
  projectId: string;
  fromAgentId: string;
  toAgentId: string;
  trigger: HarnessTrigger;
  prompt?: string | null;
  carryResult?: boolean;
  mode?: HarnessMode;
}

export function createHarnessEdge(input: CreateEdgeInput): HarnessEdge {
  const now = new Date().toISOString();
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO harness_edges
         (id, project_id, from_agent_id, to_agent_id, trigger,
          prompt, carry_result, mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.projectId,
      input.fromAgentId,
      input.toAgentId,
      input.trigger,
      input.prompt ?? null,
      input.carryResult ? 1 : 0,
      input.mode ?? "ask",
      now,
      now,
    );
  return getHarnessEdge(id)!;
}

export interface UpdateEdgeInput {
  trigger?: HarnessTrigger;
  prompt?: string | null;
  carryResult?: boolean;
  mode?: HarnessMode;
}

export function updateHarnessEdge(
  id: string,
  input: UpdateEdgeInput,
): HarnessEdge | null {
  const existing = getHarnessEdge(id);
  if (!existing) return null;
  const next = {
    trigger: input.trigger ?? existing.trigger,
    prompt: input.prompt !== undefined ? input.prompt : existing.prompt,
    carryResult:
      input.carryResult !== undefined ? input.carryResult : existing.carryResult,
    mode: input.mode ?? existing.mode,
  };
  getDb()
    .prepare(
      `UPDATE harness_edges
       SET trigger = ?, prompt = ?, carry_result = ?, mode = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      next.trigger,
      next.prompt,
      next.carryResult ? 1 : 0,
      next.mode,
      new Date().toISOString(),
      id,
    );
  return getHarnessEdge(id);
}

export function deleteHarnessEdge(id: string): boolean {
  const result = getDb()
    .prepare(`DELETE FROM harness_edges WHERE id = ?`)
    .run(id);
  return result.changes > 0;
}

// 에이전트가 프로젝트 팀에서 빠질 때, 그 프로젝트에서 해당 에이전트가 끼인
// 엣지를 정리 — 팀에 없는 노드를 가리키는 엣지가 남지 않도록.
export function deleteEdgesForAgentInProject(
  projectId: string,
  agentId: string,
): number {
  const r = getDb()
    .prepare(
      `DELETE FROM harness_edges
       WHERE project_id = ? AND (from_agent_id = ? OR to_agent_id = ?)`,
    )
    .run(projectId, agentId, agentId);
  return r.changes;
}
