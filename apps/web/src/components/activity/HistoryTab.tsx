// 사이드 패널 — run 시간순 목록.
//
// 이전엔 History (전체) 와 Review (변경 만든 succeeded) 가 따로 있었지만,
// 둘은 같은 데이터의 다른 필터에 불과해 단일 탭으로 합침. 필터 칩으로 모드를
// 전환:
//   [All]      모든 status — 디버깅/감사용
//   [Changes]  succeeded + 변경 있음 — PR 리뷰 모드
//   [Failed]   failed/cancelled — 무엇이 깨졌나
//
// 클릭 시 RunDetailPage 로 — 거기서 로그 + 변경 파일 review + Rollback /
// Replay / Compare 액션이 한 곳에 다 있어서 사이드 탭은 list 만 책임.

import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ChevronRight, Clock } from "lucide-react";
import { api } from "../../api/client.js";
import { AdapterIcon } from "../AdapterIcon.js";
import { Badge } from "../ui/badge.js";
import { useI18n } from "../../context/I18nContext.js";
import { runStatusVariant } from "../../lib/runStatus.js";
import { formatTimeAgo } from "../../lib/timeAgo.js";
import { useAutoAnimate } from "../../lib/useAutoAnimate.js";
import { cn } from "../../lib/utils.js";
import {
  ListSkeleton,
  ManageFooter,
  NoProjectState,
  PanelHeader,
} from "./shared.js";

type Filter = "all" | "changes" | "failed";

export function HistoryTab() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();
  const [filter, setFilter] = useState<Filter>("all");

  const runs = useQuery({
    queryKey: ["runs", { projectId, panel: "history" }],
    queryFn: () => api.listRuns({ limit: 100 }),
    enabled: !!projectId,
    refetchInterval: 5000,
  });
  const agents = useQuery({
    queryKey: ["agents", { projectId }],
    queryFn: () => api.listAgents({ projectId }),
    enabled: !!projectId,
  });
  const adapters = useQuery({
    queryKey: ["adapters"],
    queryFn: api.listAdapters,
  });
  const listRef = useAutoAnimate<HTMLUListElement>();

  // 이 프로젝트 agent 의 run 만.
  const agentIds = useMemo(
    () => new Set((agents.data?.agents ?? []).map((a) => a.id)),
    [agents.data?.agents],
  );
  const projectRuns = useMemo(
    () => (runs.data?.runs ?? []).filter((r) => agentIds.has(r.agentId)),
    [runs.data?.runs, agentIds],
  );

  // [Changes] 필터를 위해 succeeded + before/after 가 있는 후보만 변경 fetch.
  // 변경이 0 인 succeeded run 은 "Changes" 모드에서 스킵.
  const changeCandidates = useMemo(
    () =>
      projectRuns.filter(
        (r) => r.status === "succeeded" && r.beforeRef && r.afterRef,
      ),
    [projectRuns],
  );
  const changeQueries = useQueries({
    queries:
      filter === "changes"
        ? changeCandidates.map((r) => ({
            queryKey: ["run", r.id, "changes"],
            queryFn: () => api.getRunChanges(r.id),
            staleTime: 60_000,
          }))
        : [],
  });
  const reviewableIds = useMemo(() => {
    if (filter !== "changes") return null;
    const set = new Set<string>();
    changeCandidates.forEach((r, i) => {
      const list = changeQueries[i]?.data?.changes ?? [];
      if (list.length > 0) set.add(r.id);
    });
    return set;
  }, [filter, changeCandidates, changeQueries]);

  // 변경 합계 캐시 — Changes 필터일 때만 의미. row 가 +N -M 표시 용.
  const changeStats = useMemo(() => {
    if (filter !== "changes") return new Map<string, { add: number; del: number; n: number }>();
    const m = new Map<string, { add: number; del: number; n: number }>();
    changeCandidates.forEach((r, i) => {
      const list = changeQueries[i]?.data?.changes ?? [];
      if (list.length > 0) {
        const totals = list.reduce(
          (acc, c) => ({
            add: acc.add + c.additions,
            del: acc.del + c.deletions,
            n: acc.n + 1,
          }),
          { add: 0, del: 0, n: 0 },
        );
        m.set(r.id, totals);
      }
    });
    return m;
  }, [filter, changeCandidates, changeQueries]);

  const filtered = useMemo(() => {
    switch (filter) {
      case "changes":
        return reviewableIds
          ? projectRuns.filter((r) => reviewableIds.has(r.id))
          : [];
      case "failed":
        return projectRuns.filter(
          (r) => r.status === "failed" || r.status === "cancelled",
        );
      case "all":
      default:
        return projectRuns;
    }
  }, [projectRuns, filter, reviewableIds]);

  if (!projectId) {
    return (
      <>
        <PanelHeader title={t("activity.history")} />
        <NoProjectState message={t("activity.requiresProject")} />
      </>
    );
  }

  const manifests = adapters.data?.adapters ?? [];

  return (
    <>
      <PanelHeader title={t("activity.history")} />
      <FilterChips value={filter} onChange={setFilter} />
      <div className="flex-1 overflow-y-auto subtle-scrollbar py-1 min-h-0">
        {runs.isLoading ? (
          <ListSkeleton rows={5} />
        ) : filtered.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground/70 italic">
            {emptyMessage(filter, t)}
          </p>
        ) : (
          <ul ref={listRef} className="divide-y divide-border/40">
            {filtered.map((r) => {
              const a = (agents.data?.agents ?? []).find(
                (x) => x.id === r.agentId,
              );
              const m = a
                ? manifests.find((mm) => mm.kind === a.adapterKind)
                : undefined;
              const stat = changeStats.get(r.id);
              return (
                <li key={r.id}>
                  <Link
                    to={`/projects/${projectId}/runs/${r.id}`}
                    className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                  >
                    {m ? (
                      <AdapterIcon manifest={m} size={18} />
                    ) : (
                      <span className="size-4 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium truncate">
                          {a?.name ?? "—"}
                        </span>
                        <Badge
                          variant={runStatusVariant(r.status)}
                          className="h-3.5 px-1 text-[9px] shrink-0"
                        >
                          {r.status}
                        </Badge>
                        {stat ? (
                          <span className="ml-auto text-[10px] mono shrink-0">
                            <span className="text-success">+{stat.add}</span>
                            <span className="ml-1 text-rose-600 dark:text-rose-400">
                              −{stat.del}
                            </span>
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
                        {r.prompt.slice(0, 80)}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground/60 mono">
                        <Clock className="inline size-2.5 mr-0.5" />
                        {formatTimeAgo(r.createdAt, t)}
                      </p>
                    </div>
                    <ChevronRight className="size-3 text-muted-foreground/40 mt-1 shrink-0" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <ManageFooter
        to={`/projects/${projectId}/runs`}
        label={t("activity.manage")}
      />
    </>
  );
}

function FilterChips({
  value,
  onChange,
}: {
  value: Filter;
  onChange: (next: Filter) => void;
}) {
  const { t } = useI18n();
  const options: Array<{ key: Filter; label: string }> = [
    { key: "all", label: t("history.filter.all") },
    { key: "changes", label: t("history.filter.changes") },
    { key: "failed", label: t("history.filter.failed") },
  ];
  return (
    <div className="flex items-center gap-0.5 px-2 pt-1.5 pb-1 border-b border-border/40 shrink-0">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            "px-2 h-5 rounded text-[10px] mono uppercase tracking-wider transition-colors",
            value === o.key
              ? "bg-foreground/[0.08] text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function emptyMessage(
  filter: Filter,
  t: (k: string, vars?: Record<string, string | number>) => string,
): string {
  if (filter === "changes") return t("history.empty.changes");
  if (filter === "failed") return t("history.empty.failed");
  return t("activity.history.empty");
}

