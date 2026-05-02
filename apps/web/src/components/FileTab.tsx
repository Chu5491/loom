import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Clock,
  File,
  FileText,
  GitCommit,
  History,
  RotateCcw,
  WrapText,
} from "lucide-react";
import type { AdapterManifest, Agent, FileHistoryEntry } from "@loom/core";
import { api } from "../api/client.js";
import { AdapterIcon } from "./AdapterIcon.js";
import { AgentInitialBadge } from "./AgentInitialBadge.js";
import { Badge } from "./ui/badge.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";
import { formatTimeAgo } from "../lib/timeAgo.js";
import { agentColorFor, classesFor } from "./agentColor.js";

/**
 * Center-pane content shown when a file tab is active in the workspace.
 *
 * Two viewing modes for the same file:
 *
 *   - "current": the file as it lives on disk right now.
 *   - "diff @ run": the unified diff that one specific run produced for
 *     this path. Selected by clicking a row in the history rail.
 *
 * The history rail also offers a per-row "→ chat" button that bubbles up
 * via `onJumpToRun`, so the user can either *inspect the change* (stay
 * in the file context) or *visit the conversation* (switch to chat).
 * Two distinct gestures for two distinct intents.
 */
export function FileTab({
  projectId,
  path,
  activeAgentId,
  activeLine,
  agents,
  onJumpToRun,
  adapterByKind,
}: {
  projectId: string;
  path: string;
  /** Set when an agent is currently editing this file. The viewer
   *  hangs a "X is editing now" banner on top so the user knows the
   *  content under their eyes is in flight. */
  activeAgentId?: string;
  /** Latest line number the active agent has been editing, when the
   *  server could pin one. Surfaces as ":42" in the banner. */
  activeLine?: number;
  agents?: Agent[];
  onJumpToRun: (runId: string) => void;
  /** Map of adapter kind → manifest, used to render correct brand icon
   *  in the history rail. Passed in (not fetched) since the parent
   *  already has the list. */
  adapterByKind: Record<string, AdapterManifest>;
}) {
  // Reset to "current" whenever the active file changes — staying on a
  // diff view across path changes would be confusing.
  type ViewMode = { kind: "current" } | { kind: "diff"; runId: string };
  const [view, setView] = useState<ViewMode>({ kind: "current" });
  const [wrap, setWrap] = useState(false);

  // Switching files: reset view. We key on `path` via a render-time
  // check rather than a useEffect to avoid a flash of "wrong" diff.
  const [lastPath, setLastPath] = useState(path);
  if (lastPath !== path) {
    setLastPath(path);
    if (view.kind !== "current") setView({ kind: "current" });
  }

  const activeAgent = activeAgentId
    ? agents?.find((a) => a.id === activeAgentId)
    : undefined;

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      {activeAgent ? (
        <EditingNowBanner agent={activeAgent} line={activeLine} />
      ) : null}
      <ContentPane
        projectId={projectId}
        path={path}
        view={view}
        wrap={wrap}
        activeLine={activeLine}
        onToggleWrap={() => setWrap((v) => !v)}
        onResetView={() => setView({ kind: "current" })}
        onSelectDiff={(runId) => setView({ kind: "diff", runId })}
        onJumpToRun={onJumpToRun}
        activeRunId={view.kind === "diff" ? view.runId : null}
        adapterByKind={adapterByKind}
      />
    </div>
  );
}

/** Sticky "@agent is editing this right now" banner pinned to the top
 *  of the file viewer. When the server could pin the edit to a line
 *  (claude-code's old_string matched), we show ":42" so the user knows
 *  exactly *where* in the file the change is landing. */
function EditingNowBanner({ agent, line }: { agent: Agent; line?: number }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/40 shrink-0">
      <AgentInitialBadge agent={agent} live size="sm" />
      <span className="text-xs">
        <span className="font-semibold">@{agent.name}</span>
        <span className="text-muted-foreground ml-1.5">{t("editing.is")}</span>
        {line ? (
          <span className="ml-1 mono text-foreground/80">
            {t("editing.line")} <span className="font-semibold">{line}</span>
          </span>
        ) : (
          <span className="text-muted-foreground ml-1">{t("editing.now")}</span>
        )}
      </span>
      <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-success mono">
        <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
        {t("editing.live")}
      </span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Content pane — renders one of two modes
// ────────────────────────────────────────────────────────────────────────────

function ContentPane({
  projectId,
  path,
  view,
  wrap,
  activeLine,
  onToggleWrap,
  onResetView,
  onSelectDiff,
  onJumpToRun,
  activeRunId,
  adapterByKind,
}: {
  projectId: string;
  path: string;
  view: { kind: "current" } | { kind: "diff"; runId: string };
  wrap: boolean;
  activeLine?: number;
  onToggleWrap: () => void;
  onResetView: () => void;
  onSelectDiff: (runId: string) => void;
  onJumpToRun: (runId: string) => void;
  activeRunId: string | null;
  adapterByKind: Record<string, AdapterManifest>;
}) {
  return (
    <section className="flex-1 min-w-0 min-h-0 flex flex-col">
      <PaneHeader
        projectId={projectId}
        path={path}
        view={view}
        wrap={wrap}
        onToggleWrap={onToggleWrap}
        onResetView={onResetView}
        onSelectDiff={onSelectDiff}
        onJumpToRun={onJumpToRun}
        activeRunId={activeRunId}
        adapterByKind={adapterByKind}
      />
      {/* Both axes scroll with a visible thumb so the user knows the
       *  content extends — `subtle-scrollbar` was hiding even the
       *  needed horizontal bar when long lines didn't wrap. */}
      <div className="flex-1 min-h-0 min-w-0 overflow-auto">
        {view.kind === "current" ? (
          <CurrentContent
            projectId={projectId}
            path={path}
            wrap={wrap}
            activeLine={activeLine}
          />
        ) : (
          <DiffContent path={path} runId={view.runId} wrap={wrap} />
        )}
      </div>
    </section>
  );
}

function PaneHeader({
  projectId,
  path,
  view,
  wrap,
  onToggleWrap,
  onResetView,
  onSelectDiff,
  onJumpToRun,
  activeRunId,
  adapterByKind,
}: {
  projectId: string;
  path: string;
  view: { kind: "current" } | { kind: "diff"; runId: string };
  wrap: boolean;
  onToggleWrap: () => void;
  onResetView: () => void;
  onSelectDiff: (runId: string) => void;
  onJumpToRun: (runId: string) => void;
  activeRunId: string | null;
  adapterByKind: Record<string, AdapterManifest>;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between px-5 py-2 border-b shrink-0 bg-muted/20">
      <div className="min-w-0 flex items-center gap-2">
        {view.kind === "diff" ? (
          <GitCommit className="size-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
        ) : (
          <FileText className="size-3.5 text-muted-foreground shrink-0" />
        )}
        <span className="text-sm mono truncate" title={path}>
          {path}
        </span>
        {view.kind === "diff" ? (
          <Badge variant="info" className="h-4 px-1.5 text-[9px] shrink-0">
            {t("files.viewer.diffMode")}
          </Badge>
        ) : null}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onToggleWrap}
          title={
            wrap
              ? t("files.viewer.wrapOff")
              : t("files.viewer.wrapOn")
          }
          aria-label={
            wrap
              ? t("files.viewer.wrapOff")
              : t("files.viewer.wrapOn")
          }
          aria-pressed={wrap}
          className={cn(
            "inline-flex items-center gap-1 px-2 h-6 rounded text-[11px] transition-colors",
            wrap
              ? "bg-foreground/5 text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted",
          )}
        >
          <WrapText className="size-3" />
          <span>{t("files.viewer.wrap")}</span>
        </button>
        {view.kind === "diff" ? (
          <button
            type="button"
            onClick={onResetView}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2 h-6 rounded hover:bg-muted"
            title={t("files.viewer.showCurrent")}
          >
            <RotateCcw className="size-3" />
            {t("files.viewer.showCurrent")}
          </button>
        ) : null}
        <FileHistoryPopover
          projectId={projectId}
          path={path}
          activeRunId={activeRunId}
          onSelectDiff={onSelectDiff}
          onJumpToRun={onJumpToRun}
          adapterByKind={adapterByKind}
        />
      </div>
    </div>
  );
}

function CurrentContent({
  projectId,
  path,
  wrap,
  activeLine,
}: {
  projectId: string;
  path: string;
  wrap: boolean;
  activeLine?: number;
}) {
  const { t } = useI18n();
  const file = useQuery({
    queryKey: ["projectFile", projectId, path],
    queryFn: () => api.getProjectFile(projectId, path),
    staleTime: 30_000,
    // Re-fetch every 1.5s while an agent is editing so the viewer keeps
    // pace with the live edit. The line gutter / active highlight only
    // move when the file is actually re-read; without this the viewer
    // shows stale text under a "live" badge.
    refetchInterval: activeLine ? 1500 : false,
  });
  if (file.isLoading) {
    return (
      <div className="px-5 py-4 text-sm text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }
  if (file.isError) {
    return <FileError error={(file.error as Error).message} />;
  }
  if (file.data?.file.text === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground gap-2">
        <File className="size-4" />
        {t("files.viewer.binary")}
      </div>
    );
  }
  return (
    <CodeView
      text={file.data?.file.text ?? ""}
      wrap={wrap}
      activeLine={activeLine}
    />
  );
}

/** Read-only code view with a line-number gutter and an active-line
 *  highlight. Looks like a pared-down editor so users intuit "I can
 *  see exactly where the agent is working" without thinking it's
 *  editable. We render plain divs (not a textarea / contentEditable)
 *  so there's no chance of accidental edits. */
function CodeView({
  text,
  wrap,
  activeLine,
}: {
  text: string;
  wrap: boolean;
  activeLine?: number;
}) {
  const lines = text.split("\n");
  // Drop a trailing empty line that splitting on a final "\n" creates,
  // so the gutter doesn't show a phantom number under the last line.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();

  // Right-align the gutter to the widest line number — keeps the
  // numbers visually anchored even on big files.
  const gutterDigits = String(lines.length).length;
  const gutterChars = Math.max(2, gutterDigits);

  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!activeLine) return;
    activeRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [activeLine]);

  return (
    <div className="mono text-[12px] leading-relaxed py-2">
      {lines.map((raw, i) => {
        const ln = i + 1;
        const isActive = ln === activeLine;
        return (
          <div
            key={i}
            ref={isActive ? activeRef : undefined}
            className={cn(
              "flex items-stretch group",
              isActive &&
                "bg-amber-500/15 dark:bg-amber-500/10 ring-1 ring-amber-500/30",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "select-none shrink-0 text-right pr-3 pl-4 text-muted-foreground/60 tabular-nums border-r border-border/40",
                isActive && "text-warning font-semibold",
              )}
              style={{ minWidth: `${gutterChars + 1}ch` }}
            >
              {ln}
            </span>
            <span
              className={cn(
                "flex-1 pl-4 pr-5",
                wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
              )}
            >
              {raw}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DiffContent({
  path,
  runId,
  wrap,
}: {
  path: string;
  runId: string;
  wrap: boolean;
}) {
  const { t } = useI18n();
  // Re-uses the existing per-run-per-file patch endpoint — the same
  // bytes that ChangedFiles in chat shows, just reached from the file
  // side instead of the message side.
  const patch = useQuery({
    queryKey: ["run", runId, "patch", path],
    queryFn: () => api.getRunPatch(runId, path),
    staleTime: 60_000,
  });
  if (patch.isLoading) {
    return (
      <div className="px-5 py-4 text-sm text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }
  if (patch.isError) {
    return (
      <div className="px-5 py-4 text-sm text-destructive">
        {(patch.error as Error).message}
      </div>
    );
  }
  // Skip the per-file `diff --git ...` preamble — the pane header above
  // already shows the path + a diff badge, so the preamble is just noise.
  const text = patch.data ?? "";
  const hunkStart = text.indexOf("\n@@");
  const body = hunkStart >= 0 ? text.slice(hunkStart + 1) : "";
  if (!body.trim()) {
    return (
      <p className="px-5 py-4 text-sm text-muted-foreground italic">
        {t("files.viewer.noTextDiff")}
      </p>
    );
  }
  const lines = body.split("\n");
  return (
    <pre
      className={cn(
        "px-2 py-2 mono text-[12px] leading-relaxed",
        wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
      )}
    >
      <code className="block">
        {lines.map((line, i) => {
          if (!line) return <span key={i} className="block">&nbsp;</span>;
          const ch = line[0];
          let className = "block px-3 py-px";
          if (ch === "+") {
            className +=
              " bg-emerald-500/10 text-success";
          } else if (ch === "-") {
            className += " bg-rose-500/10 text-rose-700 dark:text-rose-300";
          } else if (ch === "@") {
            className += " bg-sky-500/10 text-sky-700 dark:text-sky-300";
          } else {
            className += " text-muted-foreground";
          }
          return (
            <span key={i} className={className}>
              {line || " "}
            </span>
          );
        })}
      </code>
    </pre>
  );
}

function FileError({ error }: { error: string }) {
  const { t } = useI18n();
  const message = error.includes("too_large")
    ? t("files.viewer.tooLarge")
    : error.includes("not_found")
      ? t("files.viewer.notFound")
      : error;
  return <div className="px-5 py-4 text-sm text-destructive">{message}</div>;
}

// ────────────────────────────────────────────────────────────────────────────
// History popover (button on the file pane header)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Replaces the old always-visible right-side history rail. Now lives
 * behind a `📜` button on the file pane header — most of the time
 * the user just wants to read the file, so the runs that touched it
 * shouldn't eat 30% of the horizontal real estate. One click brings
 * the same content forward when needed.
 */
function FileHistoryPopover({
  projectId,
  path,
  activeRunId,
  onSelectDiff,
  onJumpToRun,
  adapterByKind,
}: {
  projectId: string;
  path: string;
  activeRunId: string | null;
  onSelectDiff: (runId: string) => void;
  onJumpToRun: (runId: string) => void;
  adapterByKind: Record<string, AdapterManifest>;
}) {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ["fileHistory", projectId, path],
    queryFn: () => api.getProjectFileHistory(projectId, path),
    staleTime: 30_000,
  });
  const entries = q.data?.entries ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 px-2 h-6 rounded text-[11px] transition-colors",
            entries.length > 0
              ? "text-foreground hover:bg-muted"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
          title={t("files.history.title")}
          aria-label={t("files.history.title")}
        >
          <History className="size-3" />
          <span>{t("files.history.title")}</span>
          {entries.length > 0 ? (
            <span className="text-[10px] text-muted-foreground/70 mono ml-0.5">
              {entries.length}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-80 max-h-[60vh] overflow-y-auto subtle-scrollbar p-0"
      >
        <div className="flex items-center gap-1.5 px-3 py-2 border-b sticky top-0 bg-popover">
          <Clock className="size-3 text-muted-foreground" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("files.history.title")}
          </span>
        </div>
        {q.isLoading ? (
          <p className="px-3 py-4 text-xs text-muted-foreground italic">…</p>
        ) : entries.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground/70 italic">
            {t("files.history.empty")}
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {entries.map((e) => (
              <HistoryRow
                key={e.runId}
                entry={e}
                isActive={activeRunId === e.runId}
                onSelectDiff={() => onSelectDiff(e.runId)}
                onJumpToRun={() => onJumpToRun(e.runId)}
                adapterByKind={adapterByKind}
              />
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HistoryRow({
  entry,
  isActive,
  onSelectDiff,
  onJumpToRun,
  adapterByKind,
}: {
  entry: FileHistoryEntry;
  isActive: boolean;
  onSelectDiff: () => void;
  onJumpToRun: () => void;
  adapterByKind: Record<string, AdapterManifest>;
}) {
  const { t } = useI18n();
  const cls = classesFor(agentColorFor(entry.agentId));
  const manifest = entry.adapterKind
    ? adapterByKind[entry.adapterKind]
    : undefined;
  return (
    <li
      className={cn(
        "group relative",
        isActive && "bg-sky-500/10",
      )}
    >
      <button
        type="button"
        onClick={onSelectDiff}
        className={cn(
          "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors",
          isActive ? "" : "hover:bg-muted/40",
        )}
        title={t("files.history.viewDiff")}
      >
        {manifest ? (
          <AdapterIcon manifest={manifest} size={20} />
        ) : (
          <span className="size-5 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cn("text-xs font-medium truncate", cls.text)}>
              @{entry.agentName ?? entry.agentId.slice(0, 6)}
            </span>
            <Badge
              variant={statusVariant(entry.status)}
              className="h-3.5 px-1 text-[9px]"
            >
              {entry.status}
            </Badge>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] mono">
            <span className="text-success">
              +{entry.additions}
            </span>
            <span className="text-rose-600 dark:text-rose-400">
              −{entry.deletions}
            </span>
            <span className="text-muted-foreground/60 ml-auto">
              {formatTimeAgo(entry.createdAt, t)}
            </span>
          </div>
        </div>
      </button>
      {/* Secondary action — jump to the chat message for this run.
       *  Hidden until row hover so the primary "view diff" action stays
       *  the obvious one. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onJumpToRun();
        }}
        title={t("files.history.jumpToChat")}
        aria-label={t("files.history.jumpToChat")}
        className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex size-6 items-center justify-center rounded-md bg-background border opacity-0 group-hover:opacity-100 hover:bg-muted text-muted-foreground hover:text-foreground transition-opacity"
      >
        <ArrowRight className="size-3" />
      </button>
    </li>
  );
}

function statusVariant(
  s: FileHistoryEntry["status"],
): "info" | "success" | "destructive" | "warning" | "secondary" {
  switch (s) {
    case "added":
      return "success";
    case "deleted":
      return "destructive";
    case "renamed":
      return "warning";
    case "modified":
    default:
      return "info";
  }
}

