// 사이드 패널 — 리뷰 리스트. 클릭하면 메인 페이지가 그 항목의 디테일을 열음.
//
// "리뷰" 는 변경을 만들어낸 succeeded run 들. 풀 리퀘스트 스트림 처럼 좌측에
// 카드로 쌓이고, 페이지 본문은 선택된 한 건을 통째로 보여줌. ?runId= 으로 전달.

import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../api/client.js";
import { AgentAvatar } from "../chat/index.js";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";
import { formatTimeAgo } from "../../lib/timeAgo.js";
import { useAutoAnimate } from "../../lib/useAutoAnimate.js";
import { agentColorOf, classesFor } from "../agentColor.js";
import { ListSkeleton, NoProjectState, PanelHeader } from "./shared.js";

export function ReviewTab() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const selectedId = searchParams.get("runId");

  const runs = useQuery({
    queryKey: ["runs", { projectId, panel: "review" }],
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

  // 풀 페이지가 보던 후보 — 변경을 만들 *법한* succeeded + before/after.
  const agentIds = useMemo(
    () => new Set((agents.data?.agents ?? []).map((a) => a.id)),
    [agents.data],
  );
  const candidates = useMemo(
    () =>
      (runs.data?.runs ?? [])
        .filter((r) => agentIds.has(r.agentId))
        .filter((r) => r.status === "succeeded" && r.beforeRef && r.afterRef),
    [runs.data, agentIds],
  );

  // 각 후보의 변경 목록 — 카드의 +N -M 표시 + 빈 변경(0건) 자동 필터링용.
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
        .map((run, i) => ({
          run,
          changes: changeQueries[i]?.data?.changes ?? [],
        }))
        .filter((x) => x.changes.length > 0),
    [candidates, changeQueries],
  );

  if (!projectId) {
    return (
      <>
        <PanelHeader title={t("activity.review")} />
        <NoProjectState message={t("activity.requiresProject")} />
      </>
    );
  }

  const manifests = adapters.data?.adapters ?? [];

  return (
    <>
      <PanelHeader
        title={t("activity.review")}
        action={
          <span className="text-[10px] mono text-muted-foreground/70">
            {reviewable.length}
          </span>
        }
      />
      <div className="flex-1 overflow-y-auto subtle-scrollbar min-h-0">
        {runs.isLoading ? (
          <ListSkeleton rows={3} />
        ) : reviewable.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground/70 italic text-center">
            {t("review.empty")}
          </p>
        ) : (
          <ul ref={listRef} className="divide-y divide-border/40">
            {reviewable.map(({ run: r, changes }) => {
              const a = (agents.data?.agents ?? []).find(
                (x) => x.id === r.agentId,
              );
              const m = a
                ? manifests.find((mm) => mm.kind === a.adapterKind)
                : undefined;
              const cls = a ? classesFor(agentColorOf(a)) : null;
              const totals = changes.reduce(
                (acc, c) => ({
                  add: acc.add + c.additions,
                  del: acc.del + c.deletions,
                }),
                { add: 0, del: 0 },
              );
              const active = r.id === selectedId;
              return (
                <li key={r.id}>
                  <Link
                    to={`/projects/${projectId}/review?runId=${r.id}`}
                    className={cn(
                      "w-full flex items-start gap-2 px-3 py-2 transition-colors",
                      active
                        ? "bg-foreground/[0.08]"
                        : "hover:bg-muted/50",
                    )}
                  >
                    {a ? (
                      <AgentAvatar agent={a} manifest={m} size="sm" />
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
                          @{a?.name ?? "—"}
                        </span>
                        <span className="text-[10px] text-muted-foreground/70 mono shrink-0">
                          {formatTimeAgo(r.createdAt, t)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2 break-words">
                        {r.prompt}
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
                        <span className="text-success">+{totals.add}</span>
                        <span className="text-rose-600 dark:text-rose-400">
                          −{totals.del}
                        </span>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
