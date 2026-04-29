import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
} from "lucide-react";
import type { TreeEntry } from "@loom/core";
import { api } from "../api/client.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

/**
 * Lazy file-tree panel for a project. Each directory fetches its
 * children on first expand and caches them — so a real repo doesn't
 * ship the whole tree on first render.
 *
 * Pure presentation: clicking a file calls `onPick(path)`. The parent
 * decides what that means (open a tab, navigate, etc.). Highlighting
 * follows `selectedPath` so the parent can keep the tree in sync with
 * external state (e.g. the active workspace tab).
 *
 * `touched` is an optional set of paths that any agent has modified —
 * files in the set get a subtle dot decoration, and directories get one
 * if any descendant path matches. It's a quick visual answer to
 * "what's been worked on?" without leaving the tree.
 */
export function FilesTree({
  projectId,
  selectedPath,
  touched,
  onPick,
}: {
  projectId: string;
  selectedPath: string | null;
  touched?: Set<string>;
  onPick: (path: string) => void;
}) {
  return (
    <TreeChildren
      projectId={projectId}
      path=""
      depth={0}
      selectedPath={selectedPath}
      touched={touched}
      onPick={onPick}
    />
  );
}

/** Count touched paths under a directory prefix. 0 means none, ≥1
 *  drives a count badge on the collapsed folder so the user can see
 *  *how much* has been worked on inside without expanding. Linear scan
 *  is fine for realistic sizes (hundreds of paths). */
function countTouchedDescendants(touched: Set<string>, dir: string): number {
  if (!dir) return touched.size;
  const prefix = dir + "/";
  let n = 0;
  for (const p of touched) if (p.startsWith(prefix)) n++;
  return n;
}

function TreeNode({
  projectId,
  path,
  name,
  depth,
  selectedPath,
  touched,
  onPick,
}: {
  projectId: string;
  path: string;
  name: string;
  depth: number;
  selectedPath: string | null;
  touched?: Set<string>;
  onPick: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // When the folder is closed, surface how many files inside have been
  // touched so the user can see *how much* changed without expanding.
  // Once open, descendant decorations speak for themselves so the
  // count is hidden to avoid double-counting noise.
  const touchCount = !open && touched
    ? countTouchedDescendants(touched, path)
    : 0;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={
          touchCount > 0
            ? `${name} · ${touchCount} touched`
            : name
        }
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-sm hover:bg-muted/40 transition-colors"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {open ? (
          <ChevronDown className="size-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="size-3 text-muted-foreground shrink-0" />
        )}
        {open ? (
          <FolderOpen className="size-3.5 text-muted-foreground shrink-0" />
        ) : (
          <Folder className="size-3.5 text-muted-foreground shrink-0" />
        )}
        <span className="truncate flex-1">{name}</span>
        {touchCount > 0 ? <TouchBadge count={touchCount} /> : null}
      </button>
      {open ? (
        <TreeChildren
          projectId={projectId}
          path={path}
          depth={depth + 1}
          selectedPath={selectedPath}
          touched={touched}
          onPick={onPick}
        />
      ) : null}
    </div>
  );
}

function TreeChildren({
  projectId,
  path,
  depth,
  selectedPath,
  touched,
  onPick,
}: {
  projectId: string;
  path: string;
  depth: number;
  selectedPath: string | null;
  touched?: Set<string>;
  onPick: (path: string) => void;
}) {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ["projectTree", projectId, path],
    queryFn: () => api.getProjectTree(projectId, path || undefined),
    staleTime: 30_000,
  });

  if (q.isLoading) {
    return (
      <p
        className="px-2 py-1 text-xs text-muted-foreground italic"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        …
      </p>
    );
  }
  if (q.isError) {
    return (
      <p
        className="px-2 py-1 text-xs text-destructive"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {(q.error as Error).message}
      </p>
    );
  }
  const entries = q.data?.entries ?? [];
  if (entries.length === 0) {
    return (
      <p
        className="px-2 py-1 text-xs text-muted-foreground/70 italic"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {t("files.tree.emptyDir")}
      </p>
    );
  }
  return (
    <ul>
      {entries.map((e) =>
        e.kind === "directory" ? (
          <li key={e.path}>
            <TreeNode
              projectId={projectId}
              path={e.path}
              name={e.name}
              depth={depth}
              selectedPath={selectedPath}
              touched={touched}
              onPick={onPick}
            />
          </li>
        ) : (
          <li key={e.path}>
            <FileLeaf
              entry={e}
              depth={depth}
              selectedPath={selectedPath}
              isTouched={touched?.has(e.path) ?? false}
              onPick={onPick}
            />
          </li>
        ),
      )}
    </ul>
  );
}

function FileLeaf({
  entry,
  depth,
  selectedPath,
  isTouched,
  onPick,
}: {
  entry: TreeEntry;
  depth: number;
  selectedPath: string | null;
  isTouched: boolean;
  onPick: (path: string) => void;
}) {
  const isSelected = selectedPath === entry.path;
  return (
    <button
      type="button"
      onClick={() => onPick(entry.path)}
      className={cn(
        "flex w-full items-center gap-1.5 px-2 py-1 text-left text-sm transition-colors",
        isSelected ? "bg-foreground/10 font-medium" : "hover:bg-muted/40",
      )}
      style={{ paddingLeft: `${depth * 12 + 23}px` }}
    >
      <FileText
        className={cn(
          "size-3.5 shrink-0",
          isSelected ? "" : "text-muted-foreground",
        )}
      />
      <span className="truncate flex-1">{entry.name}</span>
      {isTouched ? <TouchDot /> : null}
    </button>
  );
}

/**
 * The dot that says "an agent has modified this." A small accent-colored
 * pip — discreet enough to ignore, distinct enough to notice when you're
 * looking for it.
 */
function TouchDot() {
  return (
    <span
      aria-hidden
      className="size-1.5 rounded-full shrink-0 mr-1 bg-sky-500"
    />
  );
}

/**
 * Folder-level "N touched files inside" badge. Replaces the subtle dot
 * we used before — a number reads at-a-glance for how much activity is
 * happening behind a closed folder. Caps at "9+" to keep width stable.
 */
function TouchBadge({ count }: { count: number }) {
  return (
    <span
      aria-hidden
      className="shrink-0 mr-1 inline-flex min-w-[1rem] items-center justify-center rounded-full bg-sky-500/15 px-1 text-[9px] font-semibold text-sky-700 dark:text-sky-400 mono"
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
