// 사이드 패널 — 변경을 만든 최근 run을 풀 리퀘스트 스트림처럼 미리보기.

import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../../api/client.js";
import { AgentAvatar } from "../Chat.js";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";
import { formatTimeAgo } from "../../lib/timeAgo.js";
import { useAutoAnimate } from "../../lib/useAutoAnimate.js";
import { agentColorOf, classesFor } from "../agentColor.js";
import { ListSkeleton, ManageFooter, NoProjectState, PanelHeader } from "./shared.js";

export function ReviewTab() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();
  const runs = useQuery({
    queryKey: ["runs", { projectId, panel: "review" }],
    queryFn: () => api.listRuns({ limit: 30 }),
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

  if (!projectId) {
    return (
      <>
        <PanelHeader title={t("activity.review")} />
        <NoProjectState message={t("activity.requiresProject")} />
      </>
    );
  }

  const agentIds = new Set((agents.data?.agents ?? []).map((a) => a.id));
  // 변경을 만들었을 *법한* 최근 run 미리보기 — 풀 페이지가 더 엄격하게 필터링.
  const candidates = (runs.data?.runs ?? [])
    .filter((r) => agentIds.has(r.agentId))
    .filter((r) => r.status === "succeeded" && r.beforeRef && r.afterRef)
    .slice(0, 12);
  const manifests = adapters.data?.adapters ?? [];

  return (
    <>
      <PanelHeader title={t("activity.review")} />
      <div className="flex-1 overflow-y-auto subtle-scrollbar py-1 min-h-0">
        {runs.isLoading ? (
          <ListSkeleton rows={3} />
        ) : candidates.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground/70 italic">
            {t("review.empty")}
          </p>
        ) : (
          <ul ref={listRef} className="divide-y divide-border/40">
            {candidates.map((r) => {
              const a = (agents.data?.agents ?? []).find(
                (x) => x.id === r.agentId,
              );
              const m = a
                ? manifests.find((mm) => mm.kind === a.adapterKind)
                : undefined;
              const cls = a ? classesFor(agentColorOf(a)) : null;
              return (
                <li key={r.id}>
                  <Link
                    to={`/projects/${projectId}/review`}
                    className="w-full flex items-start gap-2 px-3 py-2 hover:bg-muted/50 transition-colors"
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
                      <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-1">
                        {r.prompt.slice(0, 100)}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <ManageFooter
        to={`/projects/${projectId}/review`}
        label={t("activity.manage")}
      />
    </>
  );
}
