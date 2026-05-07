// 두 run 의 결과를 나란히 비교 — A/B 테스트 (다른 agent / 같은 task) 후
// "어느 쪽 결과가 나은지" 가르는 데 쓰임.
//
// 각 run 의 metadata + 변경 파일 목록 + 선택 파일 diff 를 좌우 두 열로.
// route: /projects/:id/runs/compare?a=<runIdA>&b=<runIdB>

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { GitCompare } from "lucide-react";
import type { Agent, Run, RunChange } from "@loom/core";
import { api } from "../api/client.js";
import { Badge } from "../components/ui/badge.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { PageScroll } from "../components/PageScroll.js";
import { PageHeader } from "../components/PageHeader.js";
import { DiffView } from "../components/git/DiffView.js";
import { StatusBadge } from "../components/git/StatusBadge.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";
import { agentColorOf, classesFor } from "../components/agentColor.js";
import { basename } from "../lib/path.js";
import { runStatusVariant, elapsedSecs } from "../lib/runStatus.js";

export function RunComparePage() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const aId = params.get("a") ?? "";
  const bId = params.get("b") ?? "";

  const a = useQuery({
    queryKey: ["run", aId],
    queryFn: () => api.getRun(aId),
    enabled: !!aId,
  });
  const b = useQuery({
    queryKey: ["run", bId],
    queryFn: () => api.getRun(bId),
    enabled: !!bId,
  });

  const aChanges = useQuery({
    queryKey: ["runChanges", aId],
    queryFn: () => api.getRunChanges(aId),
    enabled: !!aId,
  });
  const bChanges = useQuery({
    queryKey: ["runChanges", bId],
    queryFn: () => api.getRunChanges(bId),
    enabled: !!bId,
  });

  const agents = useQuery({
    queryKey: ["agents", { projectId }],
    queryFn: () => api.listAgents({ projectId }),
    enabled: !!projectId,
  });

  // 두 run 의 변경 파일 union — 한쪽에만 있는 파일도 표시.
  const merged = useMemo(() => {
    const map = new Map<
      string,
      { path: string; a: RunChange | null; b: RunChange | null }
    >();
    for (const c of aChanges.data?.changes ?? []) {
      map.set(c.path, { path: c.path, a: c, b: null });
    }
    for (const c of bChanges.data?.changes ?? []) {
      const cur = map.get(c.path);
      if (cur) cur.b = c;
      else map.set(c.path, { path: c.path, a: null, b: c });
    }
    return [...map.values()].sort((x, y) => x.path.localeCompare(y.path));
  }, [aChanges.data, bChanges.data]);

  const [pickedPath, setPickedPath] = useState<string | null>(null);

  // 둘 다 로드되면 첫 파일 자동 선택 — 화면이 텅 빈 채로 시작 안 함.
  useEffect(() => {
    if (merged.length > 0 && !pickedPath) {
      setPickedPath(merged[0]!.path);
    }
  }, [merged, pickedPath]);

  if (!aId || !bId) {
    return (
      <PageScroll>
        <p className="text-sm text-destructive">
          {t("compare.missingIds")}
        </p>
      </PageScroll>
    );
  }

  const aRun = a.data?.run;
  const bRun = b.data?.run;
  const aAgent = agents.data?.agents.find((g) => g.id === aRun?.agentId);
  const bAgent = agents.data?.agents.find((g) => g.id === bRun?.agentId);

  const backHref = projectId ? `/projects/${projectId}/runs` : "/";

  return (
    <PageScroll className="space-y-4">
      <PageHeader
        title={t("compare.title")}
        description={t("compare.description")}
        action={
          <Link
            to={backHref}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {t("compare.backToRuns")}
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3">
        <RunSummaryCard run={aRun} agent={aAgent} side="a" />
        <RunSummaryCard run={bRun} agent={bAgent} side="b" />
      </div>

      <section className="rounded-lg border border-border bg-card overflow-hidden">
        <h2 className="text-sm font-semibold px-3 pt-2.5 pb-2 flex items-center gap-2">
          <GitCompare className="size-3.5 text-muted-foreground" />
          {t("compare.changedFiles")}
          <span className="text-[11px] text-muted-foreground/70 mono">
            {merged.length}
          </span>
        </h2>
        {aChanges.isLoading || bChanges.isLoading ? (
          <div className="px-3 pb-3 space-y-1">
            <Skeleton className="h-7" />
            <Skeleton className="h-7" />
            <Skeleton className="h-7" />
          </div>
        ) : merged.length === 0 ? (
          <p className="px-3 pb-3 text-xs text-muted-foreground/70 italic">
            {t("compare.noChanges")}
          </p>
        ) : (
          <ul>
            {merged.map((m) => (
              <FileMergeRow
                key={m.path}
                row={m}
                selected={pickedPath === m.path}
                onSelect={() => setPickedPath(m.path)}
              />
            ))}
          </ul>
        )}
      </section>

      {pickedPath ? (
        <div className="grid grid-cols-2 gap-3">
          <RunFileDiffCard
            runId={aId}
            path={pickedPath}
            present={!!merged.find((m) => m.path === pickedPath)?.a}
            label={t("compare.runA")}
          />
          <RunFileDiffCard
            runId={bId}
            path={pickedPath}
            present={!!merged.find((m) => m.path === pickedPath)?.b}
            label={t("compare.runB")}
          />
        </div>
      ) : null}
    </PageScroll>
  );
}

// ─── Run summary card (per side) ──────────────────────────────────────────

function RunSummaryCard({
  run,
  agent,
  side,
}: {
  run: Run | undefined;
  agent: Agent | undefined;
  side: "a" | "b";
}) {
  const { t } = useI18n();
  if (!run) {
    return <Skeleton className="h-32 rounded-lg" />;
  }
  const cls = agent ? classesFor(agentColorOf(agent)) : null;
  const dur =
    run.startedAt && run.endedAt
      ? Math.round(
          (new Date(run.endedAt).getTime() -
            new Date(run.startedAt).getTime()) /
            1000,
        )
      : null;
  const elapsed = dur ?? elapsedSecs(run);
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold",
            side === "a"
              ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
              : "bg-violet-500/15 text-violet-700 dark:text-violet-300",
          )}
        >
          {t(side === "a" ? "compare.runA" : "compare.runB")}
        </span>
        <Badge variant={runStatusVariant(run.status)}>
          {t(`status.${run.status}`)}
        </Badge>
        {run.exitCode !== null ? (
          <span className="text-[11px] mono text-muted-foreground">
            exit {run.exitCode}
          </span>
        ) : null}
        <span className="ml-auto mono text-[10px] text-muted-foreground/60">
          {run.id.slice(0, 8)}
        </span>
      </div>
      {agent && cls ? (
        <div className="mt-2 flex items-baseline gap-2">
          <span className={cn("font-semibold", cls.text)}>@{agent.name}</span>
          <span className="text-[11px] text-muted-foreground/80 mono">
            {agent.adapterKind}
          </span>
        </div>
      ) : null}
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums">
        <span>
          {run.costUsd !== null ? `$${run.costUsd.toFixed(3)}` : "—"}
        </span>
        <span>·</span>
        <span>
          {elapsed !== null ? `${elapsed}s` : "—"}
        </span>
      </div>
    </div>
  );
}

// ─── File merge row ───────────────────────────────────────────────────────

function FileMergeRow({
  row,
  selected,
  onSelect,
}: {
  row: { path: string; a: RunChange | null; b: RunChange | null };
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li
      onClick={onSelect}
      className={cn(
        "border-t border-border/40 px-3 py-1.5 cursor-pointer transition-colors text-xs mono",
        selected ? "bg-foreground/[0.08]" : "hover:bg-muted/30",
      )}
      title={row.path}
    >
      <div className="flex items-center gap-2">
        <SidePill side="a" change={row.a} />
        <SidePill side="b" change={row.b} />
        <span className="truncate font-medium ml-1">{basename(row.path)}</span>
        <span className="text-muted-foreground/60 truncate text-[10px]">
          {row.path !== basename(row.path)
            ? row.path.slice(0, row.path.length - basename(row.path).length - 1)
            : ""}
        </span>
        <span className="ml-auto flex items-center gap-2 shrink-0 text-[10px] text-muted-foreground/80">
          {row.a ? (
            <span>
              <span className="text-emerald-600 dark:text-emerald-400">
                +{row.a.additions}
              </span>{" "}
              <span className="text-rose-600 dark:text-rose-400">
                −{row.a.deletions}
              </span>
            </span>
          ) : (
            <span className="opacity-50">—</span>
          )}
          <span className="text-muted-foreground/30">|</span>
          {row.b ? (
            <span>
              <span className="text-emerald-600 dark:text-emerald-400">
                +{row.b.additions}
              </span>{" "}
              <span className="text-rose-600 dark:text-rose-400">
                −{row.b.deletions}
              </span>
            </span>
          ) : (
            <span className="opacity-50">—</span>
          )}
        </span>
      </div>
    </li>
  );
}

function SidePill({
  side,
  change,
}: {
  side: "a" | "b";
  change: RunChange | null;
}) {
  if (!change) {
    return (
      <span
        className={cn(
          "inline-flex size-4 items-center justify-center rounded text-[8px] mono uppercase",
          "bg-muted/50 text-muted-foreground/50",
        )}
        title={`${side.toUpperCase()}: untouched`}
      >
        {side}
      </span>
    );
  }
  const code =
    change.status === "added"
      ? "A"
      : change.status === "deleted"
        ? "D"
        : change.status === "renamed"
          ? "R"
          : "M";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] mono uppercase",
        side === "a"
          ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
          : "bg-violet-500/15 text-violet-700 dark:text-violet-300",
      )}
      title={`${side.toUpperCase()}: ${change.status}`}
    >
      {side}
      <StatusBadge code={code} />
    </span>
  );
}

// ─── per-run file diff (right-side cards) ─────────────────────────────────

function RunFileDiffCard({
  runId,
  path,
  present,
  label,
}: {
  runId: string;
  path: string;
  present: boolean;
  label: string;
}) {
  const { t } = useI18n();
  const patch = useQuery({
    queryKey: ["runPatch", runId, path],
    queryFn: () => api.getRunPatch(runId, path),
    enabled: present,
    retry: false,
  });
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 px-3 h-8 border-b border-border/50 bg-muted/30">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
          {label}
        </span>
        <span className="mono text-[11px] truncate">{path}</span>
      </div>
      <div className="max-h-[60vh] overflow-auto">
        {!present ? (
          <p className="px-3 py-4 text-xs text-muted-foreground/70 italic">
            {t("compare.notTouched")}
          </p>
        ) : patch.isLoading ? (
          <p className="px-3 py-4 text-xs text-muted-foreground italic">
            {t("common.loading")}
          </p>
        ) : patch.isError ? (
          <p className="px-3 py-4 text-xs text-destructive">
            {(patch.error as Error).message}
          </p>
        ) : (
          <DiffView text={patch.data ?? ""} />
        )}
      </div>
    </div>
  );
}
