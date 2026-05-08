import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Pen,
} from "lucide-react";
import type { Agent, TreeEntry } from "@loom/core";
import { api } from "../api/client.js";
import { agentColorOf, classesFor } from "./agentColor.js";
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
  lineByPath,
  changesByPath,
  agents,
  onPick,
  defaultOpenDepth = 0,
  staleTime = 30_000,
}: {
  projectId: string;
  selectedPath: string | null;
  touched?: Map<string, string>;
  /** Subset of `touched` whose entries are being edited *right now*.
   *  Files in this map get a pulsing dot instead of a static one. */
  activeByAgent?: Map<string, string>;
  /** path → 현재 편집 중인 라인 번호. 행 끝에 ":42" 표시. */
  lineByPath?: Map<string, number>;
  /** path → 누적 +/- 라인. 행 끝에 ` +12 -3 ` 표시. */
  changesByPath?: Map<string, { additions: number; deletions: number }>;
  agents?: Agent[];
  onPick: (path: string) => void;
  /** Auto-expand directories up to this depth. 0 = current behavior
   *  (everything closed). 1 = root-level dirs open. ProjectMap canvas
   *  view passes 1 so the user sees one level deep on first paint. */
  defaultOpenDepth?: number;
  /** Override the default 30s staleTime — ProjectMap wants fresher data
   *  per the "매번 분석" requirement, FilesTab in activity panel keeps
   *  the cached default. */
  staleTime?: number;
}) {
  return (
    <TreeChildren
      projectId={projectId}
      path=""
      depth={0}
      selectedPath={selectedPath}
      touched={touched}
      activeByAgent={activeByAgent}
      lineByPath={lineByPath}
      changesByPath={changesByPath}
      agents={agents}
      onPick={onPick}
      defaultOpenDepth={defaultOpenDepth}
      staleTime={staleTime}
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
  lineByPath,
  changesByPath,
  agents,
  onPick,
  defaultOpenDepth,
  staleTime,
}: {
  projectId: string;
  path: string;
  name: string;
  depth: number;
  selectedPath: string | null;
  touched?: Map<string, string>;
  activeByAgent?: Map<string, string>;
  lineByPath?: Map<string, number>;
  changesByPath?: Map<string, { additions: number; deletions: number }>;
  agents?: Agent[];
  onPick: (path: string) => void;
  defaultOpenDepth: number;
  staleTime: number;
}) {
  // depth 0 means "직속 root" — defaultOpenDepth=1 면 root 직속 dir 들이 펼쳐져
  // 한 단계 깊이까지 보임. 그 아래는 lazy.
  const [open, setOpen] = useState(depth < defaultOpenDepth);
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
          lineByPath={lineByPath}
          changesByPath={changesByPath}
          agents={agents}
          onPick={onPick}
          defaultOpenDepth={defaultOpenDepth}
          staleTime={staleTime}
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
  lineByPath,
  changesByPath,
  agents,
  onPick,
  defaultOpenDepth,
  staleTime,
}: {
  projectId: string;
  path: string;
  depth: number;
  selectedPath: string | null;
  touched?: Map<string, string>;
  activeByAgent?: Map<string, string>;
  lineByPath?: Map<string, number>;
  changesByPath?: Map<string, { additions: number; deletions: number }>;
  agents?: Agent[];
  onPick: (path: string) => void;
  defaultOpenDepth: number;
  staleTime: number;
}) {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ["projectTree", projectId, path],
    queryFn: () => api.getProjectTree(projectId, path || undefined),
    staleTime,
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
              lineByPath={lineByPath}
              changesByPath={changesByPath}
              agents={agents}
              onPick={onPick}
              defaultOpenDepth={defaultOpenDepth}
              staleTime={staleTime}
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
              line={lineByPath?.get(e.path)}
              changes={changesByPath?.get(e.path)}
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
  line,
  changes,
  agents,
  onPick,
}: {
  entry: TreeEntry;
  depth: number;
  selectedPath: string | null;
  touchedByAgentId?: string;
  isActive?: boolean;
  line?: number;
  changes?: { additions: number; deletions: number };
  agents?: Agent[];
  onPick: (path: string) => void;
}) {
  const { t } = useI18n();
  const isSelected = selectedPath === entry.path;
  const lastAgent = touchedByAgentId
    ? agents?.find((a) => a.id === touchedByAgentId)
    : undefined;
  const cls = lastAgent ? classesFor(agentColorOf(lastAgent)) : null;
  return (
    <button
      type="button"
      onClick={() => onPick(entry.path)}
      title={
        lastAgent
          ? isActive
            ? `${entry.name}${line ? `:${line}` : ""} · @${lastAgent.name} ${t("editing.tooltipSuffix")}`
            : `${entry.name} · @${lastAgent.name}`
          : entry.name
      }
      className={cn(
        "flex w-full min-w-0 items-center gap-1.5 px-2 py-1 text-left text-sm transition-colors",
        isSelected
          ? "bg-foreground/10 font-medium"
          : isActive
            ? "bg-emerald-500/[0.06] hover:bg-emerald-500/10"
            : "hover:bg-muted/40",
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
      {/* 활성 편집 시: 작은 ✎ + 라인 + 에이전트 색 dot. 누적 편집은 작은 dot 만.
          누적 변경 라인 (`+12 -3`) 가 있으면 dot 옆에 표시. */}
      {changes && (changes.additions > 0 || changes.deletions > 0) ? (
        <span className="shrink-0 mr-1 inline-flex items-center gap-0.5 text-[9.5px] mono tabular-nums">
          {changes.additions > 0 ? (
            <span className="text-emerald-700 dark:text-emerald-400">
              +{changes.additions}
            </span>
          ) : null}
          {changes.deletions > 0 ? (
            <span className="text-rose-700 dark:text-rose-400">
              -{changes.deletions}
            </span>
          ) : null}
        </span>
      ) : null}
      {isActive && cls ? (
        <span className="flex items-center gap-1 shrink-0 mr-1">
          <Pen
            className={cn("size-2.5", cls.text, "animate-pulse")}
            aria-hidden
          />
          {line ? (
            <span className="text-[9.5px] mono text-muted-foreground tabular-nums">
              :{line}
            </span>
          ) : null}
          <span
            aria-hidden
            className={cn("size-1.5 rounded-full", cls.dot)}
          />
        </span>
      ) : cls ? (
        <span
          aria-hidden
          className={cn("size-1.5 rounded-full shrink-0 mr-1", cls.dot)}
        />
      ) : touchedByAgentId ? (
        <span
          aria-hidden
          className="size-1.5 rounded-full shrink-0 mr-1 bg-foreground/40"
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
