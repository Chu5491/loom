// 채팅 사이드바 — 스레드 목록 + 활동 중인 에이전트 현황.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
  Loader2,
  MessageSquare,
  Plus,
} from "lucide-react";
import { api } from "../../api/client.js";
import { AdapterIcon } from "../AdapterIcon.js";
import { useI18n } from "../../context/I18nContext.js";
import { emit } from "../../lib/loomEvents.js";
import { formatTimeAgo } from "../../lib/timeAgo.js";
import { cn } from "../../lib/utils.js";
import { ListSkeleton, NoProjectState, PanelHeader } from "./shared.js";

export function ChatTab() {
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
  const threadsQuery = useQuery({
    queryKey: ["threads", { projectId }],
    queryFn: () => api.listThreads({ projectId }),
    enabled: !!projectId,
    refetchInterval: 10_000,
  });
  const runsQuery = useQuery({
    queryKey: ["runs", { projectId, panel: "chat" }],
    queryFn: () => api.listRuns({ limit: 50 }),
    enabled: !!projectId,
    refetchInterval: 5000,
  });

  const agentList = agents.data?.agents ?? [];
  const manifests = adapters.data?.adapters ?? [];
  const threadList = threadsQuery.data?.threads ?? [];
  const agentIds = useMemo(
    () => new Set(agentList.map((a) => a.id)),
    [agentList],
  );
  const projectRuns = useMemo(
    () => (runsQuery.data?.runs ?? []).filter((r) => agentIds.has(r.agentId)),
    [runsQuery.data, agentIds],
  );
  const activeRuns = useMemo(
    () => projectRuns.filter((r) => r.status === "running" || r.status === "queued"),
    [projectRuns],
  );
  const workingThreadIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of activeRuns) {
      if (r.threadId) s.add(r.threadId);
    }
    return s;
  }, [activeRuns]);

  const navigate = useNavigate();

  const pickThread = (id: string) => {
    navigate(`/projects/${projectId}`);
    emit("pickThread", { id });
  };
  const newThread = () => {
    navigate(`/projects/${projectId}`);
    emit("newThread");
  };

  if (!projectId) {
    return (
      <>
        <PanelHeader title={t("activity.chat")} />
        <NoProjectState message={t("activity.requiresProject")} />
      </>
    );
  }

  return (
    <>
      <PanelHeader title={t("activity.chat")} />
      <div className="flex-1 overflow-y-auto subtle-scrollbar min-h-0">
        {/* 활동 중인 에이전트 */}
        {activeRuns.length > 0 ? (
          <section className="px-3 py-2.5 border-b border-border/40">
            <h4 className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5">
              {t("chat.panel.working")}
            </h4>
            <ul className="space-y-0.5">
              {agentList
                .filter((a) => activeRuns.some((r) => r.agentId === a.id))
                .map((a) => {
                  const manifest = manifests.find((m) => m.kind === a.adapterKind);
                  const run = activeRuns.find((r) => r.agentId === a.id);
                  return (
                    <li
                      key={a.id}
                      className="flex items-center gap-2 px-1.5 py-1.5 rounded-md bg-emerald-500/[0.04]"
                    >
                      {manifest ? (
                        <AdapterIcon manifest={manifest} size={16} />
                      ) : (
                        <span className="size-4 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <span className="text-[11px] font-medium text-foreground/90 truncate block">
                          @{a.name}
                        </span>
                        {run ? (
                          <span className="text-[10px] mono text-muted-foreground/60 truncate block">
                            {run.prompt.slice(0, 40)}{run.prompt.length > 40 ? "…" : ""}
                          </span>
                        ) : null}
                      </div>
                      <Loader2 className="size-3 text-emerald-500 animate-spin shrink-0" />
                    </li>
                  );
                })}
            </ul>
          </section>
        ) : null}

        {/* 스레드 목록 */}
        <section className="px-3 py-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <h4 className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              {t("chat.panel.threads")}
            </h4>
            <button
              type="button"
              onClick={newThread}
              title={t("chat.panel.newThread")}
              className="inline-flex size-4 items-center justify-center rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted transition-colors"
            >
              <Plus className="size-3" />
            </button>
          </div>
          {threadsQuery.isLoading ? (
            <ListSkeleton rows={4} withAvatar={false} />
          ) : threadList.length === 0 ? (
            <p className="text-[11px] text-muted-foreground/50 italic py-1">
              {t("chat.panel.noThreads")}
            </p>
          ) : (
            <ul className="space-y-px max-h-[40vh] overflow-y-auto subtle-scrollbar">
              {threadList.map((th) => {
                const working = workingThreadIds.has(th.id);
                const runCount = projectRuns.filter(
                  (r) => r.threadId === th.id,
                ).length;
                return (
                  <li key={th.id}>
                    <button
                      type="button"
                      onClick={() => pickThread(th.id)}
                      className={cn(
                        "flex items-center gap-2 px-1.5 py-1.5 rounded-md transition-colors text-left w-full",
                        working
                          ? "bg-emerald-500/[0.04] hover:bg-emerald-500/[0.08]"
                          : "hover:bg-muted/40",
                      )}
                    >
                      <MessageSquare className="size-3 text-muted-foreground/50 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-[11px] font-medium text-foreground/85 truncate block">
                          {th.name ?? t("thread.untitled")}
                        </span>
                        <span className="text-[10px] mono text-muted-foreground/50">
                          {runCount > 0 ? `${runCount} ${t("chat.panel.messages")}` : null}
                          {th.createdAt ? (
                            <span className="ml-1">
                              {formatTimeAgo(th.createdAt, t)}
                            </span>
                          ) : null}
                        </span>
                      </div>
                      {working ? (
                        <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* 대기 중 에이전트 */}
        {agentList.filter((a) => !activeRuns.some((r) => r.agentId === a.id)).length > 0 ? (
          <section className="px-3 py-2.5 border-t border-border/40">
            <h4 className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5">
              {t("chat.panel.idle")}
            </h4>
            <ul className="space-y-0.5">
              {agentList
                .filter((a) => !activeRuns.some((r) => r.agentId === a.id))
                .map((a) => {
                  const manifest = manifests.find((m) => m.kind === a.adapterKind);
                  const lastRun = projectRuns.find((r) => r.agentId === a.id);
                  return (
                    <li
                      key={a.id}
                      className="flex items-center gap-2 px-1.5 py-1.5 rounded-md hover:bg-muted/40 transition-colors"
                    >
                      {manifest ? (
                        <AdapterIcon manifest={manifest} size={16} />
                      ) : (
                        <span className="size-4 shrink-0" />
                      )}
                      <span className="text-[11px] text-foreground/70 truncate flex-1">
                        @{a.name}
                      </span>
                      {lastRun ? (
                        <span className="text-[9px] mono text-muted-foreground/40 shrink-0">
                          {formatTimeAgo(lastRun.endedAt ?? lastRun.createdAt, t)}
                        </span>
                      ) : (
                        <span className="text-[9px] mono text-muted-foreground/30 shrink-0">
                          {t("chat.panel.neverRun")}
                        </span>
                      )}
                    </li>
                  );
                })}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}
