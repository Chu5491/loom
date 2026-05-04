import { randomUUID } from "node:crypto";
import type { Agent, AdapterConfig, AdapterKind, AgentRole } from "@loom/core";
import { listSkillIdsForAgent, setSkillIdsForAgent } from "./agent-skills.js";
import { getDb } from "./client.js";
import {
  listMcpServerIdsForAgent,
  setMcpServersForAgent,
} from "./mcp-servers.js";

interface AgentRow {
  id: string;
  project_id: string;
  name: string;
  prompt: string;
  role: string | null;
  adapter_kind: string;
  adapter_config: string;
  default_cwd: string | null;
  created_at: string;
  updated_at: string;
}

function rowToAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    prompt: row.prompt ?? "",
    skillIds: listSkillIdsForAgent(row.id),
    mcpServerIds: listMcpServerIdsForAgent(row.id),
    role: (row.role as AgentRole | null) ?? null,
    adapterKind: row.adapter_kind as AdapterKind,
    adapterConfig: JSON.parse(row.adapter_config) as AdapterConfig,
    defaultCwd: row.default_cwd,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateAgentInput {
  projectId: string;
  name: string;
  prompt?: string;
  skillIds?: string[];
  mcpServerIds?: string[];
  role?: AgentRole | null;
  adapterKind: AdapterKind;
  adapterConfig?: AdapterConfig;
  defaultCwd?: string | null;
}

export interface UpdateAgentInput {
  projectId?: string;
  name?: string;
  prompt?: string;
  skillIds?: string[];
  mcpServerIds?: string[];
  role?: AgentRole | null;
  adapterKind?: AdapterKind;
  adapterConfig?: AdapterConfig;
  defaultCwd?: string | null;
}

export function listAgents(filter: { projectId?: string } = {}): Agent[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.projectId) {
    where.push("project_id = ?");
    params.push(filter.projectId);
  }
  const sql = `SELECT * FROM agents ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC`;
  const rows = getDb()
    .prepare<unknown[], AgentRow>(sql)
    .all(...params);
  return rows.map(rowToAgent);
}

export function getAgent(id: string): Agent | null {
  const row = getDb()
    .prepare<[string], AgentRow>("SELECT * FROM agents WHERE id = ?")
    .get(id);
  return row ? rowToAgent(row) : null;
}

export function createAgent(input: CreateAgentInput): Agent {
  const now = new Date().toISOString();
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO agents (id, project_id, name, prompt, role, adapter_kind,
                           adapter_config, default_cwd, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.projectId,
      input.name,
      input.prompt ?? "",
      input.role ?? null,
      input.adapterKind,
      JSON.stringify(input.adapterConfig ?? {}),
      input.defaultCwd ?? null,
      now,
      now,
    );
  if (input.skillIds && input.skillIds.length > 0) {
    setSkillIdsForAgent(id, input.skillIds);
  }
  if (input.mcpServerIds && input.mcpServerIds.length > 0) {
    setMcpServersForAgent(id, input.mcpServerIds);
  }
  return getAgent(id)!;
}

export function updateAgent(id: string, input: UpdateAgentInput): Agent | null {
  const existing = getAgent(id);
  if (!existing) return null;

  const merged: Agent = {
    ...existing,
    ...(input.projectId !== undefined && { projectId: input.projectId }),
    ...(input.name !== undefined && { name: input.name }),
    ...(input.prompt !== undefined && { prompt: input.prompt }),
    ...(input.role !== undefined && { role: input.role }),
    ...(input.adapterKind !== undefined && { adapterKind: input.adapterKind }),
    ...(input.adapterConfig !== undefined && { adapterConfig: input.adapterConfig }),
    ...(input.defaultCwd !== undefined && { defaultCwd: input.defaultCwd }),
    updatedAt: new Date().toISOString(),
  };

  getDb()
    .prepare(
      `UPDATE agents
         SET project_id = ?, name = ?, prompt = ?, role = ?,
             adapter_kind = ?, adapter_config = ?, default_cwd = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      merged.projectId,
      merged.name,
      merged.prompt,
      merged.role,
      merged.adapterKind,
      JSON.stringify(merged.adapterConfig),
      merged.defaultCwd,
      merged.updatedAt,
      id,
    );

  if (input.skillIds !== undefined) {
    setSkillIdsForAgent(id, input.skillIds);
  }
  if (input.mcpServerIds !== undefined) {
    setMcpServersForAgent(id, input.mcpServerIds);
  }

  return getAgent(id);
}

export function deleteAgent(id: string): boolean {
  const result = getDb().prepare("DELETE FROM agents WHERE id = ?").run(id);
  return result.changes > 0;
}
