// 팀 패널 — 누가 일하고 있고, 누굴 부를 수 있는지 (xl+). TalkPage 에서 분리(prop 구동).

import { useMemo } from "react";
import { CirclePlay, Crown, Sparkles, Workflow } from "lucide-react";
import type { AgentSpec, RunInfo, WorkflowSpec } from "@loom/core";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";
import { traceIcon, type TraceItem } from "../../lib/derive.js";
import { Avatar } from "./atoms.js";

// ── 팀 패널 — 가능/작업중 에이전트 + 워크플로우 한눈에 (xl 이상) ─────────────────
export function TeamPanel({
  agents,
  workflows,
  runs,
  activities,
  feed,
  active,
  onActive,
  onRunWorkflow,
}: {
  agents: AgentSpec[];
  workflows: WorkflowSpec[];
  runs: RunInfo[];
  activities: Record<string, { agent: string; item: TraceItem | null }>;
  feed: { at: number; runId: string; agent: string; item: TraceItem }[];
  active: string;
  onActive: (name: string) => void;
  onRunWorkflow: (name: string) => void;
}) {
  const { t } = useI18n();
  const workingAgents = useMemo(
    () => new Set(runs.filter((r) => r.status === "running").map((r) => r.agent)),
    [runs],
  );
  const totalCost = useMemo(() => runs.reduce((sum, r) => sum + (r.costUsd ?? 0), 0), [runs]);
  // 에이전트별 라이브 활동(여러 run 이면 아무거나 최신) — 카드에 "지금 하는 일" 표시.
  const liveByAgent = useMemo(() => {
    const m = new Map<string, TraceItem | null>();
    for (const a of Object.values(activities)) m.set(a.agent, a.item);
    return m;
  }, [activities]);
  // 지금 일어나고 있는 핸드오프 — running 자식 run 의 부모 에이전트 → 자식 에이전트.
  const liveHandoffs = useMemo(() => {
    const byId = new Map(runs.map((r) => [r.id, r]));
    return runs
      .filter((r) => r.status === "running" && r.parentRunId)
      .map((r) => ({ from: byId.get(r.parentRunId!)?.agent, to: r.agent }))
      .filter((h): h is { from: string; to: string } => !!h.from);
  }, [runs]);

  const workingCount = workingAgents.size;

  return (
    <aside className="hidden w-[280px] shrink-0 flex-col overflow-y-auto rounded-3xl glass-panel p-5 xl:flex">
      {/* 팀 현황 — 누가 일하고 있나 (선택이 아니라 상태 보드) */}
      <div className="mb-4 flex items-center gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("talk.team")}</h3>
        {workingCount > 0 ? (
          <span className="flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            <span className="size-1.5 animate-pulse rounded-full bg-primary" />
            {workingCount}
          </span>
        ) : null}
        <span className="ml-auto text-[10px] text-muted-foreground/70">{agents.length}</span>
      </div>
      <div className="space-y-0.5">
        {agents.map((a) => {
          const working = workingAgents.has(a.name);
          const on = a.name === active;
          const act = liveByAgent.get(a.name);
          const ActIcon = act ? traceIcon(act) : null;
          return (
            <button
              key={a.name}
              type="button"
              onClick={() => onActive(a.name)}
              title={t("talk.target.change")}
              className={cn(
                "group/ag flex w-full flex-col gap-1 rounded-xl px-2 py-1.5 text-left transition-colors",
                on ? "bg-primary/5 ring-1 ring-primary/30" : "hover:bg-muted/50",
              )}
            >
              <span className="flex w-full items-center gap-2.5">
                <span className="relative inline-flex shrink-0">
                  <Avatar agent={a} size={30} />
                  {/* 상태 점 — 작업 중(펄스 프라이머리) / 대기(회색). 모서리에 반만 걸치게
                      빼내야(translate) 아바타 박스 테두리를 파먹지 않는다. */}
                  <span className={cn(
                    "absolute bottom-0 right-0 size-2.5 translate-x-1/3 translate-y-1/3 rounded-full ring-2 ring-background",
                    working ? "animate-pulse bg-primary" : "bg-muted-foreground/30",
                  )} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{a.label || a.name}</span>
                    {a.master ? <span title={t("talk.target.master")} className="shrink-0"><Crown className="size-3 text-amber-500" /></span> : null}
                    {on ? <span className="shrink-0 rounded-full bg-primary/15 px-1.5 text-[9px] font-semibold uppercase text-primary">{t("talk.talkingTo")}</span> : null}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-muted-foreground">{a.model || a.adapter}</span>
                </span>
              </span>
              {/* 라이브 — 지금 어떤 도구로 뭘 하는지 */}
              {working && act && ActIcon ? (
                <span className="ml-[38px] flex items-center gap-1 rounded-md bg-primary/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  <ActIcon className="size-2.5 shrink-0 text-primary" />
                  <span className="shrink-0">{act.name}</span>
                  {act.target ? <span className="truncate font-mono opacity-75">{act.target.split("/").pop()}</span> : null}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* 진행 중인 핸드오프 — 에이전트끼리 일을 넘기는 순간 */}
      {liveHandoffs.map((h, i) => (
        <div key={i} className="mt-2 flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs shadow-[var(--shadow-glow-sm)]">
          <Workflow className="size-3.5 shrink-0 animate-pulse text-primary" />
          <span className="font-medium">@{h.from}</span>
          <span className="text-primary">→</span>
          <span className="font-medium">@{h.to}</span>
          <span className="ml-auto text-[10px] text-muted-foreground">{t("talk.team.handing")}</span>
        </div>
      ))}

      {/* 활동 스트림 — 누가 언제 어떤 도구/파일을 만졌는지 (최근이 위) */}
      {feed.length > 0 ? (
        <>
          <h3 className="mb-2 mt-6 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Sparkles className="size-3.5" />
            {t("talk.team.activity")}
          </h3>
          <div className="space-y-0.5">
            {[...feed].reverse().slice(0, 12).map((f, i) => {
              const Icon = traceIcon(f.item);
              return (
                <div key={`${f.runId}-${f.at}-${i}`} className={cn("flex flex-col gap-0.5 rounded-md px-1.5 py-1 text-[10px]", i === 0 && "bg-primary/5")}>
                  <span className="flex items-center gap-1.5">
                    <span className="shrink-0 font-mono tabular-nums text-muted-foreground/60">
                      {new Date(f.at).toTimeString().slice(0, 8)}
                    </span>
                    <span className="truncate font-medium text-foreground/80">@{f.agent}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Icon className={cn("size-2.5 shrink-0", i === 0 ? "text-primary" : "text-muted-foreground")} />
                    <span className="shrink-0 text-muted-foreground">{f.item.name}</span>
                    {f.item.target ? (
                      <span className="truncate font-mono text-muted-foreground/70">{f.item.target.split("/").pop()}</span>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {workflows.length > 0 ? (
        <>
          <h3 className="mb-2 mt-6 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Workflow className="size-3.5" />
            {t("talk.team.workflows")}
            <span className="ml-auto text-[10px] text-muted-foreground/70">{workflows.length}</span>
          </h3>
          <div className="space-y-1.5">
            {workflows.map((w) => (
              <button
                key={w.name}
                type="button"
                title={t("talk.workflow.run")}
                onClick={() => onRunWorkflow(w.name)}
                className="group/wf flex w-full items-center gap-2 rounded-3xl border border-border/20 bg-card/50 shadow-xl backdrop-blur-md px-2.5 py-2 text-left text-xs transition-all hover:border-primary/40 hover:shadow-[var(--shadow-glow-sm)]"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover/wf:bg-primary/20">
                  <CirclePlay className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{w.name}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {w.trigger
                      ? `${w.trigger.on} · ${w.trigger.mode === "auto" ? "auto" : "ask"}`
                      : t("talk.team.manual")}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {/* 스레드 총 비용 — CLI 가 보고한 run 만 합산 */}
      {totalCost > 0 ? (
        <div className="mt-auto flex items-center justify-between rounded-xl border border-border/60 px-2.5 py-2 text-xs">
          <span className="text-muted-foreground">{t("talk.team.cost")}</span>
          <span className="font-mono font-medium">${totalCost.toFixed(4)}</span>
        </div>
      ) : null}
    </aside>
  );
}
