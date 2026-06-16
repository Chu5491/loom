// 작업 보드 — "채팅" 대신 "업무 → 결과 카드". 업무만 주면 결과만 받는 흐름.
// 백엔드 재사용: 한 작업 = 한 스레드(세션 연속성). 카드는 그 스레드의 최신 run 을
// useRunStream 으로 비춰 loom-report(결과 양식)를 구조화 표시한다. "이어서"는 같은
// 스레드에 run 을 더해 세션을 잇고, 채팅창 없이도 반복 수정이 된다.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, ListTodo, RotateCcw, CornerDownRight, ChevronRight, ChevronLeft, Check, Sparkles, FilePen, FileText, Wrench, User, Play, ListChecks, AlertTriangle, HelpCircle, Network } from "lucide-react";
import type { AdapterKind, OfficeEvent, Project, RunInfo } from "@loom/core";
import { api } from "../api/client.js";
import { AgentAvatar } from "./AgentAvatar.js";
import { Markdown } from "./Markdown.js";
import { OrgTree } from "./OrgView.js";
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
    <div className={`relative flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm transition-all hover:shadow-md ${running ? "border-primary/40 shadow-primary/5 ring-1 ring-primary/10" : "border-border"}`}>
      {/* 1. User Request (The Task) */}
      <div className="flex gap-3">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <User className="size-4" />
        </div>
        <div className="flex-1 pt-0.5">
          <p className="text-[14px] font-medium leading-snug text-foreground/90">{task.title}</p>
        </div>
        {/* Status Badge Top Right */}
        <div className="flex items-start shrink-0">
          {running ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary shadow-sm">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex size-2 rounded-full bg-primary"></span>
              </span>
              {t("tasks.working")}
            </span>
          ) : failed ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-destructive/20 bg-destructive/10 px-2.5 py-1 text-[11px] font-medium text-destructive">{t("tasks.failed")}</span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              <Check className="size-3" />
              {t("tasks.done")}
            </span>
          )}
        </div>
      </div>

      <div className="ml-3.5 border-l-2 border-border/50 pl-6 pb-2">
        {/* 2. Agent Response */}
        <div className="flex gap-3">
          <div className="relative mt-1 shrink-0">
            <AgentAvatar adapter={adapterOf(task.latest.agent) as AdapterKind} size={28} className="rounded-lg shadow-sm ring-2 ring-background" />
            {running && (
              <span className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full bg-background shadow-sm">
                <Loader2 className="size-3 animate-spin text-primary" />
              </span>
            )}
          </div>
          
          <div className="flex-1 space-y-3 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">@{task.latest.agent}</span>
              {task.turns > 1 && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">+{task.turns - 1} turns</span>
              )}
            </div>

            {/* Output Block */}
            <div className="rounded-xl border border-border/50 bg-muted/30 p-3.5 text-[13px] text-foreground/90 shadow-sm">
              {failed ? (
                <p className="text-destructive">{t("tasks.failedHint") || "Task failed to complete."}</p>
              ) : report?.summary ? (
                <p className="font-medium leading-relaxed">{report.summary}</p>
              ) : body ? (
                <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
                  <Markdown>{body.length > 600 ? body.slice(0, 600) + "…" : body}</Markdown>
                </div>
              ) : running ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  <span className="animate-pulse">{t("tasks.working")}...</span>
                </div>
              ) : (
                <p className="text-muted-foreground italic">{t("tasks.noOutput") || "No detailed output provided."}</p>
              )}
            </div>

            {/* Decisions / Metadata Pills */}
            {report?.decisions?.length ? (
              <ul className="flex flex-wrap gap-2">
                {report.decisions.slice(0, 3).map((d, i) => (
                  <li key={i} className="inline-flex items-center gap-1.5 rounded-md bg-primary/5 px-2 py-1 text-[11px] font-medium text-primary/80 border border-primary/10">
                    <Sparkles className="size-3 shrink-0" />
                    <span className="truncate max-w-[250px]">{d}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {/* Footer Stats & Actions */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 text-[12px] text-muted-foreground font-medium">
              {files.length > 0 && <span className="inline-flex items-center gap-1.5"><FilePen className="size-3.5" />{files.length} files</span>}
              {report?.steps?.length ? <span className="inline-flex items-center gap-1.5"><Wrench className="size-3.5" />{report.steps.length} steps</span> : null}
              {durationMs != null && <span>{fmtDuration(durationMs)}</span>}
              {task.latest.costUsd != null && task.latest.costUsd > 0 && <span>${task.latest.costUsd.toFixed(4)}</span>}

              <div className="ml-auto flex items-center gap-1">
                {!running && (
                  <>
                    <button
                      type="button"
                      onClick={() => setFollowOpen((v) => !v)}
                      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-muted hover:text-foreground transition-colors"
                    >
                      <CornerDownRight className="size-3.5" />
                      {t("tasks.followUp") || "Follow up"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void api.rerunRun(task.latest.id).catch(() => {})}
                      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-muted hover:text-foreground transition-colors"
                    >
                      <RotateCcw className="size-3.5" />
                      {t("tasks.rerun") || "Rerun"}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => onOpen(task.threadId)}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-muted hover:text-foreground transition-colors text-foreground"
                >
                  {t("tasks.detail") || "Details"}
                  <ChevronRight className="size-3.5" />
                </button>
              </div>
            </div>

            {/* Follow-up Input */}
            {followOpen && (
              <div className="mt-3 flex items-end gap-2 overflow-hidden rounded-xl border border-primary/30 bg-background shadow-sm focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20 transition-all p-1">
                <textarea
                  value={followText}
                  onChange={(e) => setFollowText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitFollow(); }}
                  placeholder={t("tasks.followPlaceholder") || "Add instructions to continue..."}
                  rows={1}
                  className="min-w-0 flex-1 resize-none bg-transparent px-3 py-2 text-sm outline-none"
                  style={{ minHeight: '40px' }}
                />
                <Button size="sm" variant="ghost" onClick={submitFollow} disabled={!followText.trim()} className="mb-0.5 mr-0.5 h-8 w-8 shrink-0 p-0 hover:bg-primary/10 hover:text-primary">
                  <Send className="size-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// 작업 상세 — loom-report 를 최대한 파싱해 수행 내용을 섹션별로 + 위임 흐름 트리.
function TaskDetail({
  task,
  adapterOf,
  onBack,
  onFollowUp,
}: {
  task: Task;
  adapterOf: (name: string) => string;
  onBack: () => void;
  onFollowUp: (task: Task, text: string) => void;
}) {
  const { t } = useI18n();
  const stream = useRunStream(task.latest.id);
  const { body, report } = extractReport(streamText(stream.events));
  const running = stream.status === "running" && task.latest.status === "running";
  const [followText, setFollowText] = useState("");

  const sections: { key: string; icon: React.ReactNode; title: string; items: string[]; tone?: string }[] = [];
  if (report?.steps?.length) sections.push({ key: "steps", icon: <ListChecks className="size-3.5" />, title: t("tasks.d.steps"), items: report.steps });
  if (report?.decisions?.length) sections.push({ key: "decisions", icon: <Sparkles className="size-3.5" />, title: t("tasks.d.decisions"), items: report.decisions });
  if (report?.blockers?.length) sections.push({ key: "blockers", icon: <AlertTriangle className="size-3.5" />, title: t("tasks.d.blockers"), items: report.blockers, tone: "warn" });

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 overflow-y-auto pb-12">
      <button type="button" onClick={onBack} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ChevronLeft className="size-4" />{t("tasks.d.back")}
      </button>

      {/* 지시 */}
      <div className="mb-5 rounded-2xl border border-border bg-muted/20 p-4">
        <p className="mb-1 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <User className="size-3.5" />{t("tasks.d.request")}
        </p>
        <p className="whitespace-pre-wrap text-sm text-foreground">{task.title}</p>
      </div>

      {/* 결과 — loom-report 전체 파싱 */}
      <h3 className="mb-2 text-sm font-bold text-foreground">{t("tasks.d.result")}</h3>
      <div className="mb-6 rounded-2xl border border-border bg-card p-4 shadow-sm">
        {report?.summary ? <p className="text-sm font-medium leading-relaxed text-foreground">{report.summary}</p> : null}
        {!report && body ? <div className="max-w-none text-sm leading-relaxed text-foreground/90"><Markdown>{body}</Markdown></div> : null}
        {!report && !body ? <p className="text-sm text-muted-foreground">{running ? `${t("tasks.working")}…` : t("tasks.noOutput")}</p> : null}

        {sections.map((s) => (
          <div key={s.key} className="mt-4">
            <p className={`mb-1.5 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${s.tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
              {s.icon}{s.title}
            </p>
            <ul className="space-y-1">
              {s.items.map((it, i) => (
                <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-foreground/90">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/60" />
                  <span>{it}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {report?.files?.length ? (
          <div className="mt-4">
            <p className="mb-1.5 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <FilePen className="size-3.5" />{t("tasks.d.files")} ({report.files.length})
            </p>
            <ul className="space-y-1">
              {report.files.map((f, i) => (
                <li key={i} className="flex items-center gap-2 font-mono text-[12px] text-foreground/80">
                  <FileText className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{f.path}</span>
                  {f.action ? <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">{f.action}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {report?.question ? (
          <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p className="mb-1 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
              <HelpCircle className="size-3.5" />{t("tasks.d.question")}
            </p>
            <p className="text-sm text-foreground/90">{report.question}</p>
          </div>
        ) : null}
      </div>

      {/* 흐름 — 당신 → 리드 → 팀원 위임 트리 */}
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-foreground"><Network className="size-4" />{t("tasks.d.flow")}</h3>
      <div className="mb-6">
        <OrgTree threadId={task.threadId} request={task.title} adapterOf={adapterOf} />
      </div>

      {/* 이어서 */}
      {!running ? (
        <div className="flex items-end gap-2">
          <textarea
            value={followText}
            onChange={(e) => setFollowText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && followText.trim()) { onFollowUp(task, followText.trim()); setFollowText(""); } }}
            placeholder={t("tasks.followPlaceholder")}
            rows={2}
            className="min-w-0 flex-1 resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
          />
          <Button onClick={() => { if (followText.trim()) { onFollowUp(task, followText.trim()); setFollowText(""); } }} disabled={!followText.trim()} className="shrink-0">
            <CornerDownRight className="size-4" />{t("tasks.followUp")}
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

  const canAssign = input.trim().length > 0 && !assign.isPending;
  const current = selected ? tasks.find((x) => x.threadId === selected) ?? null : null;

  // 작업 상세 — 전체 파싱 결과 + 위임 흐름.
  if (current) {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col p-4 sm:p-6 lg:p-8">
        <TaskDetail task={current} adapterOf={adapterOf} onBack={() => setSelected(null)} onFollowUp={followUp} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8 bg-background/50">
      {/* Header & Composer */}
      <div className="mx-auto w-full max-w-4xl shrink-0 flex flex-col gap-4">
        <div className="flex items-center justify-between px-1">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">{t("ws.tasks") || "Tasks"}</h2>
            <p className="text-[13px] text-muted-foreground">{t("tasks.subtitle") || "Assign discrete units of work. Review results without chat overhead."}</p>
          </div>
        </div>

        <div className="group relative rounded-2xl border border-border bg-card p-1.5 shadow-sm transition-all focus-within:border-primary/50 focus-within:shadow-md focus-within:ring-1 focus-within:ring-primary/20">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canAssign) assign.mutate(); }}
            placeholder={t("tasks.placeholder") || "Describe a task to assign..."}
            rows={2}
            className="w-full resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/70"
            style={{ minHeight: '60px' }}
          />
          <div className="flex items-center justify-between border-t border-border/40 bg-muted/20 px-2 py-1.5 rounded-xl mt-1">
            <div className="flex items-center gap-2">
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="cursor-pointer appearance-none rounded-lg border-none bg-transparent px-2.5 py-1 text-xs font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground transition-colors"
              >
                <option value="auto">🎯 {t("tasks.auto") || "Auto"}</option>
                {agents.map((a) => (
                  <option key={a.name} value={a.name}>{a.name}</option>
                ))}
              </select>
            </div>
            
            <div className="flex items-center gap-3">
              <span className="hidden sm:inline-block text-[10px] text-muted-foreground font-medium">
                Cmd + Enter
              </span>
              <Button onClick={() => assign.mutate()} disabled={!canAssign} size="sm" className="h-8 gap-1.5 rounded-lg px-3">
                {assign.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5 fill-current" />}
                {t("tasks.assign") || "Assign"}
              </Button>
            </div>
          </div>
        </div>
        
        {assign.isError && (
          <p className="text-sm text-destructive px-2">
            {assign.error instanceof Error ? assign.error.message : String(assign.error)}
          </p>
        )}
      </div>

      {/* Results Feed */}
      <div className="mx-auto w-full max-w-4xl flex-1 overflow-y-auto pr-2 pb-10 scrollbar-thin">
        {tasks.length === 0 ? (
          <div className="flex h-[40vh] flex-col items-center justify-center gap-4 text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-muted/50 border border-border/50 shadow-inner">
              <ListTodo className="size-8 text-muted-foreground/50" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-medium text-foreground">{t("tasks.empty") || "No tasks yet"}</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                {t("tasks.emptySub") || "Tasks are isolated from chat. Hand off specific coding assignments, bug fixes, or reviews to agents directly."}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {tasks.map((task) => (
              <TaskCard key={task.threadId} task={task} adapterOf={adapterOf} onFollowUp={followUp} onOpen={setSelected} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
