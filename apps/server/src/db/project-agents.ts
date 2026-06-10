// project_agents — 어떤 전역 에이전트가 어떤 프로젝트 팀에 속하는지(M:N).
// agent_skills / agent_mcp_servers 와 같은 멤버십 패턴.

import { getDb } from "./client.js";

export function addAgentToProject(projectId: string, agentId: string): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO project_agents (project_id, agent_id, added_at)
       VALUES (?, ?, ?)`,
    )
    .run(projectId, agentId, new Date().toISOString());
}

export function removeAgentFromProject(
  projectId: string,
  agentId: string,
): boolean {
  const r = getDb()
    .prepare(
      `DELETE FROM project_agents WHERE project_id = ? AND agent_id = ?`,
    )
    .run(projectId, agentId);
  return r.changes > 0;
}

export function isAgentInProject(projectId: string, agentId: string): boolean {
  const row = getDb()
    .prepare<[string, string], { agent_id: string }>(
      `SELECT agent_id FROM project_agents WHERE project_id = ? AND agent_id = ?`,
    )
    .get(projectId, agentId);
  return !!row;
}

export function listProjectAgentIds(projectId: string): string[] {
  return getDb()
    .prepare<[string], { agent_id: string }>(
      `SELECT agent_id FROM project_agents WHERE project_id = ?`,
    )
    .all(projectId)
    .map((r) => r.agent_id);
}

/** 이 에이전트가 팀으로 속한 프로젝트 id 들 — 에이전트 삭제 영향 범위 등에 사용. */
export function listProjectIdsForAgent(agentId: string): string[] {
  return getDb()
    .prepare<[string], { project_id: string }>(
      `SELECT project_id FROM project_agents WHERE agent_id = ?`,
    )
    .all(agentId)
    .map((r) => r.project_id);
}
