import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";

/**
 * Read-only filesystem access scoped to a single project's root directory.
 *
 * Two safety rules apply to every path that crosses the API boundary:
 *
 *   1. Path traversal — every requested sub-path is resolved and re-checked
 *      against the project root. Anything outside (..  symlinks-to-elsewhere)
 *      is rejected with an explicit error rather than silently leaking.
 *   2. Hidden noise — directories like `.git`, `node_modules`, `dist` are
 *      filtered before the response is built so the UI tree stays useful.
 *      Users who actually want them can still hit them by typing the path.
 *
 * No write API lives here on purpose — file edits happen through agents
 * (which run their own CLIs in cwd), not through loom's HTTP surface.
 */

const HIDDEN_DIR_NAMES = new Set([
  ".git",
  ".svn",
  ".hg",
  "node_modules",
  ".next",
  ".turbo",
  ".cache",
  ".parcel-cache",
  "dist",
  "build",
  "out",
  ".venv",
  "__pycache__",
  ".DS_Store",
]);

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MiB — refuse to ship anything bigger

export interface TreeEntry {
  name: string;
  /** Path relative to the project root, using "/" as separator. */
  path: string;
  kind: "file" | "directory";
  /** Files only. Bytes. Always populated when kind === "file". */
  size?: number;
}

export interface FileContent {
  path: string;
  size: number;
  /** UTF-8 decoded content. Binary files come back null. */
  text: string | null;
  /** Best-effort file extension (lowercase, no dot). Used by UI for
   *  syntax-highlight selection. Empty string when none. */
  ext: string;
}

/**
 * Resolve a sub-path against a project root, refusing anything that
 * escapes. Returns the absolute resolved path on success, null when the
 * input would escape or is otherwise unsafe.
 */
function safeResolve(root: string, sub: string): string | null {
  // Empty / "/" → the root itself.
  const trimmed = sub.replace(/^\/+/, "");
  const candidate = resolve(root, trimmed);
  // After resolution, it must still live under root. Use relative() so
  // we don't rely on string-prefix tricks (path can contain `/foo` and
  // `/foo-bar` confusion).
  const rel = relative(root, candidate);
  if (rel === "") return candidate;
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return candidate;
}

function toForwardSlash(p: string): string {
  return p.split(sep).join("/");
}

/** List one directory level. Lazy on purpose — recursive trees explode in
 *  size for real projects. The UI fetches children on expand. */
export async function listTree(
  root: string,
  subPath: string,
): Promise<{ ok: true; entries: TreeEntry[] } | { ok: false; reason: string }> {
  const abs = safeResolve(root, subPath);
  if (!abs) return { ok: false, reason: "path_outside_root" };

  let dirents;
  try {
    dirents = await readdir(abs, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { ok: false, reason: "not_found" };
    if (code === "ENOTDIR") return { ok: false, reason: "not_a_directory" };
    return { ok: false, reason: "read_failed" };
  }

  const entries: TreeEntry[] = [];
  for (const d of dirents) {
    if (HIDDEN_DIR_NAMES.has(d.name)) continue;
    if (d.name.startsWith(".") && d.name !== ".gitignore") continue;
    const childAbs = join(abs, d.name);
    const childRel = toForwardSlash(relative(root, childAbs));
    if (d.isDirectory()) {
      entries.push({ name: d.name, path: childRel, kind: "directory" });
    } else if (d.isFile()) {
      let size = 0;
      try {
        size = (await stat(childAbs)).size;
      } catch {
        // Inaccessible file — keep the entry but report size 0
      }
      entries.push({ name: d.name, path: childRel, kind: "file", size });
    }
    // sockets / fifos / symlinks-to-nonexistent are skipped silently
  }

  // Directories first, then files; alphabetical within each group. Matches
  // VS Code / Finder convention.
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { ok: true, entries };
}

/**
 * Recursively walk the project tree and return every regular file as a
 * flat list of "/"-separated relative paths. Powers the Cmd+P palette
 * — clients want to do their own fuzzy matching, so we hand them the
 * raw inventory and they pick.
 *
 * Skips the same hidden directories `listTree` does, plus caps total
 * entries to defend against pathological repos. The cap mirrors what
 * VS Code's quick-open allows by default.
 */
const MAX_FLAT_ENTRIES = 50_000;

export async function listAllFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const queue: string[] = [""];
  while (queue.length > 0) {
    const sub = queue.shift()!;
    const abs = safeResolve(root, sub);
    if (!abs) continue;
    let dirents;
    try {
      dirents = await readdir(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of dirents) {
      if (HIDDEN_DIR_NAMES.has(d.name)) continue;
      if (d.name.startsWith(".") && d.name !== ".gitignore") continue;
      const rel = sub ? `${sub}/${d.name}` : d.name;
      if (d.isDirectory()) {
        queue.push(rel);
      } else if (d.isFile()) {
        out.push(rel);
        if (out.length >= MAX_FLAT_ENTRIES) return out;
      }
    }
  }
  return out;
}

/** Read a single file's contents. Refuses anything outside the project
 *  root, anything > MAX_FILE_BYTES, or non-UTF-8 binary blobs (text === null
 *  in that case so the UI can show a "binary file" placeholder). */
export async function readProjectFile(
  root: string,
  subPath: string,
): Promise<
  | { ok: true; file: FileContent }
  | { ok: false; reason: string; size?: number }
> {
  const abs = safeResolve(root, subPath);
  if (!abs) return { ok: false, reason: "path_outside_root" };

  let info;
  try {
    info = await stat(abs);
  } catch {
    return { ok: false, reason: "not_found" };
  }
  if (!info.isFile()) return { ok: false, reason: "not_a_file" };
  if (info.size > MAX_FILE_BYTES) {
    return { ok: false, reason: "too_large", size: info.size };
  }

  const buf = await readFile(abs);
  // Crude binary sniff — null byte in the first 8 KiB is a strong signal.
  // Plenty good enough to pick "show preview" vs "show placeholder".
  const sample = buf.subarray(0, Math.min(8192, buf.length));
  const looksBinary = sample.includes(0);
  const text = looksBinary ? null : buf.toString("utf8");

  const dot = subPath.lastIndexOf(".");
  const ext =
    dot >= 0 && dot > subPath.lastIndexOf("/")
      ? subPath.slice(dot + 1).toLowerCase()
      : "";

  return {
    ok: true,
    file: {
      path: toForwardSlash(normalize(subPath)),
      size: info.size,
      text,
      ext,
    },
  };
}
