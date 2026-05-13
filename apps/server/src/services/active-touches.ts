import fs from "node:fs";
import path from "node:path";
import type { ActiveTouch, TouchedEdit } from "@loom/core";

export type { ActiveTouch };

interface RunEntry {
  agentId: string;
  projectId: string;
  cwd: string;
  paths: Set<string>;
  /** Bounded ring of {path, line} for the freshest edits — older
   *  entries roll off so the API payload stays small. */
  locations: { path: string; line: number }[];
}

const MAX_LOCATIONS = 16;

const runs = new Map<string, RunEntry>();

export function startTracking(args: {
  runId: string;
  agentId: string;
  projectId: string;
  cwd: string;
}): void {
  runs.set(args.runId, {
    agentId: args.agentId,
    projectId: args.projectId,
    cwd: args.cwd,
    paths: new Set(),
    locations: [],
  });
}

/** Record one or more paths touched by a run. Paths are normalised to
 *  the run's cwd so the file tree (which keys on project-relative)
 *  matches up. Paths that fall outside cwd are dropped — they're
 *  almost always tool inputs the user can't see in the file tree
 *  anyway, and including them would noise up the indicator. */
export function recordPaths(runId: string, absoluteOrRelative: string[]): void {
  const entry = runs.get(runId);
  if (!entry) return;
  for (const p of absoluteOrRelative) {
    const rel = toProjectRelative(p, entry.cwd);
    if (rel !== null) entry.paths.add(rel);
  }
}

/** Same as recordPaths but takes the richer TouchedEdit so we can pin
 *  edits to a line number. When `target` matches text in the file we
 *  push a {path,line} entry; if not (file unreadable, target already
 *  replaced, etc.) we still record the path so the badge appears. */
export function recordEdits(runId: string, edits: TouchedEdit[]): void {
  const entry = runs.get(runId);
  if (!entry) return;
  for (const edit of edits) {
    const rel = toProjectRelative(edit.path, entry.cwd);
    if (rel === null) continue;
    entry.paths.add(rel);

    if (!edit.target) continue;
    const line = findLineOfTarget(entry.cwd, edit.path, edit.target);
    if (line === null) continue;

    entry.locations.push({ path: rel, line });
    if (entry.locations.length > MAX_LOCATIONS) {
      entry.locations.splice(0, entry.locations.length - MAX_LOCATIONS);
    }
  }
}

export function stopTracking(runId: string): void {
  runs.delete(runId);
}

export function listForProject(projectId: string): ActiveTouch[] {
  const out: ActiveTouch[] = [];
  for (const [runId, entry] of runs) {
    if (entry.projectId !== projectId) continue;
    if (entry.paths.size === 0) continue;
    out.push({
      runId,
      agentId: entry.agentId,
      projectId: entry.projectId,
      paths: [...entry.paths],
      locations: [...entry.locations],
    });
  }
  return out;
}

/** Read the file at `cwd/path` (or absolute `path`) and return the
 *  1-based line number where `target` first occurs, or null if we
 *  can't pin it. Best-effort: file read failures, encoding issues,
 *  and missing targets all collapse to null and the UI gracefully
 *  falls back to file-level presence. */
function findLineOfTarget(
  cwd: string,
  filePath: string,
  target: string,
): number | null {
  if (!target) return null;
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
  let content: string;
  try {
    content = fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
  const idx = content.indexOf(target);
  if (idx < 0) return null;
  // Count newlines before the match to get the 1-based line number.
  let line = 1;
  for (let i = 0; i < idx; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}

/** Resolve an absolute / relative path against the run's cwd, return
 *  null if the result escapes the cwd. We deliberately don't follow
 *  symlinks — keeping it textual matches how the file tree keys files. */
function toProjectRelative(p: string, cwd: string): string | null {
  const abs = path.isAbsolute(p) ? p : path.resolve(cwd, p);
  const rel = path.relative(cwd, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  // Normalise Windows separators if any sneak in — file tree uses POSIX.
  return rel.split(path.sep).join("/");
}
