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
  type InsightsDaily,
  type InsightsFile,
  type InsightsSummary,
} from "../api/client.js";
import { PageHeader } from "../components/PageHeader.js";
import { PageScroll } from "../components/PageScroll.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";
import { agentColorFor, classesFor } from "../components/agentColor.js";
import { basename } from "../lib/path.js";

const WINDOWS = [7, 30, 90] as const;
type Window = (typeof WINDOWS)[number];

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
          <WindowToggle
            value={windowDays}
            onChange={setWindowDays}
          />
        }
      />

      <div className="mt-5 space-y-6">
        {q.isLoading ? (
          <SummarySkeleton />
        ) : q.isError ? (
          <p className="text-sm text-destructive">
            {(q.error as Error).message}
          </p>
        ) : q.data ? (
          <>
            <SummarySection summary={q.data.summary} />
            <DailySection daily={q.data.daily} />
            <AgentSection agents={q.data.agents} />
            <FileSection files={q.data.files} />
          </>
        ) : null}
      </div>
    </PageScroll>
  );
}

function WindowToggle({
  value,
  onChange,
}: {
  value: Window;
  onChange: (next: Window) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center rounded-md border border-border/70 p-0.5 text-[11px] mono uppercase tracking-wider">
      {WINDOWS.map((w) => (
        <button
          key={w}
          type="button"
          onClick={() => onChange(w)}
          className={cn(
            "px-2 h-6 rounded transition-colors",
            value === w
              ? "bg-foreground/[0.08] text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t("insights.window", { days: w })}
        </button>
      ))}
    </div>
  );
}

// ─── Summary stat cards ───────────────────────────────────────────────────

function SummarySection({ summary }: { summary: InsightsSummary }) {
  const { t } = useI18n();
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        label={t("insights.totalRuns")}
        value={summary.totalRuns.toLocaleString()}
        sub={t("insights.activeAgents", { count: summary.activeAgents })}
        icon={<Activity className="size-4" />}
      />
      <Stat
        label={t("insights.totalCost")}
        value={`$${summary.totalCostUsd.toFixed(2)}`}
        sub={
          summary.totalRuns > 0
            ? `~$${(summary.totalCostUsd / summary.totalRuns).toFixed(3)} ${t("insights.perRun")}`
            : ""
        }
        icon={<CircleDollarSign className="size-4" />}
      />
      <Stat
        label={t("insights.successRate")}
        value={`${(summary.successRate * 100).toFixed(0)}%`}
        sub=""
        accent={
          summary.successRate >= 0.8
            ? "good"
            : summary.successRate >= 0.5
              ? "warn"
              : "bad"
        }
        icon={<TrendingUp className="size-4" />}
      />
      <Stat
        label={t("insights.active")}
        value={summary.activeRuns.toString()}
        sub={
          summary.activeRuns > 0 ? t("insights.activeNow") : t("insights.idle")
        }
        accent={summary.activeRuns > 0 ? "active" : undefined}
        icon={<Clock className="size-4" />}
      />
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  icon?: React.ReactNode;
  accent?: "good" | "warn" | "bad" | "active";
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wider">
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={cn(
          "mt-1 text-2xl font-semibold tracking-tight tabular-nums",
          accent === "good" && "text-emerald-600 dark:text-emerald-400",
          accent === "warn" && "text-amber-600 dark:text-amber-400",
          accent === "bad" && "text-rose-600 dark:text-rose-400",
          accent === "active" && "text-sky-600 dark:text-sky-400",
        )}
      >
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 text-[11px] text-muted-foreground/80">{sub}</div>
      ) : null}
    </div>
  );
}

function SummarySkeleton() {
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-20 rounded-lg" />
      ))}
    </section>
  );
}

// ─── Daily (cost + runs) ──────────────────────────────────────────────────

function DailySection({ daily }: { daily: InsightsDaily[] }) {
  const { t } = useI18n();
  const maxRuns = Math.max(1, ...daily.map((d) => d.runs));
  const maxCost = Math.max(0, ...daily.map((d) => d.costUsd));

  return (
    <section className="rounded-lg border border-border bg-card p-3">
      <h2 className="text-sm font-semibold mb-3">{t("insights.daily")}</h2>
      <div className="overflow-x-auto subtle-scrollbar">
        <div
          className="flex items-end gap-1 min-w-full"
          style={{ minHeight: 120 }}
        >
          {daily.map((d) => (
            <DailyBar
              key={d.day}
              row={d}
              maxRuns={maxRuns}
              maxCost={maxCost}
            />
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
        <Legend color="bg-emerald-500/70" label={t("insights.succeeded")} />
        <Legend color="bg-rose-500/70" label={t("insights.failed")} />
        <Legend color="bg-zinc-400/60" label={t("insights.cancelled")} />
        <span className="ml-auto mono">
          {t("insights.maxCost", { value: `$${maxCost.toFixed(2)}` })}
        </span>
      </div>
    </section>
  );
}

function DailyBar({
  row,
  maxRuns,
  maxCost,
}: {
  row: InsightsDaily;
  maxRuns: number;
  maxCost: number;
}) {
  const { t } = useI18n();
  const total = row.runs;
  const okFrac = total > 0 ? row.succeeded / total : 0;
  const failFrac = total > 0 ? row.failed / total : 0;
  const cancFrac = total > 0 ? row.cancelled / total : 0;
  // bar 높이는 runs 비율, 비용은 dot 크기로 — runs 가 0 이어도 cost 가 있을 수
  // 있고 (예: cost 있는데 cancelled 일 때) 그 반대도 있어 두 축 분리.
  const barHeight = Math.max(2, (row.runs / maxRuns) * 100);
  const costRadius =
    maxCost > 0 && row.costUsd > 0
      ? Math.max(2, (row.costUsd / maxCost) * 7)
      : 0;
  const tooltip = `${row.day}\n${t("insights.runsCount", { count: row.runs })}\n$${row.costUsd.toFixed(3)}`;
  return (
    <div className="flex flex-col items-center gap-1 group" title={tooltip}>
      <div className="h-[6px] flex items-center justify-center">
        {costRadius > 0 ? (
          <span
            aria-hidden
            className="rounded-full bg-amber-500/90 inline-block"
            style={{ width: costRadius * 2, height: costRadius * 2 }}
          />
        ) : null}
      </div>
      <div
        className="w-3 bg-muted rounded-sm overflow-hidden flex flex-col-reverse"
        style={{ height: barHeight }}
      >
        <span
          className="bg-emerald-500/70"
          style={{ height: `${okFrac * 100}%` }}
        />
        <span
          className="bg-rose-500/70"
          style={{ height: `${failFrac * 100}%` }}
        />
        <span
          className="bg-zinc-400/60"
          style={{ height: `${cancFrac * 100}%` }}
        />
      </div>
      <span className="text-[8px] text-muted-foreground/60 mono group-hover:text-foreground">
        {row.day.slice(5)}
      </span>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("inline-block w-2 h-2 rounded-sm", color)} />
      {label}
    </span>
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

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs - m * 60);
  return `${m}m ${s}s`;
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
