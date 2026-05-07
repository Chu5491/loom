// 워크스페이스 전체 통계 — main mode 의 lobby 화면. 모든 프로젝트를 한 시야로.
//
// 프로젝트 단위 InsightsPage 와 동일한 4 stat + daily chart + agent table 을
// 공유 컴포넌트로 그리고, files 섹션 자리에 "프로젝트별 breakdown" 테이블이 들어감.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Activity,
  CircleDollarSign,
  Clock,
  Folder,
  TrendingUp,
} from "lucide-react";
import {
  api,
  type InsightsProject,
  type InsightsWorkspaceAgent,
} from "../api/client.js";
import { PageHeader } from "../components/PageHeader.js";
import { PageScroll } from "../components/PageScroll.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";
import { agentColorFor, classesFor } from "../components/agentColor.js";
import { formatTimeAgo } from "../lib/timeAgo.js";
import {
  CommonSummaryCards,
  DailyChart,
  Stat,
  StatGrid,
  StatGridSkeleton,
  WindowToggle,
  formatDuration,
  successAccent,
  type Window,
} from "./insights/shared.js";

export function WorkspaceInsightsPage() {
  const { t } = useI18n();
  const [windowDays, setWindowDays] = useState<Window>(30);

  const q = useQuery({
    queryKey: ["workspaceInsights", windowDays],
    queryFn: () => api.getWorkspaceInsights(windowDays),
    refetchInterval: 30_000,
  });

  return (
    <PageScroll>
      <PageHeader
        title={t("insights.workspace.title")}
        description={t("insights.workspace.description")}
        action={<WindowToggle value={windowDays} onChange={setWindowDays} />}
      />

      <div className="mt-5 space-y-6">
        {q.isLoading ? (
          <StatGridSkeleton />
        ) : q.isError ? (
          <p className="text-sm text-destructive">
            {(q.error as Error).message}
          </p>
        ) : q.data ? (
          <>
            <StatGrid>
              <CommonSummaryCards
                summary={q.data.summary}
                Icons={{
                  Runs: Activity,
                  Cost: CircleDollarSign,
                  Success: TrendingUp,
                  Active: Clock,
                }}
              />
              {/* 5번째 카드 — 워크스페이스 전용. activeProjects */}
              <Stat
                label={t("insights.activeProjects")}
                value={q.data.summary.activeProjects.toString()}
                sub={t("insights.workspace.acrossWorkspace")}
                icon={<Folder className="size-4" />}
              />
            </StatGrid>
            <DailyChart daily={q.data.daily} />
            <ProjectSection projects={q.data.projects} />
            <AgentSection agents={q.data.agents} />
          </>
        ) : null}
      </div>
    </PageScroll>
  );
}

// ─── Per-project breakdown ────────────────────────────────────────────────

function ProjectSection({ projects }: { projects: InsightsProject[] }) {
  const { t } = useI18n();
  if (projects.length === 0) {
    return (
      <section className="rounded-md border border-border bg-card p-3">
        <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Folder className="size-3.5 text-muted-foreground" />
          {t("insights.byProject")}
        </h2>
        <p className="text-xs text-muted-foreground/70 italic">
          {t("insights.noProjectRuns")}
        </p>
      </section>
    );
  }
  return (
    <section className="rounded-md border border-border bg-card overflow-hidden">
      <h2 className="text-sm font-semibold p-3 pb-2 flex items-center gap-2">
        <Folder className="size-3.5 text-muted-foreground" />
        {t("insights.byProject")}
      </h2>
      <table className="w-full text-xs tabular-nums">
        <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-1.5 font-medium">
              {t("insights.col.project")}
            </th>
            <th className="text-right px-2 py-1.5 font-medium">
              {t("insights.col.runs")}
            </th>
            <th className="text-right px-2 py-1.5 font-medium">
              {t("insights.col.success")}
            </th>
            <th className="text-right px-3 py-1.5 font-medium">
              {t("insights.col.cost")}
            </th>
            <th className="text-right px-3 py-1.5 font-medium">
              {t("insights.col.lastRun")}
            </th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <ProjectRow key={p.projectId} p={p} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ProjectRow({ p }: { p: InsightsProject }) {
  const { t } = useI18n();
  const cls = classesFor(agentColorFor(p.projectId));
  const successRate = p.runs > 0 ? p.succeeded / p.runs : 0;
  return (
    <tr className="border-t border-border/40 hover:bg-muted/30">
      <td className="px-3 py-2">
        <Link
          to={`/projects/${p.projectId}/insights`}
          className={cn(
            "inline-flex items-center gap-1.5 font-medium hover:underline",
            cls.text,
          )}
        >
          <span
            className={cn(
              "inline-flex items-center justify-center size-4 rounded text-[9px] font-bold ring-1",
              cls.bgSoft,
              cls.text,
              cls.ring,
            )}
          >
            {p.projectName.trim()[0]?.toUpperCase() ?? "?"}
          </span>
          {p.projectName}
        </Link>
      </td>
      <td className="text-right px-2 py-2">{p.runs}</td>
      <td className="text-right px-2 py-2">
        <span
          className={cn(
            successRate >= 0.8
              ? "text-emerald-600 dark:text-emerald-400"
              : successRate >= 0.5
                ? "text-amber-600 dark:text-amber-400"
                : "text-rose-600 dark:text-rose-400",
          )}
        >
          {(successRate * 100).toFixed(0)}%
        </span>
        <span className="ml-1 text-[10px] text-muted-foreground/60">
          ({p.succeeded}/{p.runs})
        </span>
      </td>
      <td className="text-right px-3 py-2 mono">${p.costUsd.toFixed(3)}</td>
      <td className="text-right px-3 py-2 text-muted-foreground/80">
        {p.lastRunAt ? formatTimeAgo(p.lastRunAt, t) : "—"}
      </td>
    </tr>
  );
}

// ─── Top agents (cross-project) ───────────────────────────────────────────

function AgentSection({ agents }: { agents: InsightsWorkspaceAgent[] }) {
  const { t } = useI18n();
  if (agents.length === 0) {
    return (
      <section className="rounded-md border border-border bg-card p-3">
        <h2 className="text-sm font-semibold mb-2">
          {t("insights.byAgent")}
        </h2>
        <p className="text-xs text-muted-foreground/70 italic">
          {t("insights.noAgentRuns")}
        </p>
      </section>
    );
  }
  return (
    <section className="rounded-md border border-border bg-card overflow-hidden">
      <h2 className="text-sm font-semibold p-3 pb-2">
        {t("insights.workspace.topAgents")}
      </h2>
      <table className="w-full text-xs tabular-nums">
        <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-1.5 font-medium">
              {t("insights.col.agent")}
            </th>
            <th className="text-left px-2 py-1.5 font-medium">
              {t("insights.col.project")}
            </th>
            <th className="text-right px-2 py-1.5 font-medium">
              {t("insights.col.runs")}
            </th>
            <th className="text-right px-2 py-1.5 font-medium">
              {t("insights.col.success")}
            </th>
            <th className="text-right px-2 py-1.5 font-medium">
              {t("insights.col.avgDuration")}
            </th>
            <th className="text-right px-3 py-1.5 font-medium">
              {t("insights.col.cost")}
            </th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <WorkspaceAgentRow key={a.agentId} a={a} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function WorkspaceAgentRow({ a }: { a: InsightsWorkspaceAgent }) {
  const cls = classesFor(agentColorFor(a.agentId));
  const projCls = classesFor(agentColorFor(a.projectId));
  const successRate = a.runs > 0 ? a.succeeded / a.runs : 0;
  const dur = a.avgDurationSecs;
  return (
    <tr className="border-t border-border/40 hover:bg-muted/30">
      <td className="px-3 py-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 font-medium",
            cls.text,
          )}
        >
          <span className={cn("size-1.5 rounded-full", cls.dot)} />
          @{a.agentName}
        </span>
        <span className="ml-2 text-[10px] text-muted-foreground/70">
          {a.adapterKind}
        </span>
      </td>
      <td className="px-2 py-2">
        <Link
          to={`/projects/${a.projectId}`}
          className={cn(
            "inline-flex items-center gap-1 hover:underline",
            projCls.text,
          )}
        >
          {a.projectName}
        </Link>
      </td>
      <td className="text-right px-2 py-2">{a.runs}</td>
      <td className="text-right px-2 py-2">
        <span className={successAccentClass(successRate)}>
          {(successRate * 100).toFixed(0)}%
        </span>
      </td>
      <td className="text-right px-2 py-2 text-muted-foreground/90">
        {dur === null ? "—" : formatDuration(dur)}
      </td>
      <td className="text-right px-3 py-2 mono">${a.costUsd.toFixed(3)}</td>
    </tr>
  );
}

function successAccentClass(rate: number): string {
  const accent = successAccent(rate);
  return cn(
    accent === "good" && "text-emerald-600 dark:text-emerald-400",
    accent === "warn" && "text-amber-600 dark:text-amber-400",
    accent === "bad" && "text-rose-600 dark:text-rose-400",
  );
}
