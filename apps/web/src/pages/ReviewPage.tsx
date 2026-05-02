import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  FileEdit,
  FilePlus,
  FileX,
  MessageSquareReply,
  Replace,
} from "lucide-react";
import type { AdapterManifest, Agent, Run, RunChange } from "@loom/core";
import { api } from "../api/client.js";
import { AgentAvatar } from "../components/Chat.js";
import { PageHeader } from "../components/PageHeader.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { useI18n } from "../context/I18nContext.js";
import { agentColorOf, classesFor } from "../components/agentColor.js";
import { cn } from "../lib/utils.js";
import { formatTimeAgo } from "../lib/timeAgo.js";
import { emit } from "../lib/loomEvents.js";

/**
 * Pulls every recent run that produced file changes and lets the user
 * scan them like a stream of pull requests. Each entry shows the agent,
 * the prompt, the diff, and two ways back into the conversation:
 * "Discuss" (jump to that message in the chat) and "Open" (pop the
 * touched file into the workspace's viewer).
 *
 * loom's model is "agents commit directly," so there's no Apply/Reject
 * here — the work is already done. The value is having one place to
 * see *what* was done across threads and dive into the details.
 */
export function ReviewPage() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();

  const agents = useQuery({
    queryKey: ["agents", { projectId }],
    queryFn: () => api.listAgents({ projectId }),
    enabled: !!projectId,
  });
  const adapters = useQuery({
    queryKey: ["adapters"],
    queryFn: api.listAdapters,
  });
  const runs = useQuery({
    queryKey: ["runs", { projectId, surface: "review" }],
    queryFn: () => api.listRuns({ limit: 50 }),
    enabled: !!projectId,
    refetchInterval: 5000,
  });

  // Scope to the current project's agents.
  const agentIds = useMemo(
    () => new Set((agents.data?.agents ?? []).map((a) => a.id)),
    [agents.data],
  );
  const candidates = useMemo(
    () =>
      (runs.data?.runs ?? [])
        .filter((r) => agentIds.has(r.agentId))
        // Only succeeded runs with a captured before/after — others
        // can't have a meaningful diff for the user to review.
        .filter(
          (r) =>
            r.status === "succeeded" && r.beforeRef && r.afterRef,
        ),
    [runs.data, agentIds],
  );

  // Lazy-fetch change lists for each candidate. The list rows show a
  // "+N −M" summary, so we need this even before a row is selected.
  const changeQueries = useQueries({
    queries: candidates.map((r) => ({
      queryKey: ["run", r.id, "changes"],
      queryFn: () => api.getRunChanges(r.id),
      staleTime: 60_000,
    })),
  });

  const reviewable = useMemo(
    () =>
      candidates
        .map((run, i) => {
          const changes = changeQueries[i]?.data?.changes ?? [];
          return { run, changes };
        })
        .filter((x) => x.changes.length > 0),
    [candidates, changeQueries],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdx = reviewable.findIndex((r) => r.run.id === selectedId);
  const selected =
    selectedIdx >= 0 ? reviewable[selectedIdx]! : reviewable[0] ?? null;

  if (!projectId) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t("activity.requiresProject")}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-6 pt-6 pb-3 max-w-7xl w-full mx-auto">
        <PageHeader
          title={t("review.title")}
          description={t("review.subtitle")}
        />
      </div>

      <div className="flex-1 min-h-0 grid gap-4 px-6 pb-6 max-w-7xl w-full mx-auto md:grid-cols-[280px_1fr]">
        <aside className="rounded-lg border border-border bg-card overflow-hidden flex flex-col min-h-0">
          <div className="px-3 py-2 border-b border-border shrink-0 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("review.pendingCount", { n: reviewable.length })}
            </span>
          </div>
          {runs.isLoading ? (
            <p className="px-3 py-2 text-xs text-muted-foreground italic">
              {t("common.loading")}
            </p>
          ) : reviewable.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground/70 italic">
              {t("review.empty")}
            </p>
          ) : (
            <ul className="flex-1 overflow-y-auto subtle-scrollbar divide-y divide-border/50">
              {reviewable.map(({ run, changes }) => {
                const a = (agents.data?.agents ?? []).find(
                  (x) => x.id === run.agentId,
                );
                const m = a
                  ? (adapters.data?.adapters ?? []).find(
                      (mm) => mm.kind === a.adapterKind,
                    )
                  : undefined;
                return (
                  <li key={run.id}>
                    <ReviewRow
                      run={run}
                      changes={changes}
                      agent={a}
                      manifest={m}
                      active={run.id === selected?.run.id}
                      onSelect={() => setSelectedId(run.id)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <main className="rounded-lg border border-border bg-card overflow-hidden flex flex-col min-h-0">
          {selected ? (
            <ReviewDetail
              run={selected.run}
              changes={selected.changes}
              agents={agents.data?.agents ?? []}
              manifests={adapters.data?.adapters ?? []}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground/70 italic px-6 text-center">
              {reviewable.length === 0
                ? t("review.empty")
                : t("review.pickOne")}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function ReviewRow({
  run,
  changes,
  agent,
  manifest,
  active,
  onSelect,
}: {
  run: Run;
  changes: RunChange[];
  agent: Agent | undefined;
  manifest: AdapterManifest | undefined;
  active: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const cls = agent ? classesFor(agentColorOf(agent)) : null;
  const totals = changes.reduce(
    (acc, c) => ({ add: acc.add + c.additions, del: acc.del + c.deletions }),
    { add: 0, del: 0 },
  );
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full text-left px-3 py-2 transition-colors",
        active ? "bg-foreground/[0.06]" : "hover:bg-muted/50",
      )}
    >
      <div className="flex items-start gap-2">
        {agent ? (
          <AgentAvatar agent={agent} manifest={manifest} size="sm" />
        ) : (
          <span className="size-6 rounded-full bg-muted shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span
              className={cn(
                "text-xs font-semibold truncate",
                cls?.text ?? "text-foreground",
              )}
            >
              @{agent?.name ?? "unknown"}
            </span>
            <span className="text-[10px] text-muted-foreground/70 mono shrink-0">
              {formatTimeAgo(run.createdAt, t)}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2 break-words">
            {run.prompt}
          </p>
          <div className="mt-1 flex items-center gap-2 text-[10px] mono">
            <span className="text-muted-foreground/80">
              {t(
                changes.length === 1
                  ? "review.fileCount.one"
                  : "review.fileCount.many",
                { count: changes.length },
              )}
            </span>
            <span className="text-success">
              +{totals.add}
            </span>
            <span className="text-rose-600 dark:text-rose-400">
              −{totals.del}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

function ReviewDetail({
  run,
  changes,
  agents,
  manifests,
}: {
  run: Run;
  changes: RunChange[];
  agents: Agent[];
  manifests: AdapterManifest[];
}) {
  const { t } = useI18n();
  const agent = agents.find((a) => a.id === run.agentId);
  const manifest = agent
    ? manifests.find((m) => m.kind === agent.adapterKind)
    : undefined;
  const cls = agent ? classesFor(agentColorOf(agent)) : null;
  const totals = changes.reduce(
    (acc, c) => ({ add: acc.add + c.additions, del: acc.del + c.deletions }),
    { add: 0, del: 0 },
  );

  const discuss = () => emit("jumpToRun", { runId: run.id });
  const openFirst = () => {
    const first = changes[0];
    if (!first) return;
    emit("openFile", { path: first.path });
  };

  return (
    <>
      <header className="px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-start gap-3">
          {agent ? (
            <AgentAvatar agent={agent} manifest={manifest} />
          ) : (
            <span className="size-9 rounded-full bg-muted" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span
                className={cn(
                  "text-sm font-semibold",
                  cls?.text ?? "text-foreground",
                )}
              >
                @{agent?.name ?? "unknown"}
              </span>
              <span className="text-xs text-muted-foreground/70 mono">
                {formatTimeAgo(run.createdAt, t)}
              </span>
              <Badge variant="success" className="h-4 px-1.5 text-[9px]">
                {run.status}
              </Badge>
              <span className="text-[11px] text-muted-foreground mono ml-auto">
                {t(
                  changes.length === 1
                    ? "review.fileCount.one"
                    : "review.fileCount.many",
                  { count: changes.length },
                )}
                {" · "}
                <span className="text-success ml-1">
                  +{totals.add}
                </span>
                <span className="text-rose-600 dark:text-rose-400 ml-1">
                  −{totals.del}
                </span>
              </span>
            </div>
            <p className="mt-1 text-sm text-foreground/90 break-words">
              {run.prompt}
            </p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={discuss} className="gap-1.5">
            <MessageSquareReply className="size-3.5" />
            {t("review.discuss")}
          </Button>
          <Button variant="ghost" size="sm" onClick={openFirst} className="gap-1.5">
            <ArrowUpRight className="size-3.5" />
            {t("review.openFirst")}
          </Button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto subtle-scrollbar p-4">
        <ul className="space-y-3">
          {changes.map((c) => (
            <li key={`${c.status}:${c.path}`}>
              <ChangeBlock runId={run.id} change={c} />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function ChangeBlock({ runId, change }: { runId: string; change: RunChange }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const patch = useQuery({
    queryKey: ["run", runId, "patch", change.path],
    queryFn: () => api.getRunPatch(runId, change.path),
    enabled: open,
    staleTime: 60_000,
  });

  const openInViewer = () => emit("openFile", { path: change.path });

  return (
    <div className="rounded-md border border-border/60 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/30">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-left flex-1 min-w-0"
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
          className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        >
          <ArrowUpRight className="size-3" />
        </button>
      </div>
      {open ? (
        <div className="p-2">
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
    </div>
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

