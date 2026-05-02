import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
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
import { emit } from "../lib/loomEvents.js";

/**
 * Action card hanging off an agent message — surfaces what the run
 * actually did to the working tree. Auto-expands for small change sets
 * so a typical "edited 1–2 files" agent reply doesn't hide its work
 * behind an extra click. Each file row has an "open" affordance that
 * pops the file into the right-side viewer for a closer look.
 *
 * Hidden when the run produced no changes (or the cwd isn't a git repo).
 */
export function ChangedFiles({
  runId,
  enabled,
}: {
  runId: string;
  /** Wait until the run is finished — mid-run the diff is a moving target. */
  enabled: boolean;
}) {
  const { t } = useI18n();

  const changes = useQuery({
    queryKey: ["run", runId, "changes"],
    queryFn: () => api.getRunChanges(runId),
    enabled,
    staleTime: 60_000,
  });

  const list = changes.data?.changes ?? [];
  // Default-open for small change sets (≤3) so the user sees the work
  // without hunting for a chevron. Larger sets stay collapsed to keep
  // the chat scannable.
  const [open, setOpen] = useState<boolean | null>(null);
  const isOpen = open ?? (list.length > 0 && list.length <= 3);

  if (!enabled || changes.isLoading) return null;
  if (list.length === 0) return null;

  const totals = list.reduce(
    (acc, c) => ({
      add: acc.add + c.additions,
      del: acc.del + c.deletions,
    }),
    { add: 0, del: 0 },
  );

  const openFirst = () => {
    const first = list[0];
    if (!first) return;
    emit("openFile", { path: first.path });
  };

  return (
    <div className="mt-2 rounded-md border border-border/80 bg-muted/30 overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button
          type="button"
          onClick={() => setOpen(!isOpen)}
          className="flex items-center gap-1.5 text-xs text-foreground/90 hover:text-foreground"
        >
          {isOpen ? (
            <ChevronDown className="size-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3 text-muted-foreground" />
          )}
          <FileEdit className="size-3 text-muted-foreground" />
          <span className="font-medium">
            {t("changes.summary", { n: list.length })}
          </span>
        </button>
        <span className="text-success mono text-xs">
          +{totals.add}
        </span>
        <span className="text-rose-600 dark:text-rose-400 mono text-xs">
          −{totals.del}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={openFirst}
            className="inline-flex items-center gap-1 px-1.5 h-5 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title={t("changes.openFirst", { path: list[0]?.path ?? "" })}
          >
            <ArrowUpRight className="size-3" />
            <span>{t("changes.openInViewer")}</span>
          </button>
        </div>
      </div>
      {isOpen ? (
        <ul className="border-t border-border/60 divide-y divide-border/40 bg-background/40">
          {list.map((c) => (
            <FileRow key={`${c.status}:${c.path}`} runId={runId} change={c} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function FileRow({ runId, change }: { runId: string; change: RunChange }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const patch = useQuery({
    queryKey: ["run", runId, "patch", change.path],
    queryFn: () => api.getRunPatch(runId, change.path),
    enabled: open,
    staleTime: 60_000,
  });

  const openInViewer = (e: React.MouseEvent) => {
    e.stopPropagation();
    emit("openFile", { path: change.path });
  };

  return (
    <li>
      <div className="group flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted/30 transition-colors">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          {open ? (
            <ChevronDown className="size-3 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="size-3 text-muted-foreground shrink-0" />
          )}
          <StatusIcon status={change.status} />
          <span className="mono text-xs truncate">
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
        </button>
        <span className="text-success mono text-xs shrink-0">
          +{change.additions}
        </span>
        <span className="text-rose-600 dark:text-rose-400 mono text-xs shrink-0">
          −{change.deletions}
        </span>
        <button
          type="button"
          onClick={openInViewer}
          title={t("changes.openInViewer")}
          aria-label={t("changes.openInViewer")}
          className="inline-flex size-5 items-center justify-center rounded text-muted-foreground/0 group-hover:text-muted-foreground hover:!text-foreground hover:bg-muted transition-colors"
        >
          <ArrowUpRight className="size-3" />
        </button>
      </div>
      {open ? (
        <div className="px-2 pb-2">
          {patch.isLoading ? (
            <p className="px-2 py-1 text-xs text-muted-foreground italic">…</p>
          ) : patch.isError ? (
            <p className="px-2 py-1 text-xs text-destructive">
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
        <FilePlus className={cn(cls, "text-success")} />
      );
    case "deleted":
      return <FileX className={cn(cls, "text-rose-600 dark:text-rose-400")} />;
    case "renamed":
      return <Replace className={cn(cls, "text-sky-600 dark:text-sky-400")} />;
    case "modified":
    default:
      return <FileEdit className={cn(cls, "text-warning")} />;
  }
}

/** Strip the per-file `diff --git` preamble (path is already in the row
 *  above) and color lines by their first character. */
function DiffView({ text }: { text: string }) {
  const { t } = useI18n();
  const hunkStart = text.indexOf("\n@@");
  const body = hunkStart >= 0 ? text.slice(hunkStart + 1) : "";
  if (!body.trim()) {
    return (
      <p className="px-2 py-1 text-xs text-muted-foreground italic">
        {t("review.noTextDiff")}
      </p>
    );
  }
  const lines = body.split("\n");
  return (
    <pre className="overflow-x-auto rounded border border-border/60 bg-background mono text-[11px] leading-relaxed">
      <code className="block">
        {lines.map((line, i) => {
          if (!line) return <span key={i} className="block">&nbsp;</span>;
          const ch = line[0];
          let className = "block px-2 py-px";
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
