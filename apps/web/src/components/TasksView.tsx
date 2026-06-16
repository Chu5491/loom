// 작업 보드 — "채팅" 대신 "업무 → 결과 카드". 업무만 주면 결과만 받는 흐름.
// 백엔드 재사용: 한 작업 = 한 스레드(세션 연속성). 카드는 그 스레드의 최신 run 을
// useRunStream 으로 비춰 loom-report(결과 양식)를 구조화 표시한다. "이어서"는 같은
// 스레드에 run 을 더해 세션을 잇고, 채팅창 없이도 반복 수정이 된다.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, ListTodo, RotateCcw, CornerDownRight, ChevronRight, Check, Sparkles, FilePen, Wrench } from "lucide-react";
import type { AdapterKind, OfficeEvent, Project, RunInfo } from "@loom/core";
import { api } from "../api/client.js";
import { AgentAvatar } from "./AgentAvatar.js";
import { Markdown } from "./Markdown.js";
import { Button } from "./ui.js";
import { useI18n } from "../context/I18nContext.js";
import { useRunStream } from "../hooks/useRunStream.js";
import { extractReport } from "../lib/report.js";

interface Task {
  threadId: string;
  title: string; // 최초 업무 텍스트(지시)
  latest: RunInfo; // 현재 상태를 비출 최신 run
  turns: number; // 이 작업에 쌓인 run 수(이어서 횟수)
}

/** 프로젝트 run 들을 스레드 단위 "작업"으로 묶는다. 회의/워크플로우 run 은 제외. */
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
    tasks.push({
      threadId,
      title: top[0]?.prompt ?? sorted[0]!.prompt,
      latest,
      turns: top.length,
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

function TaskCard({
  task,
  adapterOf,
  onFollowUp,
  onOpen,
}: {
  task: Task;
  adapterOf: (name: string) => string;
  onFollowUp: (task: Task, text: string) => void;
  onOpen: (threadId: string) => void;
}) {
  const { t } = useI18n();
  const stream = useRunStream(task.latest.id);
  const running = stream.status === "running" && task.latest.status === "running";
  const failed = stream.status === "failed" || task.latest.status === "failed";
  const { body, report } = extractReport(streamText(stream.events));
  const [followOpen, setFollowOpen] = useState(false);
  const [followText, setFollowText] = useState("");

  const files = report?.files ?? [];
  const durationMs = task.latest.startedAt && task.latest.endedAt
    ? Math.max(0, new Date(task.latest.endedAt).getTime() - new Date(task.latest.startedAt).getTime())
    : null;

  const submitFollow = () => {
    if (!followText.trim()) return;
    onFollowUp(task, followText.trim());
    setFollowText("");
    setFollowOpen(false);
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      {/* 헤더 — 누가 + 상태 */}
      <div className="mb-2 flex items-center gap-2">
        <AgentAvatar adapter={adapterOf(task.latest.agent) as AdapterKind} size={24} className="rounded-lg" />
        <span className="text-sm font-semibold text-foreground">@{task.latest.agent}</span>
        {task.turns > 1 ? (
          <span className="rounded-full bg-muted/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">+{task.turns - 1}</span>
        ) : null}
        <span className="ml-auto inline-flex items-center gap-1 text-[11px]">
          {running ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
              <Loader2 className="size-3 animate-spin" />
              {t("tasks.working")}
            </span>
          ) : failed ? (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 font-medium text-destructive">{t("tasks.failed")}</span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-600 dark:text-emerald-400">
              <Check className="size-3" />
              {t("tasks.done")}
            </span>
          )}
        </span>
      </div>

      {/* 지시(업무) — 작은 인용 */}
      <p className="mb-3 line-clamp-2 border-l-2 border-border pl-2.5 text-[13px] text-muted-foreground">{task.title}</p>

      {/* 결과 */}
      {failed ? (
        <p className="text-sm text-destructive">{t("tasks.failedHint")}</p>
      ) : report?.summary ? (
        <p className="text-sm font-medium leading-relaxed text-foreground">{report.summary}</p>
      ) : body ? (
        <div className="max-w-none text-sm leading-relaxed text-foreground/90">
          <Markdown>{body.length > 600 ? body.slice(0, 600) + "…" : body}</Markdown>
        </div>
      ) : running ? (
        <p className="text-sm text-muted-foreground">{t("tasks.working")}…</p>
      ) : (
        <p className="text-sm text-muted-foreground">{t("tasks.noOutput")}</p>
      )}

      {/* 결정·파일 칩(있으면) */}
      {report?.decisions?.length ? (
        <ul className="mt-2 space-y-1">
          {report.decisions.slice(0, 3).map((d, i) => (
            <li key={i} className="flex gap-1.5 text-[12px] text-foreground/80">
              <Sparkles className="mt-0.5 size-3 shrink-0 text-primary" />
              <span>{d}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* 푸터 — 스탯 + 액션 */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/50 pt-2.5 text-[11px] text-muted-foreground">
        {files.length ? <span className="inline-flex items-center gap-1"><FilePen className="size-3" />{files.length}</span> : null}
        {report?.steps?.length ? <span className="inline-flex items-center gap-1"><Wrench className="size-3" />{report.steps.length}</span> : null}
        {durationMs != null ? <span>{fmtDuration(durationMs)}</span> : null}
        {task.latest.costUsd != null && task.latest.costUsd > 0 ? <span>${task.latest.costUsd.toFixed(4)}</span> : null}

        <div className="ml-auto flex items-center gap-1">
          {!running ? (
            <>
              <button
                type="button"
                onClick={() => setFollowOpen((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              >
                <CornerDownRight className="size-3" />
                {t("tasks.followUp")}
              </button>
              <button
                type="button"
                onClick={() => void api.rerunRun(task.latest.id).catch(() => {})}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              >
                <RotateCcw className="size-3" />
                {t("tasks.rerun")}
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => onOpen(task.threadId)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            {t("tasks.detail")}
            <ChevronRight className="size-3" />
          </button>
        </div>
      </div>

      {/* 이어서 입력 — 채팅창 없이 같은 스레드(세션)로 반복 수정 */}
      {followOpen ? (
        <div className="mt-2 flex items-end gap-2">
          <textarea
            value={followText}
            onChange={(e) => setFollowText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitFollow(); }}
            placeholder={t("tasks.followPlaceholder")}
            rows={2}
            className="min-w-0 flex-1 resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
          />
          <Button onClick={submitFollow} disabled={!followText.trim()} className="shrink-0">
            <Send className="size-4" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function TasksView({ project }: { project: Project }) {
  const { t } = useI18n();
  const qc = useQueryClient();
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

  const [input, setInput] = useState("");
  const [target, setTarget] = useState("auto"); // "auto" | agent name

  const refetch = () => void qc.invalidateQueries({ queryKey: ["runs", "project", project.id] });

  const assign = useMutation({
    mutationFn: async () => {
      const prompt = input.trim();
      const { thread } = await api.createThread(prompt.slice(0, 60), project.id);
      if (target === "auto") {
        await api.dispatchRun({ prompt, projectId: project.id, threadId: thread.id });
      } else {
        await api.startRun({ agent: target, prompt, projectId: project.id, threadId: thread.id });
      }
    },
    onSuccess: () => { setInput(""); refetch(); },
  });

  const followUp = (task: Task, text: string) => {
    void api
      .startRun({ agent: task.latest.agent, prompt: text, projectId: project.id, threadId: task.threadId })
      .then(refetch)
      .catch(() => {});
  };

  const openThread = (threadId: string) => {
    // 상세 = 그 작업의 대화 뷰(전체 맥락). 기존 대화 탭으로 점프.
    window.dispatchEvent(new CustomEvent("loom:cmd", { detail: { view: "talk", threadId } }));
  };

  const canAssign = input.trim().length > 0 && !assign.isPending;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-4 p-4 sm:p-6">
      {/* 컴포저 — 업무를 맡긴다 */}
      <div className="mx-auto w-full max-w-3xl shrink-0">
        <div className="rounded-2xl border border-border bg-card p-3 shadow-sm transition-all focus-within:border-primary/50 focus-within:shadow-md">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canAssign) assign.mutate(); }}
            placeholder={t("tasks.placeholder")}
            rows={3}
            className="w-full resize-y bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          <div className="mt-2 flex items-center gap-2">
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
            >
              <option value="auto">🎯 {t("tasks.auto")}</option>
              {agents.map((a) => (
                <option key={a.name} value={a.name}>{a.name}</option>
              ))}
            </select>
            <Button onClick={() => assign.mutate()} disabled={!canAssign} className="ml-auto">
              {assign.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {t("tasks.assign")}
            </Button>
          </div>
        </div>
        {assign.isError ? (
          <p className="mt-2 text-sm text-destructive">
            {assign.error instanceof Error ? assign.error.message : String(assign.error)}
          </p>
        ) : null}
      </div>

      {/* 결과 피드 */}
      <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto">
        {tasks.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <ListTodo className="size-8 opacity-40" />
            <p className="text-sm">{t("tasks.empty")}</p>
          </div>
        ) : (
          <div className="space-y-3 pb-6">
            {tasks.map((task) => (
              <TaskCard key={task.threadId} task={task} adapterOf={adapterOf} onFollowUp={followUp} onOpen={openThread} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
