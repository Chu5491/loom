// Project / Workspace insights 페이지가 같이 쓰는 빌딩 블록.
// Stat 카드, daily 차트, window 토글, helper 들.

import type { InsightsDaily, InsightsSummary } from "../../api/client.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";

export const WINDOWS = [7, 30, 90] as const;
export type Window = (typeof WINDOWS)[number];

export function WindowToggle({
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

export function Stat({
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

export function StatGrid({ children }: { children: React.ReactNode }) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {children}
    </section>
  );
}

export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <StatGrid>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-20 rounded-lg" />
      ))}
    </StatGrid>
  );
}

export function successAccent(rate: number): "good" | "warn" | "bad" {
  if (rate >= 0.8) return "good";
  if (rate >= 0.5) return "warn";
  return "bad";
}

// ─── Daily chart ──────────────────────────────────────────────────────────

export function DailyChart({ daily }: { daily: InsightsDaily[] }) {
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

export function formatDuration(secs: number): string {
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs - m * 60);
  return `${m}m ${s}s`;
}

/** Project / Workspace summary 모두 같은 4-stat 모양을 씀 — 핵심 통계는 동일. */
export function CommonSummaryCards({
  summary,
  Icons,
}: {
  summary: InsightsSummary;
  Icons: {
    Runs: React.ComponentType<{ className?: string }>;
    Cost: React.ComponentType<{ className?: string }>;
    Success: React.ComponentType<{ className?: string }>;
    Active: React.ComponentType<{ className?: string }>;
  };
}) {
  const { t } = useI18n();
  return (
    <>
      <Stat
        label={t("insights.totalRuns")}
        value={summary.totalRuns.toLocaleString()}
        sub={t("insights.activeAgents", { count: summary.activeAgents })}
        icon={<Icons.Runs className="size-4" />}
      />
      <Stat
        label={t("insights.totalCost")}
        value={`$${summary.totalCostUsd.toFixed(2)}`}
        sub={
          summary.totalRuns > 0
            ? `~$${(summary.totalCostUsd / summary.totalRuns).toFixed(3)} ${t("insights.perRun")}`
            : ""
        }
        icon={<Icons.Cost className="size-4" />}
      />
      <Stat
        label={t("insights.successRate")}
        value={`${(summary.successRate * 100).toFixed(0)}%`}
        sub=""
        accent={successAccent(summary.successRate)}
        icon={<Icons.Success className="size-4" />}
      />
      <Stat
        label={t("insights.active")}
        value={summary.activeRuns.toString()}
        sub={
          summary.activeRuns > 0
            ? t("insights.activeNow")
            : t("insights.idle")
        }
        accent={summary.activeRuns > 0 ? "active" : undefined}
        icon={<Icons.Active className="size-4" />}
      />
    </>
  );
}
