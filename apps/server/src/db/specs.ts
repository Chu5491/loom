import { randomUUID } from "node:crypto";
import type { Spec } from "@loom/core";
import { getDb } from "./client.js";

interface SpecRow {
  id: string;
  name: string;
  content: string;
  agent_id: string | null;
  tags: string;
  created_at: string;
  updated_at: string;
}

function rowToSpec(row: SpecRow): Spec {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags);
    if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === "string");
  } catch {
    // legacy rows or malformed JSON → empty
  }
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    agentId: row.agent_id,
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateSpecInput {
  name: string;
  content: string;
  agentId?: string | null;
  tags?: string[];
}

export interface UpdateSpecInput {
  name?: string;
  content?: string;
  agentId?: string | null;
  tags?: string[];
}

export function listSpecs(filter: { agentId?: string } = {}): Spec[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.agentId) {
    where.push("agent_id = ?");
    params.push(filter.agentId);
  }
  const sql = `SELECT * FROM specs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC`;
  const rows = getDb()
    .prepare<unknown[], SpecRow>(sql)
    .all(...params);
  return rows.map(rowToSpec);
}

export function getSpec(id: string): Spec | null {
  const row = getDb()
    .prepare<[string], SpecRow>("SELECT * FROM specs WHERE id = ?")
    .get(id);
  return row ? rowToSpec(row) : null;
}

export function getSpecsByIds(ids: string[]): Spec[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = getDb()
    .prepare<unknown[], SpecRow>(`SELECT * FROM specs WHERE id IN (${placeholders})`)
    .all(...ids);
  // Preserve input ordering for deterministic prompt composition.
  const byId = new Map(rows.map((r) => [r.id, rowToSpec(r)]));
  return ids.map((id) => byId.get(id)).filter((s): s is Spec => !!s);
}

export function createSpec(input: CreateSpecInput): Spec {
  const id = randomUUID();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO specs (id, name, content, agent_id, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.content,
      input.agentId ?? null,
      JSON.stringify(input.tags ?? []),
      now,
      now,
    );
  return getSpec(id)!;
}

export function updateSpec(id: string, input: UpdateSpecInput): Spec | null {
  const existing = getSpec(id);
  if (!existing) return null;
  const merged: Spec = {
    ...existing,
    ...(input.name !== undefined && { name: input.name }),
    ...(input.content !== undefined && { content: input.content }),
    ...(input.agentId !== undefined && { agentId: input.agentId }),
    ...(input.tags !== undefined && { tags: input.tags }),
    updatedAt: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `UPDATE specs
         SET name = ?, content = ?, agent_id = ?, tags = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      merged.name,
      merged.content,
      merged.agentId,
      JSON.stringify(merged.tags),
      merged.updatedAt,
      id,
    );
  return merged;
}

export function deleteSpec(id: string): boolean {
  const result = getDb().prepare("DELETE FROM specs WHERE id = ?").run(id);
  return result.changes > 0;
}
