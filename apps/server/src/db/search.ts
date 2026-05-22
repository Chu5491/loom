import type { SearchResult } from "@loom/core";
import { getDb } from "./client.js";

export function search(
  query: string,
  opts?: { projectId?: string; limit?: number },
): SearchResult[] {
  const db = getDb();
  const limit = opts?.limit ?? 20;

  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const ftsQuery = terms
    .map((t) => `"${t.replace(/"/g, '""')}"*`)
    .join(" ");

  const params: unknown[] = [ftsQuery];
  const projectFilter = opts?.projectId ? "AND m.project_id = ?" : "";
  if (opts?.projectId) params.push(opts.projectId);
  params.push(limit);

  const sql = `
    SELECT m.kind, m.entity_id, m.project_id,
           highlight(search_fts, 0, char(2), char(3)) AS title_hl,
           snippet(search_fts, 1, char(2), char(3), '…', 40) AS body_snip,
           CASE m.kind
             WHEN 'run' THEN (SELECT thread_id FROM runs WHERE id = m.entity_id)
             ELSE NULL
           END AS thread_id
    FROM search_fts
    JOIN search_map m ON m.id = search_fts.rowid
    WHERE search_fts MATCH ?
      ${projectFilter}
    ORDER BY rank
    LIMIT ?
  `;

  try {
    const rows = db
      .prepare<
        unknown[],
        {
          kind: string;
          entity_id: string;
          project_id: string | null;
          title_hl: string;
          body_snip: string;
          thread_id: string | null;
        }
      >(sql)
      .all(...params);

    return rows.map((r) => ({
      kind: r.kind as SearchResult["kind"],
      entityId: r.entity_id,
      projectId: r.project_id,
      title: r.title_hl,
      snippet: r.body_snip,
      threadId: r.thread_id,
    }));
  } catch {
    // malformed FTS5 query — return empty
    return [];
  }
}
