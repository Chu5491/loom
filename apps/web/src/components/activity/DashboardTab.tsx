// 대시보드 사이드바 — 프로젝트 요약, 에이전트 현황, Git 상태 한눈에.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import {
  GitBranch,
  Loader2,
} from "lucide-react";
import { api } from "../../api/client.js";
import { AdapterIcon } from "../AdapterIcon.js";
import { useI18n } from "../../context/I18nContext.js";
import { formatTimeAgo } from "../../lib/timeAgo.js";
import { cn } from "../../lib/utils.js";
import { ListSkeleton, NoProjectState, PanelHeader } from "./shared.js";

export function DashboardTab() {
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
  const runsQuery = useQuery({
    queryKey: ["runs", { projectId, panel: "dashboard" }],
    queryFn: () => api.listRuns({ limit: 50 }),
    enabled: !!projectId,
    refetchInterval: 5000,
  });
  const gitStatus = useQuery({
    queryKey: ["gitStatus", projectId],
    queryFn: () => api.getGitStatus(projectId!),
    enabled: !!projectId,
    refetchInterval: 15_000,
  });
  const insights = useQuery({
    queryKey: ["projectInsights", projectId],
    queryFn: () => api.getProjectInsights(projectId!, 7),
    enabled: !!projectId,
    staleTime: 60_000,
  });
  const collabQuery = useQuery({
    queryKey: ["gitCollaborators", projectId],
    queryFn: () => api.getGitCollaborators(projectId!),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });

  const agentList = agents.data?.agents ?? [];
  const collaborators = collabQuery.data?.collaborators ?? [];
  const manifests = adapters.data?.adapters ?? [];
  const agentIds = useMemo(
    () => new Set(agentList.map((a) => a.id)),
    [agentList],
  );
  const projectRuns = useMemo(
    () => (runsQuery.data?.runs ?? []).filter((r) => agentIds.has(r.agentId)),
    [runsQuery.data, agentIds],
  );
  const status = gitStatus.data?.status ?? null;
  const summary = insights.data?.summary ?? null;

  const activeRuns = useMemo(
    () => projectRuns.filter((r) => r.status === "running" || r.status === "queued"),
    [projectRuns],
  );

  if (!projectId) {
    return (
      <>
        <PanelHeader title={t("activity.dashboard")} />
        <NoProjectState message={t("activity.requiresProject")} />
      </>
    );
  }

  return (
    <>
      <PanelHeader title={t("activity.dashboard")} />
      <div className="flex-1 overflow-y-auto subtle-scrollbar min-h-0">
        {/* Git 상태 */}
        {status ? (
          <section className="px-3 py-2.5 border-b border-border/40">
            <div className="flex items-center gap-1.5 mb-1.5">
              <GitBranch className="size-3 text-muted-foreground" />
              <span className="text-[11px] font-semibold text-foreground truncate">
                {status.branch ?? t("git.status.headDetached")}
              </span>
              <span
                className={cn(
                  "size-1.5 rounded-full shrink-0",
                  status.clean ? "bg-emerald-500" : "bg-amber-500",
                )}
              />
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] mono text-muted-foreground">
              {status.ahead ? (
                <span className="text-emerald-600 dark:text-emerald-400">
                  ↑{status.ahead}
                </span>
              ) : null}
              {status.behind ? (
                <span className="text-rose-600 dark:text-rose-400">
                  ↓{status.behind}
                </span>
              ) : null}
              {!status.clean ? (
                <span className="text-amber-600 dark:text-amber-400">
                  {status.staged.length + status.unstaged.length + status.untracked.length} {t("git.status.changes")}
                </span>
              ) : (
                <span>{t("git.status.clean")}</span>
              )}
              {status.conflicted.length > 0 ? (
                <span className="text-rose-600 dark:text-rose-400">
                  {t("git.warn.conflict", { n: status.conflicted.length })}
                </span>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* 통계 요약 */}
        {summary ? (
          <section className="px-3 py-2.5 border-b border-border/40">
            <h4 className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5">
              {t("dashboard.panel.stats")}
            </h4>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("dashboard.panel.runs")}</span>
                <span className="mono text-foreground/80">{summary.totalRuns}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("dashboard.panel.success")}</span>
                <span className={cn(
                  "mono",
                  summary.successRate >= 0.9 ? "text-emerald-600 dark:text-emerald-400"
                    : summary.successRate >= 0.7 ? "text-amber-600 dark:text-amber-400"
                    : "text-rose-600 dark:text-rose-400",
                )}>
                  {Math.round(summary.successRate * 100)}%
                </span>
              </div>
              {summary.totalCostUsd > 0 ? (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("dashboard.panel.cost")}</span>
                  <span className="mono text-foreground/80">${summary.totalCostUsd.toFixed(2)}</span>
                </div>
              ) : null}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("dashboard.panel.active")}</span>
                <span className={cn(
                  "mono",
                  activeRuns.length > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-foreground/80",
                )}>
                  {activeRuns.length}
                </span>
              </div>
            </div>
          </section>
        ) : null}

        {/* 에이전트 목록 */}
        <section className="px-3 py-2.5">
          <h4 className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5">
            {t("dashboard.panel.agents")}
          </h4>
          {agents.isLoading ? (
            <ListSkeleton rows={3} />
          ) : agentList.length === 0 ? (
            <p className="text-[11px] text-muted-foreground/50 italic py-1">
              {t("dashboard.panel.noAgents")}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {agentList.map((a) => {
                const manifest = manifests.find((m) => m.kind === a.adapterKind);
                const running = activeRuns.some((r) => r.agentId === a.id);
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
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] font-medium text-foreground/90 truncate block">
                        @{a.name}
                      </span>
                    </div>
                    {running ? (
                      <Loader2 className="size-3 text-emerald-500 animate-spin shrink-0" />
                    ) : lastRun ? (
                      <span className="text-[9px] mono text-muted-foreground/50 shrink-0">
                        {formatTimeAgo(lastRun.endedAt ?? lastRun.createdAt, t)}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* 기여자 */}
        {collaborators.length > 0 ? (
          <section className="px-3 py-2.5 border-t border-border/40">
            <h4 className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5">
              {t("dashboard.panel.contributors")}
            </h4>
            <ul className="space-y-0.5">
              {collaborators.slice(0, 8).map((c) => (
                <li
                  key={c.email}
                  className="flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-muted/40 transition-colors"
                >
                  <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-foreground/70 shrink-0 uppercase">
                    {c.name.charAt(0)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="text-[11px] text-foreground/85 truncate block">{c.name}</span>
                  </div>
                  <span className="text-[9px] mono text-muted-foreground/50 shrink-0 tabular-nums">
                    {c.commitCount}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}
