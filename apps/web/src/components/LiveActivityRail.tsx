import { useMemo } from "react";
import type { AdapterManifest, Agent, Run } from "@loom/core";
import { AgentAvatar } from "./Chat.js";
import { Badge } from "./ui/badge.js";
import { useI18n } from "../context/I18nContext.js";
import { agentColorOf, classesFor } from "./agentColor.js";
import { cn } from "../lib/utils.js";

/**
 * Always-visible right rail showing every recent run in the project,
 * across threads. Gives the room ambient awareness — "Agent-Dev just
 * touched index.js, Agent-Design suggested a layout change" — without
 * having to flip between threads or open a history page.
 *
 * Each entry is a click-target that jumps the chat to the matching
 * run (using the existing loom:jumpToRun custom event so the
 * mechanism stays loose-coupled with WorkspacePage).
 */
export function LiveActivityRail({
  agents,
  manifests,
  runs,
}: {
  agents: Agent[];
  manifests: AdapterManifest[];
  runs: Run[];
}) {
  const { t } = useI18n();

  const sorted = useMemo(
    () =>
      [...runs].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [runs],
  );

  const workingCount = sorted.filter(
    (r) => r.status === "running" || r.status === "queued",
  ).length;

  return (
    <aside className="hidden lg:flex w-72 shrink-0 flex-col border-l border-border bg-card">
      <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("liveActivity.title")}
          </span>
          {workingCount > 0 ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400 mono">
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {workingCount}
            </span>
          ) : null}
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto subtle-scrollbar">
        {sorted.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground/70 italic">
            {t("liveActivity.empty")}
          </p>
        ) : (
          <ul className="divide-y divide-border/40">
            {sorted.slice(0, 50).map((r) => {
              const a = agents.find((x) => x.id === r.agentId);
              const m = a
                ? manifests.find((mm) => mm.kind === a.adapterKind)
                : undefined;
              return (
                <li key={r.id}>
                  <ActivityItem run={r} agent={a} manifest={m} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

function ActivityItem({
  run,
  agent,
  manifest,
}: {
  run: Run;
  agent: Agent | undefined;
  manifest: AdapterManifest | undefined;
}) {
  const { t } = useI18n();
  const cls = agent ? classesFor(agentColorOf(agent)) : null;
  const working = run.status === "running" || run.status === "queued";
  const summary = run.prompt.length > 90 ? run.prompt.slice(0, 90) + "…" : run.prompt;

  const onClick = () => {
    window.dispatchEvent(
      new CustomEvent("loom:jumpToRun", { detail: { runId: run.id } }),
    );
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors group"
    >
      <div className="flex items-start gap-2">
        {agent ? (
          <AgentAvatar
            agent={agent}
            manifest={manifest}
            working={working}
            size="sm"
          />
        ) : (
          <span className="size-6 rounded-full bg-muted shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span
              className={cn(
                "text-xs font-semibold truncate",
                cls?.text ?? "text-foreground",
              )}
            >
              @{agent?.name ?? "unknown"}
            </span>
            <span className="text-[10px] text-muted-foreground/70 mono shrink-0">
              {timeAgo(run.createdAt)}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2 break-words">
            {summary}
          </p>
          <div className="mt-1 flex items-center gap-1.5">
            <StatusChip status={run.status} />
            {typeof run.costUsd === "number" ? (
              <span className="text-[10px] text-muted-foreground/60 mono">
                ${run.costUsd.toFixed(3)}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      {/* a11y label not visible — hover/focus reveals "jump" intent */}
      <span className="sr-only">{t("liveActivity.jumpToRun")}</span>
    </button>
  );
}

function StatusChip({ status }: { status: Run["status"] }) {
  const variant = (() => {
    switch (status) {
      case "succeeded":
        return "success" as const;
      case "failed":
        return "destructive" as const;
      case "cancelled":
        return "warning" as const;
      case "running":
      case "queued":
        return "info" as const;
      default:
        return "secondary" as const;
    }
  })();
  return (
    <Badge variant={variant} className="h-3.5 px-1 text-[9px]">
      {status}
    </Badge>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
