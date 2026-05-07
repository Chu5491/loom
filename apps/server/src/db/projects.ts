import { randomUUID } from "node:crypto";
import type { PreferredEditor, Project } from "@loom/core";
import { getDb } from "./client.js";

interface ProjectRow {
  id: string;
  name: string;
  path: string;
  description: string | null;
  preferred_editor: string | null;
  clone_url: string | null;
  created_at: string;
  updated_at: string;
}

const VALID_EDITORS: ReadonlySet<PreferredEditor> = new Set([
  "vscode",
  "cursor",
  "antigravity",
  "zed",
  "intellij",
]);

function normalizeEditor(raw: string | null): PreferredEditor | null {
  if (!raw) return null;
  return VALID_EDITORS.has(raw as PreferredEditor)
    ? (raw as PreferredEditor)
    : null;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    description: row.description,
    preferredEditor: normalizeEditor(row.preferred_editor),
    cloneUrl: row.clone_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateProjectInput {
  name: string;
  path: string;
  description?: string | null;
  preferredEditor?: PreferredEditor | null;
  cloneUrl?: string | null;
}

export interface UpdateProjectInput {
  name?: string;
  path?: string;
  description?: string | null;
  preferredEditor?: PreferredEditor | null;
}

export function listProjects(): Project[] {
  const rows = getDb()
    .prepare<[], ProjectRow>("SELECT * FROM projects ORDER BY updated_at DESC")
    .all();
  return rows.map(rowToProject);
}

export function getProject(id: string): Project | null {
  const row = getDb()
    .prepare<[string], ProjectRow>("SELECT * FROM projects WHERE id = ?")
    .get(id);
  return row ? rowToProject(row) : null;
}

export function createProject(input: CreateProjectInput): Project {
  const id = randomUUID();
  return createProjectWithId(id, input);
}

/** 미리 정해둔 id 로 project row 만 만듦. clone 흐름이 id 를 먼저 결정해 그
 *  id 를 디렉터리명으로 쓴 뒤 row 를 박는 패턴이라 분리. */
export function createProjectWithId(
  id: string,
  input: CreateProjectInput,
): Project {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO projects (id, name, path, description, preferred_editor, clone_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.path,
      input.description ?? null,
      input.preferredEditor ?? null,
      input.cloneUrl ?? null,
      now,
      now,
    );
  return getProject(id)!;
}

export function updateProject(
  id: string,
  input: UpdateProjectInput,
): Project | null {
  const existing = getProject(id);
  if (!existing) return null;
  const merged: Project = {
    ...existing,
    ...(input.name !== undefined && { name: input.name }),
    ...(input.path !== undefined && { path: input.path }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.preferredEditor !== undefined && {
      preferredEditor: input.preferredEditor,
    }),
    updatedAt: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `UPDATE projects
         SET name = ?, path = ?, description = ?, preferred_editor = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      merged.name,
      merged.path,
      merged.description,
      merged.preferredEditor,
      merged.updatedAt,
      id,
    );
  return merged;
}

export function deleteProject(id: string): boolean {
  // ON DELETE CASCADE on agents.project_id removes all agents in this project.
  const result = getDb().prepare("DELETE FROM projects WHERE id = ?").run(id);
  return result.changes > 0;
}
