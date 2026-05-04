// 시스템 레벨 MCP 서버 카탈로그. agent.mcpServerIds(=agent_mcp_servers 조인)로
// 에이전트가 자기 권한 안에 있는 서버만 볼 수 있게.
//
// 비밀(env / headers)은 평문 SQLite. 로컬 단일 사용자 신뢰 모델이라 OK — 외부에
// 공개 IP로 띄우지 않는 한.

import { randomUUID } from "node:crypto";
import type { McpServer, McpServerKind } from "@loom/core";
import { getDb } from "./client.js";

interface McpRow {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  command: string | null;
  args: string;
  env: string;
  url: string | null;
  headers: string;
  created_at: string;
  updated_at: string;
}

const VALID_KINDS: ReadonlySet<McpServerKind> = new Set([
  "stdio",
  "http",
  "sse",
]);

function parseKind(raw: string): McpServerKind {
  return VALID_KINDS.has(raw as McpServerKind) ? (raw as McpServerKind) : "stdio";
}

function parseStringArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) && parsed.every((x) => typeof x === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function parseStringMap(json: string): Record<string, string> {
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function rowToServer(row: McpRow): McpServer {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    kind: parseKind(row.kind),
    command: row.command,
    args: parseStringArray(row.args),
    env: parseStringMap(row.env),
    url: row.url,
    headers: parseStringMap(row.headers),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateMcpServerInput {
  name: string;
  description?: string | null;
  kind: McpServerKind;
  command?: string | null;
  args?: string[];
  env?: Record<string, string>;
  url?: string | null;
  headers?: Record<string, string>;
}

export interface UpdateMcpServerInput {
  name?: string;
  description?: string | null;
  kind?: McpServerKind;
  command?: string | null;
  args?: string[];
  env?: Record<string, string>;
  url?: string | null;
  headers?: Record<string, string>;
}

export function listMcpServers(): McpServer[] {
  const rows = getDb()
    .prepare<[], McpRow>(
      "SELECT * FROM mcp_servers ORDER BY name ASC",
    )
    .all();
  return rows.map(rowToServer);
}

export function getMcpServer(id: string): McpServer | null {
  const row = getDb()
    .prepare<[string], McpRow>("SELECT * FROM mcp_servers WHERE id = ?")
    .get(id);
  return row ? rowToServer(row) : null;
}

export function createMcpServer(input: CreateMcpServerInput): McpServer {
  const id = randomUUID();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO mcp_servers
         (id, name, description, kind, command, args, env, url, headers, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.description ?? null,
      input.kind,
      input.command ?? null,
      JSON.stringify(input.args ?? []),
      JSON.stringify(input.env ?? {}),
      input.url ?? null,
      JSON.stringify(input.headers ?? {}),
      now,
      now,
    );
  return getMcpServer(id)!;
}

export function updateMcpServer(
  id: string,
  input: UpdateMcpServerInput,
): McpServer | null {
  const existing = getMcpServer(id);
  if (!existing) return null;
  const merged: McpServer = {
    ...existing,
    ...(input.name !== undefined && { name: input.name }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.kind !== undefined && { kind: input.kind }),
    ...(input.command !== undefined && { command: input.command }),
    ...(input.args !== undefined && { args: input.args }),
    ...(input.env !== undefined && { env: input.env }),
    ...(input.url !== undefined && { url: input.url }),
    ...(input.headers !== undefined && { headers: input.headers }),
    updatedAt: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `UPDATE mcp_servers
         SET name = ?, description = ?, kind = ?, command = ?, args = ?,
             env = ?, url = ?, headers = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      merged.name,
      merged.description,
      merged.kind,
      merged.command,
      JSON.stringify(merged.args),
      JSON.stringify(merged.env),
      merged.url,
      JSON.stringify(merged.headers),
      merged.updatedAt,
      id,
    );
  return merged;
}

export function deleteMcpServer(id: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM mcp_servers WHERE id = ?")
    .run(id);
  return result.changes > 0;
}

// ── Agent ↔ MCP server assignment join table ────────────────────────

export function listMcpServerIdsForAgent(agentId: string): string[] {
  return getDb()
    .prepare<[string], { mcp_server_id: string }>(
      `SELECT mcp_server_id FROM agent_mcp_servers WHERE agent_id = ?
       ORDER BY created_at ASC`,
    )
    .all(agentId)
    .map((r) => r.mcp_server_id);
}

/** Replace the full set of assigned servers for an agent. Atomic — old links
 *  are dropped and new ones inserted in one transaction. */
export function setMcpServersForAgent(
  agentId: string,
  serverIds: string[],
): void {
  const db = getDb();
  const now = new Date().toISOString();
  const tx = db.transaction((ids: string[]) => {
    db.prepare("DELETE FROM agent_mcp_servers WHERE agent_id = ?").run(agentId);
    const insert = db.prepare(
      `INSERT OR IGNORE INTO agent_mcp_servers (agent_id, mcp_server_id, created_at)
       VALUES (?, ?, ?)`,
    );
    for (const sid of ids) insert.run(agentId, sid, now);
  });
  tx(serverIds);
}
