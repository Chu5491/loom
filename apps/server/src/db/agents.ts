import { randomUUID } from "node:crypto";
import type { Agent, AdapterConfig, AdapterKind, AgentRole } from "@loom/core";
import { encryptSecret, isEncrypted, tryDecryptSecret } from "../crypto.js";
import { listSkillIdsForAgent, setSkillIdsForAgent } from "./agent-skills.js";
import { addAgentToProject } from "./project-agents.js";
import { getDb } from "./client.js";
import {
  listMcpServerIdsForAgent,
  setMcpServersForAgent,
} from "./mcp-servers.js";

interface AgentRow {
  id: string;
  project_id: string;
  name: string;
  mention_name: string | null;
  prompt: string;
  role: string | null;
  adapter_kind: string;
  adapter_config: string;
  default_cwd: string | null;
  created_at: string;
  updated_at: string;
}

function encryptConfigEnv(cfg: AdapterConfig): AdapterConfig {
  const env = cfg.env as Record<string, string> | undefined;
  if (!env || typeof env !== "object") return cfg;
  const encrypted: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    encrypted[k] = typeof v === "string" ? encryptSecret(v) : v;
  }
  return { ...cfg, env: encrypted };
}

function decryptConfigEnv(cfg: AdapterConfig, rowId?: string): AdapterConfig {
  const env = cfg.env as Record<string, string> | undefined;
  if (!env || typeof env !== "object") return cfg;
  const decrypted: Record<string, string> = {};
  let needsRewrite = false;
  for (const [k, v] of Object.entries(env)) {
    if (typeof v !== "string") { decrypted[k] = v; continue; }
    if (isEncrypted(v)) {
      const plain = tryDecryptSecret(v);
      if (plain !== null) decrypted[k] = plain;
    } else {
      decrypted[k] = v;
      needsRewrite = true;
    }
  }
  // Auto-encrypt plaintext env values found in DB.
  if (needsRewrite && rowId) {
    const rewrite = encryptConfigEnv({ ...cfg, env: decrypted });
    getDb()
      .prepare(`UPDATE agents SET adapter_config = ? WHERE id = ?`)
      .run(JSON.stringify(rewrite), rowId);
  }
  return { ...cfg, env: decrypted };
}

function rowToAgent(row: AgentRow): Agent {
  const rawConfig = JSON.parse(row.adapter_config) as AdapterConfig;
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    mentionName: row.mention_name ?? null,
    prompt: row.prompt ?? "",
    skillIds: listSkillIdsForAgent(row.id),
    mcpServerIds: listMcpServerIdsForAgent(row.id),
    role: (row.role as AgentRole | null) ?? null,
    adapterKind: row.adapter_kind as AdapterKind,
    adapterConfig: decryptConfigEnv(rawConfig, row.id),
    defaultCwd: row.default_cwd,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateAgentInput {
  projectId: string;
  name: string;
  mentionName?: string | null;
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
  mentionName?: string | null;
  prompt?: string;
  skillIds?: string[];
  mcpServerIds?: string[];
  role?: AgentRole | null;
  adapterKind?: AdapterKind;
  adapterConfig?: AdapterConfig;
  defaultCwd?: string | null;
}

// projectId 없으면 전역 전체. 있으면 그 프로젝트 *팀*(project_agents 멤버십).
// 에이전트는 이제 전역 정의 — origin(agents.project_id)이 아니라 멤버십이 팀.
export function listAgents(filter: { projectId?: string } = {}): Agent[] {
  if (filter.projectId) {
    const rows = getDb()
      .prepare<[string], AgentRow>(
        `SELECT a.* FROM agents a
         JOIN project_agents pa ON pa.agent_id = a.id
         WHERE pa.project_id = ?
         ORDER BY a.created_at DESC`,
      )
      .all(filter.projectId);
    return rows.map(rowToAgent);
  }
  const rows = getDb()
    .prepare<[], AgentRow>(`SELECT * FROM agents ORDER BY created_at DESC`)
    .all();
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
      `INSERT INTO agents (id, project_id, name, mention_name, prompt, role, adapter_kind,
                           adapter_config, default_cwd, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.projectId,
      input.name,
      input.mentionName ?? null,
      input.prompt ?? "",
      input.role ?? null,
      input.adapterKind,
      JSON.stringify(encryptConfigEnv(input.adapterConfig ?? {})),
      input.defaultCwd ?? null,
      now,
      now,
    );
  // origin 프로젝트 팀에 자동 가입 — 만든 곳에서 바로 보이도록.
  if (input.projectId) addAgentToProject(input.projectId, id);
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
    ...(input.mentionName !== undefined && { mentionName: input.mentionName }),
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
         SET project_id = ?, name = ?, mention_name = ?, prompt = ?, role = ?,
             adapter_kind = ?, adapter_config = ?, default_cwd = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      merged.projectId,
      merged.name,
      merged.mentionName,
      merged.prompt,
      merged.role,
      merged.adapterKind,
      JSON.stringify(encryptConfigEnv(merged.adapterConfig)),
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
