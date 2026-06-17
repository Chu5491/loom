// 작업 보드 — "채팅"이 아니라 "분석". 각 작업이 어떤 위임 흐름을 거쳤고(리드→팀원)
// 각 에이전트가 무슨 일을 했는지(파일·단계·결정) 를 한눈에 보는 곳.
// 백엔드 재사용: 한 작업 = 한 스레드(세션 연속성). 목록 행은 그 스레드의 최신 run 을
// useRunStream 으로 비춰 loom-report 요약·작업량을 표시하고, 상세는 전체 파싱 + 위임 트리.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ListTodo, ChevronRight, ChevronLeft, Check, MessageSquare,
  FilePen, Wrench, User, AlertTriangle, Network, ArrowRight, Crown,
} from "lucide-react";
import type { AdapterKind, OfficeEvent, Project, RunInfo } from "@loom/core";
import { api } from "../api/client.js";
import { AgentAvatar } from "./AgentAvatar.js";
import { OrgTree } from "./OrgView.js";
import { useI18n } from "../context/I18nContext.js";
import { useRunStream } from "../hooks/useRunStream.js";
import { extractReport } from "../lib/report.js";

interface Task {
  threadId: string;
  title: string; // 최초 업무 텍스트(지시)
  latest: RunInfo; // 현재 상태를 비출 최신 run
  turns: number; // 사용자 발의 run 수(이어서 횟수)
  agents: string[]; // 위임 순서대로 distinct 에이전트(0번 = 리드)
  delegations: number; // 핸드오프(자식 run) 수
}

/** 프로젝트 run 들을 스레드 단위 "작업"으로 묶고, 위임 체인을 계산한다. 회의/워크플로우 run 제외. */
function groupTasks(runs: RunInfo[]): Task[] {
  const byThread = new Map<string, RunInfo[]>();
  for (const r of runs) {
    if (!r.threadId || r.workflow) continue; // 스레드 없는/워크플로우(회의 포함) run 제외
    const g = byThread.get(r.threadId);
    if (g) g.push(r);
    else byThread.set(r.threadId, [r]);
  }
  const tasks: Task[] = [];
  for (const [threadId, group] of byThread) {
    const sorted = [...group].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const top = sorted.filter((r) => !r.parentRunId); // 사용자 발의 run(핸드오프 자식 제외)
    const latest = sorted[sorted.length - 1]!;
    const lead = top[0]?.agent ?? sorted[0]!.agent;
    // 위임 순서대로 distinct — 리드를 항상 0번에.
    const seen = new Set<string>();
    const agents: string[] = [];
    for (const r of sorted) if (!seen.has(r.agent)) { seen.add(r.agent); agents.push(r.agent); }
    const ordered = [lead, ...agents.filter((n) => n !== lead)];
    tasks.push({
      threadId,
      title: top[0]?.prompt ?? sorted[0]!.prompt,
      latest,
      turns: top.length,
      agents: ordered,
      delegations: sorted.filter((r) => r.parentRunId).length,
    });
  }
  return tasks.sort((a, b) => b.latest.startedAt.localeCompare(a.latest.startedAt));
}

function streamText(events: OfficeEvent[]): string {
  const result = [...events].reverse().find(
    (e): e is Extract<OfficeEvent, { kind: "result" }> => e.kind === "result",
  );
  if (result?.text) return result.text;
  return events
    .filter((e): e is Extract<OfficeEvent, { kind: "text" }> => e.kind === "text")
    .map((e) => e.text)
    .join("");
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** 위임 흐름 — 리드(👑) → 팀원 아바타를 화살표로 잇는다. "어떤 워크플로우로 위임됐나"의 한 줄 요약. */
function DelegationChain({ agents, adapterOf, size = 22 }: { agents: string[]; adapterOf: (n: string) => string; size?: number }) {
  const shown = agents.slice(0, 4);
  const extra = agents.length - shown.length;
  return (
    <div className="flex items-center gap-1">
      {shown.map((name, i) => (
        <div key={name} className="flex items-center gap-1">
          {i > 0 ? <ArrowRight className="size-3 shrink-0 text-muted-foreground/50" /> : null}
          <span className="relative inline-flex shrink-0" title={name}>
            <AgentAvatar adapter={adapterOf(name) as AdapterKind} size={size} className="rounded-md ring-2 ring-card" />
            {i === 0 ? <Crown className="absolute -right-1 -top-1.5 size-3 text-amber-500" /> : null}
          </span>
        </div>
      ))}
      {extra > 0 ? <span className="ml-0.5 text-[11px] font-medium text-muted-foreground">+{extra}</span> : null}
    </div>
  );
}

/** 작업량 통계 칩 묶음 — 위임·파일·단계·시간·비용. 분석용 메타. */
function WorkStats({
  delegations, files, steps, durationMs, costUsd, t,
}: {
  delegations: number; files: number; steps: number; durationMs: number | null; costUsd?: number | null;
  t: (k: string) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] font-medium text-muted-foreground">
      {delegations > 0 ? <span className="inline-flex items-center gap-1" title={t("tasks.delegations")}><Network className="size-3.5" />{delegations}</span> : null}
      {files > 0 ? <span className="inline-flex items-center gap-1" title={t("tasks.files")}><FilePen className="size-3.5" />{files}</span> : null}
      {steps > 0 ? <span className="inline-flex items-center gap-1" title={t("tasks.steps")}><Wrench className="size-3.5" />{steps}</span> : null}
      {durationMs != null ? <span className="tabular-nums">{fmtDuration(durationMs)}</span> : null}
      {costUsd != null && costUsd > 0 ? <span className="tabular-nums">${costUsd.toFixed(4)}</span> : null}
    </div>
  );
}

// 작업 행 — 채팅 버블이 아니라 분석 행: 상태 · 지시 요약 · 위임 흐름 · 작업량.
function TaskRow({
  task,
  adapterOf,
  onOpen,
}: {
  task: Task;
  adapterOf: (name: string) => string;
  onOpen: (threadId: string) => void;
}) {
  const { t } = useI18n();
  const stream = useRunStream(task.latest.id);
  const running = stream.status === "running" && task.latest.status === "running";
  const failed = stream.status === "failed" || task.latest.status === "failed";
  const { body, report } = extractReport(streamText(stream.events));

  const files = report?.files?.length ?? 0;
  const steps = report?.steps?.length ?? 0;
  const durationMs = task.latest.startedAt && task.latest.endedAt
    ? Math.max(0, new Date(task.latest.endedAt).getTime() - new Date(task.latest.startedAt).getTime())
    : null;
  const summary = report?.summary || (body ? body.split("\n").find((l) => l.trim()) ?? "" : "");

  return (
    <button
      type="button"
      onClick={() => onOpen(task.threadId)}
      className={`group flex w-full items-stretch gap-4 rounded-2xl border bg-card px-4 py-3.5 text-left shadow-sm transition-all hover:border-primary/40 hover:shadow-md ${running ? "border-primary/40 ring-1 ring-primary/10" : "border-border"}`}
    >
      {/* 상태 표시 — 왼쪽 색 바 + 아이콘 */}
      <div className="flex shrink-0 flex-col items-center justify-center">
        {running ? (
          <span className="relative flex size-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" /><span className="relative inline-flex size-2.5 rounded-full bg-primary" /></span>
        ) : failed ? (
          <span className="flex size-6 items-center justify-center rounded-full bg-destructive/10 text-destructive"><AlertTriangle className="size-3.5" /></span>
        ) : (
          <span className="flex size-6 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><Check className="size-3.5" /></span>
        )}
      </div>

      {/* 본문 — 지시 + 결과 요약 한 줄 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[14px] font-medium text-foreground">{task.title}</p>
          {task.turns > 1 ? <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">+{task.turns - 1} {t("tasks.turns")}</span> : null}
        </div>
        <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
          {failed ? t("tasks.failedHint") : summary ? summary : running ? `${t("tasks.working")}…` : t("tasks.noOutput")}
        </p>
        <div className="mt-2">
          <WorkStats delegations={task.delegations} files={files} steps={steps} durationMs={running ? null : durationMs} costUsd={task.latest.costUsd} t={t} />
        </div>
      </div>

      {/* 위임 흐름 — 리드 → 팀원 */}
      <div className="hidden shrink-0 flex-col items-end justify-center gap-1 sm:flex">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">{t("tasks.d.flow")}</span>
        <DelegationChain agents={task.agents} adapterOf={adapterOf} />
      </div>

      <ChevronRight className="size-4 shrink-0 self-center text-muted-foreground/40 transition-colors group-hover:text-foreground" />
    </button>
  );
}

// 작업 상세 — 컴팩트한 지시 바 + 위임 흐름(마스터→팀원). 각 에이전트의 loom-report
// 상세(요약·단계·결정·파일·도구·비용·받은 지시)는 AgentResultCard 가 노드별로 보여준다.
function TaskDetail({
  task,
  adapterOf,
  onBack,
}: {
  task: Task;
  adapterOf: (name: string) => string;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const running = task.latest.status === "running";
  const durationMs = task.latest.startedAt && task.latest.endedAt
    ? Math.max(0, new Date(task.latest.endedAt).getTime() - new Date(task.latest.startedAt).getTime())
    : null;

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto pb-12">
      <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ChevronLeft className="size-4" />{t("tasks.d.back")}
      </button>

      {/* 지시(대표) + 참여 체인 + 전체 작업량 — 한 블록에 한눈에 */}
      <div className="rounded-2xl border border-border bg-muted/20 p-3.5">
        <p className="mb-1 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <User className="size-3.5" />{t("tasks.d.request")}
        </p>
        <p className="whitespace-pre-wrap text-sm text-foreground">{task.title}</p>
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-2.5">
          <DelegationChain agents={task.agents} adapterOf={adapterOf} size={22} />
          <WorkStats delegations={task.delegations} files={0} steps={0} durationMs={running ? null : durationMs} costUsd={task.latest.costUsd} t={t} />
        </div>
      </div>

      {/* 연결선 — 대표 지시 → 마스터 */}
      <div className="ml-5 h-4 w-px bg-gradient-to-b from-border to-primary/40" />

      {/* 흐름 — 마스터 → 팀원. 노드별 받은 지시·답변·작업량까지. */}
      <OrgTree threadId={task.threadId} adapterOf={adapterOf} />
    </div>
  );
}

export function TasksView({ project }: { project: Project }) {
  const { t } = useI18n();
  const office = useQuery({ queryKey: ["office"], queryFn: api.getOffice });
  const agents = useMemo(() => office.data?.office.agents ?? [], [office.data]);
  const adapterOf = (name: string) => agents.find((a) => a.name === name)?.adapter ?? "claude-code";

  const runsQ = useQuery({
    queryKey: ["runs", "project", project.id],
    queryFn: () => api.listProjectRuns(project.id),
    refetchInterval: 4000,
    refetchIntervalInBackground: true,
  });
  const tasks = useMemo(() => groupTasks(runsQ.data?.runs ?? []), [runsQ.data]);
  const runningCount = useMemo(() => tasks.filter((x) => x.latest.status === "running").length, [tasks]);

  const [selected, setSelected] = useState<string | null>(null); // 열어둔 작업 threadId

  // 대화의 [작업 보기] → loom:cmd { view:"tasks", threadId } 로 특정 작업 상세 열기.
  useEffect(() => {
    const onCmd = (e: Event) => {
      const d = (e as CustomEvent<{ view?: string; threadId?: string }>).detail;
      if (d?.view === "tasks" && d.threadId) setSelected(d.threadId);
    };
    window.addEventListener("loom:cmd", onCmd);
    return () => window.removeEventListener("loom:cmd", onCmd);
  }, []);

  const current = selected ? tasks.find((x) => x.threadId === selected) ?? null : null;
  // 새 작업/이어서는 대화에서 마스터에게 — 작업탭은 분석 전용(req 8, 채팅 없음).
  const goTalk = () => window.dispatchEvent(new CustomEvent("loom:cmd", { detail: { view: "talk" } }));

  // 작업 상세 — 전체 파싱 결과 + 위임 흐름.
  if (current) {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col p-4 sm:p-6 lg:p-8">
        <TaskDetail task={current} adapterOf={adapterOf} onBack={() => setSelected(null)} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      {/* 헤더 — 분석 전용(채팅 없음). 새 작업은 대화에서 마스터에게. */}
      <div className="mx-auto flex w-full max-w-4xl shrink-0 flex-col gap-3">
        <div className="flex items-end justify-between gap-3 px-1">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">{t("ws.tasks")}</h2>
            <p className="text-[13px] text-muted-foreground">{t("tasks.subtitle")}</p>
          </div>
          {tasks.length > 0 ? (
            <div className="shrink-0 text-right text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground">{tasks.length}</span> {t("tasks.statTasks")}
              {runningCount > 0 ? <> · <span className="font-semibold text-primary">{runningCount}</span> {t("tasks.statRunning")}</> : null}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={goTalk}
          className="group flex items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-3.5 py-2.5 text-left text-[13px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <MessageSquare className="size-4 shrink-0 text-primary" />
          <span className="flex-1">{t("tasks.newInTalk")}</span>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-primary" />
        </button>
      </div>

      {/* 작업 목록 — 분석 행 */}
      <div className="scrollbar-thin mx-auto w-full max-w-4xl flex-1 overflow-y-auto pb-10 pr-2">
        {tasks.length === 0 ? (
          <div className="flex h-[40vh] flex-col items-center justify-center gap-4 text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl border border-border/50 bg-muted/50 shadow-inner">
              <ListTodo className="size-8 text-muted-foreground/50" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-medium text-foreground">{t("tasks.empty")}</h3>
              <p className="max-w-sm text-sm text-muted-foreground">{t("tasks.emptySub")}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {tasks.map((task) => (
              <TaskRow key={task.threadId} task={task} adapterOf={adapterOf} onOpen={setSelected} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
