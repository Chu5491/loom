import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Clock,
  File,
  FileText,
  GitCommit,
  RotateCcw,
} from "lucide-react";
import type { AdapterManifest, FileHistoryEntry } from "@loom/core";
import { api } from "../api/client.js";
import { AdapterIcon } from "./AdapterIcon.js";
import { Badge } from "./ui/badge.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";
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
  onJumpToRun,
  adapterByKind,
}: {
  projectId: string;
  path: string;
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

  // Switching files: reset view. We key on `path` via a render-time
  // check rather than a useEffect to avoid a flash of "wrong" diff.
  const [lastPath, setLastPath] = useState(path);
  if (lastPath !== path) {
    setLastPath(path);
    if (view.kind !== "current") setView({ kind: "current" });
  }

  return (
    <div className="flex h-full min-h-0">
      <ContentPane
        projectId={projectId}
        path={path}
        view={view}
        onResetView={() => setView({ kind: "current" })}
      />
      <FileHistoryRail
        projectId={projectId}
        path={path}
        activeRunId={view.kind === "diff" ? view.runId : null}
        onSelectDiff={(runId) => setView({ kind: "diff", runId })}
        onJumpToRun={onJumpToRun}
        adapterByKind={adapterByKind}
      />
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
  onResetView,
}: {
  projectId: string;
  path: string;
  view: { kind: "current" } | { kind: "diff"; runId: string };
  onResetView: () => void;
}) {
  return (
    <section className="flex-1 min-w-0 flex flex-col">
      <PaneHeader path={path} view={view} onResetView={onResetView} />
      <div className="flex-1 min-h-0 overflow-auto">
        {view.kind === "current" ? (
          <CurrentContent projectId={projectId} path={path} />
        ) : (
          <DiffContent path={path} runId={view.runId} />
        )}
      </div>
    </section>
  );
}

function PaneHeader({
  path,
  view,
  onResetView,
}: {
  path: string;
  view: { kind: "current" } | { kind: "diff"; runId: string };
  onResetView: () => void;
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
      {view.kind === "diff" ? (
        <button
          type="button"
          onClick={onResetView}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          title={t("files.viewer.showCurrent")}
        >
          <RotateCcw className="size-3" />
          {t("files.viewer.showCurrent")}
        </button>
      ) : null}
    </div>
  );
}

function CurrentContent({
  projectId,
  path,
}: {
  projectId: string;
  path: string;
}) {
  const { t } = useI18n();
  const file = useQuery({
    queryKey: ["projectFile", projectId, path],
    queryFn: () => api.getProjectFile(projectId, path),
    staleTime: 30_000,
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
    <pre className="px-5 py-3 mono text-[12px] leading-relaxed whitespace-pre">
      <code>{file.data?.file.text ?? ""}</code>
    </pre>
  );
}

function DiffContent({
  path,
  runId,
}: {
  path: string;
  runId: string;
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
    <pre className="px-2 py-2 mono text-[12px] leading-relaxed">
      <code className="block">
        {lines.map((line, i) => {
          if (!line) return <span key={i} className="block">&nbsp;</span>;
          const ch = line[0];
          let className = "block px-3 py-px";
          if (ch === "+") {
            className +=
              " bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
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
// History rail (right side of the file tab)
// ────────────────────────────────────────────────────────────────────────────

function FileHistoryRail({
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
    <aside className="hidden lg:flex w-72 shrink-0 flex-col border-l bg-muted/10">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b shrink-0">
        <Clock className="size-3 text-muted-foreground" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("files.history.title")}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground/70 mono">
          {entries.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
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
      </div>
    </aside>
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
            <span className="text-emerald-600 dark:text-emerald-400">
              +{entry.additions}
            </span>
            <span className="text-rose-600 dark:text-rose-400">
              −{entry.deletions}
            </span>
            <span className="text-muted-foreground/60 ml-auto">
              {timeAgo(entry.createdAt)}
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

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
