import { useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import NumberFlow from "@number-flow/react";
import type { AdapterManifest, Agent, Run } from "@loom/core";
import { AgentAvatar } from "./Chat.js";
import { Badge } from "./ui/badge.js";
import { useI18n } from "../context/I18nContext.js";
import { agentColorOf, classesFor } from "./agentColor.js";
import { cn } from "../lib/utils.js";
import { formatTimeAgo } from "../lib/timeAgo.js";
import { useAutoAnimate } from "../lib/useAutoAnimate.js";
import { emit } from "../lib/loomEvents.js";

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

  // 시간대별 버킷 — "Live > 방금 > 오늘 > 이전" 헤더로 끊으면 단조로운
  // 리스트가 흐름 있는 타임라인처럼 보임. running은 시간 무관하게 항상 Live.
  const groups = useMemo(() => {
    const live: Run[] = [];
    const recent: Run[] = [];
    const today: Run[] = [];
    const earlier: Run[] = [];
    const now = Date.now();
    for (const r of sorted) {
      if (r.status === "running" || r.status === "queued") {
        live.push(r);
        continue;
      }
      const age = now - new Date(r.createdAt).getTime();
      if (age < 5 * 60 * 1000) recent.push(r);
      else if (age < 24 * 60 * 60 * 1000) today.push(r);
      else earlier.push(r);
    }
    return [
      { key: "live", label: t("liveActivity.bucket.live"), runs: live },
      { key: "recent", label: t("liveActivity.bucket.recent"), runs: recent },
      { key: "today", label: t("liveActivity.bucket.today"), runs: today },
      { key: "earlier", label: t("liveActivity.bucket.earlier"), runs: earlier },
    ].filter((g) => g.runs.length > 0);
  }, [sorted, t]);

  const workingCount = groups.find((g) => g.key === "live")?.runs.length ?? 0;

  const listRef = useAutoAnimate<HTMLDivElement>({
    duration: 240,
    easing: "ease-out",
  });

  return (
    <aside className="hidden lg:flex w-72 shrink-0 flex-col border-l border-border bg-card">
      <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("liveActivity.title")}
          </span>
          <AnimatePresence>
            {workingCount > 0 ? (
              <motion.span
                key="working-count"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="inline-flex items-center gap-1 text-[10px] font-medium text-success mono"
              >
                <motion.span
                  className="size-1.5 rounded-full bg-emerald-500"
                  animate={{ opacity: [1, 0.4, 1], scale: [1, 1.25, 1] }}
                  transition={{
                    duration: 1.4,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
                <NumberFlow value={workingCount} />
              </motion.span>
            ) : null}
          </AnimatePresence>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto subtle-scrollbar">
        {sorted.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground/70 italic">
            {t("liveActivity.empty")}
          </p>
        ) : (
          <div ref={listRef}>
            {groups.map((g) => (
              <section key={g.key}>
                <header className="sticky top-0 z-[1] bg-card/95 backdrop-blur-sm flex items-center gap-1.5 px-3 h-6 border-b border-border/40">
                  {g.key === "live" ? (
                    <motion.span
                      aria-hidden
                      className="size-1.5 rounded-full bg-emerald-500"
                      animate={{ opacity: [1, 0.4, 1] }}
                      transition={{
                        duration: 1.4,
                        repeat: Infinity,
                        ease: "easeInOut",
                      }}
                    />
                  ) : null}
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                    {g.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60 mono ml-auto">
                    {g.runs.length}
                  </span>
                </header>
                <ul className="divide-y divide-border/40">
                  {g.runs.slice(0, 50).map((r) => {
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
              </section>
            ))}
          </div>
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

  const onClick = () => emit("jumpToRun", { runId: run.id });

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors group"
    >
      {/* 활성 항목 좌측 글로우 — 레일을 빠르게 훑어도 working 줄이 시각적으로 튐. */}
      <AnimatePresence>
        {working && cls ? (
          <motion.span
            key="rail-glow"
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className={cn(
              "pointer-events-none absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-gradient-to-b",
              cls.gradientFrom,
              cls.gradientVia,
              cls.gradientTo,
            )}
          />
        ) : null}
      </AnimatePresence>
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
              {formatTimeAgo(run.createdAt, t)}
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

