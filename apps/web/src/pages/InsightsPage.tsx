// 프로젝트 단위 통계 대시보드 — 비용·성공률·agent 별·파일 활동.
//
// 데이터는 모두 이미 캡처돼 있는 runs / run_changes / agents 에서 집계.
// 별도 라이팅 없음. 이 페이지는 단일 endpoint(/insights) 로 4개 섹션을 한 번에 가져와 그림.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import {
  Activity,
  CircleDollarSign,
  Clock,
  Files as FilesIcon,
  TrendingUp,
} from "lucide-react";
import {
  api,
  type InsightsAgent,
  type InsightsFile,
} from "../api/client.js";
import { PageHeader } from "../components/PageHeader.js";
import { PageScroll } from "../components/PageScroll.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";
import { agentColorFor, classesFor } from "../components/agentColor.js";
import { basename } from "../lib/path.js";
import {
  CommonSummaryCards,
  DailyChart,
  StatGrid,
  StatGridSkeleton,
  WindowToggle,
  formatDuration,
  type Window,
} from "./insights/shared.js";

export function InsightsPage() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();
  const [windowDays, setWindowDays] = useState<Window>(30);

  const q = useQuery({
    queryKey: ["projectInsights", projectId, windowDays],
    queryFn: () => api.getProjectInsights(projectId!, windowDays),
    enabled: !!projectId,
    refetchInterval: 30_000,
  });

  if (!projectId) {
    return (
      <PageScroll>
        <p className="text-sm text-muted-foreground">
          {t("activity.requiresProject")}
        </p>
      </PageScroll>
    );
  }

  return (
    <PageScroll>
      <PageHeader
        title={t("insights.title")}
        description={t("insights.description")}
        action={
          <WindowToggle value={windowDays} onChange={setWindowDays} />
        }
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
            </StatGrid>
            <DailyChart daily={q.data.daily} />
            <AgentSection agents={q.data.agents} />
            <FileSection files={q.data.files} />
          </>
        ) : null}
      </div>
    </PageScroll>
  );
}

// ─── Per-agent table ──────────────────────────────────────────────────────

function AgentSection({ agents }: { agents: InsightsAgent[] }) {
  const { t } = useI18n();
  if (agents.length === 0) {
    return (
      <section className="rounded-lg border border-border bg-card p-3">
        <h2 className="text-sm font-semibold mb-2">{t("insights.byAgent")}</h2>
        <p className="text-xs text-muted-foreground/70 italic">
          {t("insights.noAgentRuns")}
        </p>
      </section>
    );
  }
  return (
    <section className="rounded-lg border border-border bg-card overflow-hidden">
      <h2 className="text-sm font-semibold p-3 pb-2">
        {t("insights.byAgent")}
      </h2>
      <table className="w-full text-xs tabular-nums">
        <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-1.5 font-medium">
              {t("insights.col.agent")}
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
            <AgentRow key={a.agentId} a={a} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function AgentRow({ a }: { a: InsightsAgent }) {
  const cls = classesFor(agentColorFor(a.agentId));
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
      <td className="text-right px-2 py-2">{a.runs}</td>
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
          ({a.succeeded}/{a.runs})
        </span>
      </td>
      <td className="text-right px-2 py-2 text-muted-foreground/90">
        {dur === null ? "—" : formatDuration(dur)}
      </td>
      <td className="text-right px-3 py-2 mono">${a.costUsd.toFixed(3)}</td>
    </tr>
  );
}

// ─── File activity ────────────────────────────────────────────────────────

function FileSection({ files }: { files: InsightsFile[] }) {
  const { t } = useI18n();
  if (files.length === 0) {
    return (
      <section className="rounded-lg border border-border bg-card p-3">
        <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <FilesIcon className="size-3.5 text-muted-foreground" />
          {t("insights.fileActivity")}
        </h2>
        <p className="text-xs text-muted-foreground/70 italic">
          {t("insights.noFileChanges")}
        </p>
      </section>
    );
  }
  const maxTouches = Math.max(1, ...files.map((f) => f.touches));
  return (
    <section className="rounded-lg border border-border bg-card overflow-hidden">
      <h2 className="text-sm font-semibold p-3 pb-2 flex items-center gap-2">
        <FilesIcon className="size-3.5 text-muted-foreground" />
        {t("insights.fileActivity")}
      </h2>
      <ul>
        {files.map((f) => {
          const ratio = f.touches / maxTouches;
          return (
            <li
              key={f.path}
              className="border-t border-border/40 px-3 py-1.5 hover:bg-muted/30 group"
              title={f.path}
            >
              <div className="flex items-center gap-2 text-xs mono">
                <span className="truncate font-medium">
                  {basename(f.path)}
                </span>
                <span className="text-muted-foreground/60 truncate text-[10px]">
                  {f.path !== basename(f.path)
                    ? f.path.slice(
                        0,
                        f.path.length - basename(f.path).length - 1,
                      )
                    : ""}
                </span>
                <span className="ml-auto text-muted-foreground/80 tabular-nums shrink-0">
                  {f.touches}×
                </span>
                <span className="text-emerald-600 dark:text-emerald-400 tabular-nums shrink-0">
                  +{f.additions}
                </span>
                <span className="text-rose-600 dark:text-rose-400 tabular-nums shrink-0">
                  −{f.deletions}
                </span>
              </div>
              <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
                <span
                  className="block h-full bg-foreground/30"
                  style={{ width: `${ratio * 100}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
