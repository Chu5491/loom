// 사이드 패널 — 최근 run 시간순 목록. 클릭 시 상세 페이지로.

import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ChevronRight, Clock } from "lucide-react";
import { api } from "../../api/client.js";
import { AdapterIcon } from "../AdapterIcon.js";
import { Badge } from "../ui/badge.js";
import { useI18n } from "../../context/I18nContext.js";
import { runStatusVariant } from "../../lib/runStatus.js";
import { formatTimeAgo } from "../../lib/timeAgo.js";
import { useAutoAnimate } from "../../lib/useAutoAnimate.js";
import { ListSkeleton, ManageFooter, NoProjectState, PanelHeader } from "./shared.js";

export function HistoryTab() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();
  const runs = useQuery({
    queryKey: ["runs", { projectId, panel: "history" }],
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
        <PanelHeader title={t("activity.history")} />
        <NoProjectState message={t("activity.requiresProject")} />
      </>
    );
  }

  const agentIds = new Set((agents.data?.agents ?? []).map((a) => a.id));
  const runList = (runs.data?.runs ?? []).filter((r) => agentIds.has(r.agentId));
  const manifests = adapters.data?.adapters ?? [];

  return (
    <>
      <PanelHeader title={t("activity.history")} />
      <div className="flex-1 overflow-y-auto subtle-scrollbar py-1 min-h-0">
        {runs.isLoading ? (
          <ListSkeleton rows={5} />
        ) : runList.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground/70 italic">
            {t("activity.history.empty")}
          </p>
        ) : (
          <ul ref={listRef} className="divide-y divide-border/40">
            {runList.map((r) => {
              const a = (agents.data?.agents ?? []).find(
                (x) => x.id === r.agentId,
              );
              const m = a
                ? manifests.find((mm) => mm.kind === a.adapterKind)
                : undefined;
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
