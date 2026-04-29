import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  FileEdit,
  FilePlus,
  FileX,
  Replace,
} from "lucide-react";
import type { RunChange } from "@loom/core";
import { api } from "../api/client.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

/**
 * "What did this run change?" panel that hangs off an agent message.
 * Lazy-loads the change list once (small JSON), then expands per-file
 * unified diffs on demand. Rendered inside the chat — kept compact so it
 * doesn't dominate the conversation, but expressive enough that a quick
 * scan tells you "did this run actually do work, and where?"
 *
 * Hidden entirely when there are no changes (or the cwd isn't a git repo
 * — those produce identical "empty changes" responses on purpose).
 */
export function ChangedFiles({
  runId,
  enabled,
}: {
  runId: string;
  /** Only fetch once the run is finished. While running the diff is a
   *  moving target and the component would flicker. */
  enabled: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const changes = useQuery({
    queryKey: ["run", runId, "changes"],
    queryFn: () => api.getRunChanges(runId),
    enabled,
    staleTime: 60_000,
  });

  if (!enabled || changes.isLoading) return null;
  const list = changes.data?.changes ?? [];
  if (list.length === 0) return null;

  const totals = list.reduce(
    (acc, c) => ({
      add: acc.add + c.additions,
      del: acc.del + c.deletions,
    }),
    { add: 0, del: 0 },
  );

  return (
    <div className="mt-2 rounded-md border bg-muted/20 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 hover:bg-muted/40 transition-colors rounded-md"
      >
        {open ? (
          <ChevronDown className="size-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3 text-muted-foreground" />
        )}
        <FileEdit className="size-3 text-muted-foreground" />
        <span className="font-medium">
          {t("changes.summary", { n: list.length })}
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="text-emerald-600 dark:text-emerald-400 mono">
          +{totals.add}
        </span>
        <span className="text-rose-600 dark:text-rose-400 mono">
          −{totals.del}
        </span>
      </button>
      {open ? (
        <ul className="border-t divide-y divide-border/60">
          {list.map((c) => (
            <FileRow key={`${c.status}:${c.path}`} runId={runId} change={c} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function FileRow({ runId, change }: { runId: string; change: RunChange }) {
  const [open, setOpen] = useState(false);
  const patch = useQuery({
    queryKey: ["run", runId, "patch", change.path],
    queryFn: () => api.getRunPatch(runId, change.path),
    enabled: open,
    staleTime: 60_000,
  });

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 hover:bg-muted/40 transition-colors text-left"
      >
        {open ? (
          <ChevronDown className="size-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="size-3 text-muted-foreground shrink-0" />
        )}
        <StatusIcon status={change.status} />
        <span className="mono truncate flex-1">
          {change.fromPath ? (
            <>
              <span className="text-muted-foreground">{change.fromPath}</span>
              <span className="text-muted-foreground/60"> → </span>
              {change.path}
            </>
          ) : (
            change.path
          )}
        </span>
        <span className="text-emerald-600 dark:text-emerald-400 mono shrink-0">
          +{change.additions}
        </span>
        <span className="text-rose-600 dark:text-rose-400 mono shrink-0">
          −{change.deletions}
        </span>
      </button>
      {open ? (
        <div className="px-2 pb-2">
          {patch.isLoading ? (
            <p className="px-2 py-1 text-muted-foreground italic">…</p>
          ) : patch.isError ? (
            <p className="px-2 py-1 text-destructive">
              {(patch.error as Error)?.message ?? "error"}
            </p>
          ) : (
            <DiffView text={patch.data ?? ""} />
          )}
        </div>
      ) : null}
    </li>
  );
}

function StatusIcon({ status }: { status: RunChange["status"] }) {
  const cls = "size-3 shrink-0";
  switch (status) {
    case "added":
      return (
        <FilePlus className={cn(cls, "text-emerald-600 dark:text-emerald-400")} />
      );
    case "deleted":
      return <FileX className={cn(cls, "text-rose-600 dark:text-rose-400")} />;
    case "renamed":
      return <Replace className={cn(cls, "text-sky-600 dark:text-sky-400")} />;
    case "modified":
    default:
      return <FileEdit className={cn(cls, "text-amber-600 dark:text-amber-400")} />;
  }
}

/**
 * Minimal unified-diff renderer. We strip the `diff --git` / `index` /
 * `+++` / `---` preamble (it's redundant — the file row above already
 * shows the path) and render hunks line-by-line. Lines are colored by
 * their first character: `+` add, `-` del, `@` hunk header, anything
 * else is context.
 */
function DiffView({ text }: { text: string }) {
  // Strip the per-file header. We keep everything from the first hunk
  // marker (`@@`) onward. If there's no hunk marker (e.g. binary patch
  // or rename without content change) fall back to showing a brief note.
  const hunkStart = text.indexOf("\n@@");
  const body = hunkStart >= 0 ? text.slice(hunkStart + 1) : "";
  if (!body.trim()) {
    return (
      <p className="px-2 py-1 text-muted-foreground italic">no text diff</p>
    );
  }
  const lines = body.split("\n");
  return (
    <pre className="overflow-x-auto rounded border bg-background mono text-[11px] leading-relaxed">
      <code className="block">
        {lines.map((line, i) => {
          if (!line) return <span key={i} className="block">&nbsp;</span>;
          const ch = line[0];
          let className = "block px-2 py-px";
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
