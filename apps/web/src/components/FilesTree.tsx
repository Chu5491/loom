import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
} from "lucide-react";
import type { Agent, TreeEntry } from "@loom/core";
import { api } from "../api/client.js";
import { agentColorOf, classesFor } from "./agentColor.js";
import { AgentInitialBadge } from "./AgentInitialBadge.js";
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
 * external state.
 *
 * `touched` maps a path to the id of the last agent that modified it.
 * Files get the matching agent's avatar inline; directories get a small
 * badge with the descendant count. The aim is "I can scan the tree and
 * see who's been working where" without leaving the panel.
 */
export function FilesTree({
  projectId,
  selectedPath,
  touched,
  activeByAgent,
  agents,
  onPick,
}: {
  projectId: string;
  selectedPath: string | null;
  touched?: Map<string, string>;
  /** Subset of `touched` whose entries are being edited *right now*.
   *  Files in this map get a pulsing dot instead of a static one. */
  activeByAgent?: Map<string, string>;
  agents?: Agent[];
  onPick: (path: string) => void;
}) {
  return (
    <TreeChildren
      projectId={projectId}
      path=""
      depth={0}
      selectedPath={selectedPath}
      touched={touched}
      activeByAgent={activeByAgent}
      agents={agents}
      onPick={onPick}
    />
  );
}

/** Count touched paths under a directory prefix. 0 means none, ≥1
 *  drives a count badge on the collapsed folder so the user can see
 *  *how much* has been worked on inside without expanding. Linear scan
 *  is fine for realistic sizes (hundreds of paths). */
function countTouchedDescendants(
  touched: Map<string, string>,
  dir: string,
): number {
  if (!dir) return touched.size;
  const prefix = dir + "/";
  let n = 0;
  for (const p of touched.keys()) if (p.startsWith(prefix)) n++;
  return n;
}

function TreeNode({
  projectId,
  path,
  name,
  depth,
  selectedPath,
  touched,
  activeByAgent,
  agents,
  onPick,
}: {
  projectId: string;
  path: string;
  name: string;
  depth: number;
  selectedPath: string | null;
  touched?: Map<string, string>;
  activeByAgent?: Map<string, string>;
  agents?: Agent[];
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
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={
          touchCount > 0
            ? `${name} · ${touchCount} touched`
            : name
        }
        className="flex w-full min-w-0 items-center gap-1.5 px-2 py-1 text-left text-sm hover:bg-muted/40 transition-colors"
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
        <span className="truncate flex-1 min-w-0">{name}</span>
        {touchCount > 0 ? <TouchBadge count={touchCount} /> : null}
      </button>
      {open ? (
        <TreeChildren
          projectId={projectId}
          path={path}
          depth={depth + 1}
          selectedPath={selectedPath}
          touched={touched}
          activeByAgent={activeByAgent}
          agents={agents}
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
  activeByAgent,
  agents,
  onPick,
}: {
  projectId: string;
  path: string;
  depth: number;
  selectedPath: string | null;
  touched?: Map<string, string>;
  activeByAgent?: Map<string, string>;
  agents?: Agent[];
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
              activeByAgent={activeByAgent}
              agents={agents}
              onPick={onPick}
            />
          </li>
        ) : (
          <li key={e.path}>
            <FileLeaf
              entry={e}
              depth={depth}
              selectedPath={selectedPath}
              touchedByAgentId={touched?.get(e.path)}
              isActive={activeByAgent?.has(e.path) ?? false}
              agents={agents}
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
  touchedByAgentId,
  isActive,
  agents,
  onPick,
}: {
  entry: TreeEntry;
  depth: number;
  selectedPath: string | null;
  touchedByAgentId?: string;
  isActive?: boolean;
  agents?: Agent[];
  onPick: (path: string) => void;
}) {
  const isSelected = selectedPath === entry.path;
  const lastAgent = touchedByAgentId
    ? agents?.find((a) => a.id === touchedByAgentId)
    : undefined;
  const dotClass = lastAgent
    ? classesFor(agentColorOf(lastAgent)).dot
    : touchedByAgentId
      ? "bg-foreground/40"
      : null;
  return (
    <button
      type="button"
      onClick={() => onPick(entry.path)}
      title={
        lastAgent
          ? isActive
            ? `${entry.name} · @${lastAgent.name} editing now`
            : `${entry.name} · @${lastAgent.name}`
          : entry.name
      }
      className={cn(
        "flex w-full min-w-0 items-center gap-1.5 px-2 py-1 text-left text-sm transition-colors",
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
      <span className="truncate flex-1 min-w-0">{entry.name}</span>
      {/* Agent indicator. Active edits get the prominent initials badge
       *  (with pulse) so the user can see "AD is in main.py *now*"
       *  without expanding folders or opening files. Past edits keep
       *  the small color dot — quieter, just the trail. */}
      {lastAgent && isActive ? (
        <AgentInitialBadge agent={lastAgent} live size="xs" className="mr-1" />
      ) : dotClass ? (
        <span
          aria-hidden
          className={cn("size-1.5 rounded-full shrink-0 mr-1", dotClass)}
        />
      ) : null}
    </button>
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
