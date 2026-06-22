// 에이전트 버블 — runId 의 SSE 를 구독해 이벤트를 렌더. TalkPage 에서 분리.
// 렌더 헬퍼(ActivityCard·WorkingPanel·LoadoutChips·RatingButtons·PromptPeek)는 이 버블 전용이라
// 같은 파일에 둔다. ErrorLine 은 TalkPage 도 쓰므로 export.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Brain, Check, ChevronDown, ChevronRight, Coins, FilePen, FileText, FolderGit2, Info,
  ListTodo, Loader2, MessagesSquare, Plug, RotateCcw, Sparkles, Terminal, ThumbsDown, ThumbsUp, Trash2, Workflow, Wrench,
} from "lucide-react";
import type { AgentSpec, OfficeEvent, RunInfo, WorkflowSpec } from "@loom/core";
import { api } from "../../api/client.js";
import { AgentAvatar } from "../AgentAvatar.js";
import { Markdown } from "../Markdown.js";
import { useI18n } from "../../context/I18nContext.js";
import { useConfirm, useAlert } from "../../context/DialogContext.js";
import { useRunStream } from "../../hooks/useRunStream.js";
import { cn } from "../../lib/utils.js";
import type { WorkReport } from "../../lib/report.js";
import { deriveView, prettyTool, fmtDuration, fmtTok, traceIcon, type TraceItem, type DerivedView } from "../../lib/derive.js";
import { RunDetailModal } from "./Modals.js";
import { Avatar } from "./atoms.js";

interface ActivityData {
  tools: { name: string; count: number }[];
  files: { path: string; action?: string }[];
  loadout?: { skills: string[]; mcp: string[]; delegate: boolean };
  costUsd?: number;
  costEstimated?: boolean;
  durationMs?: number;
  tokens?: { input: number; output: number; cached: number };
}

// ── 에이전트 버블 — runId 의 SSE 를 구독해 이벤트를 렌더 ─────────────────────────
export function AgentBubble({ agent, fromAgent, runId, run, startedAt, workflows, isLast, onDone, onActivity, projectName }: { agent?: AgentSpec; fromAgent?: string; runId: string; run?: RunInfo; startedAt?: string; workflows: WorkflowSpec[]; isLast?: boolean; onDone?: () => void; onActivity?: (runId: string, agent: string, item: TraceItem | null, running: boolean) => void; projectName?: string }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const alert = useAlert();
  const isStartError = runId.startsWith("err:");
  const stream = useRunStream(isStartError ? null : runId);
  const [handedOff, setHandedOff] = useState<string[]>([]);
  const [detail, setDetail] = useState(false);
  const [proseOpen, setProseOpen] = useState(false); // 작업 리포트 있을 때 원문 산문 펼치기

  const name = agent?.label || agent?.name || "?";
  const view = useMemo(() => deriveView(stream.events), [stream.events]);
  const running = !isStartError && stream.status === "running";

  // 활동 데이터(시스템 사실) — trace/loadout/result + run 타이밍에서. 프롬프트 무관.
  const activity = useMemo<ActivityData>(() => {
    const counts = new Map<string, number>();
    const files: { path: string; action?: string }[] = [];
    for (const it of view.trace) {
      if (it.kind === "tool") counts.set(it.name, (counts.get(it.name) ?? 0) + 1);
      else if (it.kind === "file" && !files.some((f) => f.path === it.target)) {
        files.push({ path: it.target ?? "", action: it.action });
      }
    }
    const tools = [...counts.entries()].map(([name, count]) => ({ name, count }));
    const durationMs = run?.startedAt && run?.endedAt
      ? Math.max(0, new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime())
      : undefined;
    // 비용: claude 는 result 에 실값, 나머지(codex/factory/devin/opencode)는 finish 후
    // run.costUsd(실값/추정)에 채워진다 — 둘 다 폴백해 모든 CLI 가 카드에 비용을 보이게.
    return { tools, files, loadout: view.loadout, costUsd: view.result?.costUsd ?? run?.costUsd ?? undefined, costEstimated: run?.costEstimated, durationMs, tokens: view.tokens };
  }, [view.trace, view.loadout, view.result, view.tokens, run?.startedAt, run?.endedAt, run?.costEstimated, run?.costUsd]);

  const hasActivity = activity.tools.length > 0 || activity.files.length > 0
    || (!!activity.loadout && (activity.loadout.skills.length > 0 || activity.loadout.mcp.length > 0));
  const showCard = !running && !isStartError && (!!view.report || hasActivity);

  // run 이 끝나면 부모에 알림 → runs 재조회로 하네스 자동발화 자식을 끌어온다.
  useEffect(() => {
    if (!isStartError && stream.status !== "running") onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.status, isStartError]);

  // 라이브 활동을 팀 패널로 — 지금 어떤 도구로 뭘 하는지. 끝나면 거둔다.
  useEffect(() => {
    if (isStartError || !agent || !onActivity) return;
    const last = [...view.trace].reverse().find((it) => it.kind !== "handoff") ?? null;
    onActivity(runId, agent.name, last, running);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.trace.length, running]);

  // 수동 발화 제안 — auto 트리거로 이미 발화한 워크플로우(handoff 이벤트의 reason)는 제외.
  const autoFired = useMemo(
    () =>
      new Set(
        stream.events
          .filter((e) => e.kind === "handoff" && e.via === "workflow")
          .map((e) => (e as Extract<OfficeEvent, { kind: "handoff" }>).reason ?? ""),
      ),
    [stream.events],
  );
  // 마지막 버블에만 제안 — 과거 모든 버블에 붙으면 시끄럽다.
  const suggestions = isStartError || !isLast
    ? []
    : suggestedWorkflows(workflows, agent?.name ?? "", stream.status, view.changedFiles).filter(
        (w) => !autoFired.has(w.name) && !handedOff.includes(w.name),
      );

  async function fireWorkflow(name: string) {
    setHandedOff((prev) => [...prev, name]);
    try {
      await api.fireRunWorkflow(runId, name);
      onDone?.();
    } catch {
      setHandedOff((prev) => prev.filter((x) => x !== name)); // 실패 시 버튼 복원
    }
  }

  return (
    <div className="group flex gap-3">
      <Avatar agent={agent} />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="font-display text-sm font-semibold">{name}</span>
          {agent ? <span className="text-[11px] text-muted-foreground">{agent.adapter}</span> : null}
          {fromAgent ? <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">↳ @{fromAgent}</span> : null}
          {running ? (
            <>
              <span className="size-1.5 animate-pulse rounded-full bg-primary" />
              <button
                type="button"
                onClick={() => void api.cancelRun(runId).catch(() => {})}
                className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive"
              >
                {t("talk.cancel")}
              </button>
            </>
          ) : (
            // hover 시에만 — 상세 보기 + 이 run(user+agent 버블 한 쌍) 삭제.
            !isStartError && (
              <>
                {run ? (
                  <button
                    type="button"
                    title={t("talk.detail.open")}
                    onClick={() => setDetail(true)}
                    className="text-muted-foreground/50 opacity-0 transition-opacity hover:text-primary group-hover:opacity-100"
                  >
                    <Info className="size-3.5" />
                  </button>
                ) : null}
                {/* 재실행은 완료된 단발 run 에만 — 실행 중(중복 생성)·워크플로우 스텝
                    (체인 컨텍스트 없이 고아 run 이 됨)에는 숨긴다. */}
                {run && run.status !== "running" && !run.workflow ? (
                  <button
                    type="button"
                    title={t("talk.rerun")}
                    aria-label={t("talk.rerun")}
                    onClick={() => void api.rerunRun(runId).then(() => onDone?.()).catch((e: unknown) => void alert(String(e)))}
                    className="text-muted-foreground/50 opacity-0 transition-opacity hover:text-primary group-hover:opacity-100"
                  >
                    <RotateCcw className="size-3.5" />
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label={t("talk.deleteRun")}
                  onClick={async () => { if (await confirm({ body: t("talk.deleteConfirm"), tone: "danger", confirmLabel: t("common.delete") })) void api.deleteRun(runId).then(() => onDone?.()).catch(() => {}); }}
                  className="text-muted-foreground/50 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </>
            )
          )}
          {detail && run ? <RunDetailModal run={run} agent={agent} onClose={() => setDetail(false)} /> : null}
        </div>

        {/* 실행 중 — 강한 라이브 패널(이 프로젝트에서 작업 중) + 로드아웃 + 타임라인. */}
        {running ? (
          <>
            {stream.reconnecting ? (
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                {t("talk.status.reconnecting")}
              </div>
            ) : null}
            <WorkingPanel
              agent={agent}
              startedAt={startedAt}
              projectName={projectName}
              trace={view.trace}
            />
            {view.loadout ? <LoadoutChips loadout={view.loadout} /> : null}
          </>
        ) : null}

        {/* 완료 — 활동 카드 하나로 통합(시스템: 도구·파일·스킬·비용·시간 + 에이전트: 요약). */}
        {showCard ? <ActivityCard report={view.report} activity={activity} /> : null}

        {/* 사고 과정(reasoning) — 길 수 있어 접어 둔다. opencode --thinking·codex reasoning. */}
        {!running && view.reasoning ? (
          <details className="rounded-2xl rounded-bl-md border border-border bg-muted/30 px-3 py-2">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground">
              <Brain className="size-3 text-primary" />{t("talk.report.reasoning")}
            </summary>
            <div className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">{view.reasoning}</div>
          </details>
        ) : null}

        {/* 본문 텍스트 — 리포트가 있으면 원문 산문은 접어 둔다(카드가 주인공). */}
        {isStartError ? (
          <ErrorLine text={runId.slice(4)} />
        ) : view.errors.length > 0 ? (
          view.errors.map((m, i) => <ErrorLine key={i} text={m} />)
        ) : !running && view.body && (!view.report || proseOpen) ? (
          <div className="rounded-2xl rounded-bl-md bg-card border border-border px-4 py-2.5 text-sm leading-relaxed">
            <Markdown>{view.body}</Markdown>
          </div>
        ) : !running && view.body && view.report ? (
          <button
            type="button"
            onClick={() => setProseOpen(true)}
            className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronRight className="size-3" />
            {t("talk.report.showProse")}
          </button>
        ) : running ? null : (
          <p className="text-sm text-muted-foreground">{t("talk.noOutput")}</p>
        )}

        {/* 결과 메타(품질 평가) — 비용·도구·시간은 카드가 보여주므로 카드 있을 땐 생략. */}
        {!isStartError && !running ? (
          <div className="mt-1 flex items-center gap-2">
            {!showCard && view.result?.costUsd != null ? (
              <span className="text-[11px] text-muted-foreground" title={run?.costEstimated ? t("cost.estimated") : undefined}>{run?.costEstimated ? "~" : ""}${view.result.costUsd.toFixed(4)}</span>
            ) : null}
            <RatingButtons runId={runId} initial={run?.rating ?? null} />
            {/* 완료 → 작업 상세로(전체 파싱 결과 + 위임 흐름). 마스터가 받아 위임한 흐름은
                여기서 한 작업으로 본다. */}
            {run?.threadId ? (
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent("loom:cmd", { detail: { view: "tasks", threadId: run.threadId } }))}
                className="ml-auto inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
              >
                <ListTodo className="size-3" />
                {t("talk.viewTask")}
                <ChevronRight className="size-3" />
              </button>
            ) : null}
          </div>
        ) : null}
        {!isStartError && !running ? <PromptPeek runId={runId} /> : null}
        {!isStartError && (stream.status === "failed" || stream.status === "cancelled") ? (
          <p className="mt-1 text-[11px] text-muted-foreground">{t(`talk.status.${stream.status}`)}</p>
        ) : null}

        {/* ask 트리거 수동 발화 제안 — 이 run 의 결과를 입력으로 워크플로우 시작 */}
        {suggestions.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {suggestions.map((w) => (
              <button
                key={w.name}
                type="button"
                onClick={() => void fireWorkflow(w.name)}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-primary/50 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
              >
                <Workflow className="size-3" />
                {t("talk.fireWorkflow", { name: w.name })}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// 품질 평가 — 👍👎 토글(재클릭=해제). 평가는 에이전트 30일 성과 통계의 원천.
function RatingButtons({ runId, initial }: { runId: string; initial: 1 | -1 | null }) {
  const { t } = useI18n();
  const [rating, setRating] = useState<1 | -1 | null>(initial);
  const set = (next: 1 | -1 | null) => {
    const prev = rating;
    setRating(next); // 낙관 적용 — 실패 시 복원
    api.rateRun(runId, next).catch(() => setRating(prev));
  };
  return (
    <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 [&:has([data-on])]:opacity-100">
      <button
        type="button"
        title={t("talk.rate.up")}
        data-on={rating === 1 || undefined}
        onClick={() => set(rating === 1 ? null : 1)}
        className={cn("rounded p-0.5 transition-colors", rating === 1 ? "text-success" : "text-muted-foreground/50 hover:text-success")}
      >
        <ThumbsUp className="size-3.5" />
      </button>
      <button
        type="button"
        title={t("talk.rate.down")}
        data-on={rating === -1 || undefined}
        onClick={() => set(rating === -1 ? null : -1)}
        className={cn("rounded p-0.5 transition-colors", rating === -1 ? "text-destructive" : "text-muted-foreground/50 hover:text-destructive")}
      >
        <ThumbsDown className="size-3.5" />
      </button>
    </span>
  );
}

// 투명성 — 이 run 에서 CLI 에 실제로 들어간 합성 프롬프트를 펼쳐 본다.
// 호버 시에만 버튼 노출(시끄럽지 않게), 열 때 한 번 lazy fetch.
function PromptPeek({ runId }: { runId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["runPrompt", runId],
    queryFn: () => api.getRunPrompt(runId),
    enabled: open,
    staleTime: Infinity, // 프롬프트는 불변 기록
  });
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-1 text-[10px] text-muted-foreground/60 transition-opacity hover:text-foreground",
          open ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <FileText className="size-3" />
        {t("talk.promptPeek")}
      </button>
      {open ? (
        q.isLoading ? (
          <p className="mt-1 text-[11px] text-muted-foreground">…</p>
        ) : q.data ? (
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {q.data.prompt}
          </pre>
        ) : (
          <p className="mt-1 text-[11px] text-muted-foreground">{t("talk.promptPeek.missing")}</p>
        )
      ) : null}
    </div>
  );
}

export function ErrorLine({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap rounded-2xl rounded-bl-md border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm leading-relaxed text-destructive">
      {text}
    </div>
  );
}

// 활동 카드 — 시스템이 파싱한 사실(도구·파일·스킬·비용·시간) + 에이전트 요약(report).
// 산문 대신 "무엇을, 어떤 도구로 했나"를 한눈에. 빈 섹션은 생략.
function ActivityCard({ report, activity }: { report?: WorkReport; activity: ActivityData }) {
  const { t } = useI18n();
  const has = (a?: unknown[]) => Array.isArray(a) && a.length > 0;
  const { tools, files, loadout, costUsd, costEstimated, durationMs, tokens } = activity;
  // report.files(에이전트 주장)보다 시스템이 잡은 file 이벤트를 우선(사실).
  const fileList = files.length ? files : (report?.files ?? []);
  const totalToolCalls = tools.reduce((n, x) => n + x.count, 0);

  const narrative: { key: string; icon: React.ReactNode; items: string[]; tone?: string }[] = [];
  if (has(report?.steps)) narrative.push({ key: "steps", icon: <Check className="size-3" />, items: report!.steps! });
  if (has(report?.decisions)) narrative.push({ key: "decisions", icon: <Sparkles className="size-3" />, items: report!.decisions! });
  if (has(report?.blockers)) narrative.push({ key: "blockers", icon: <Info className="size-3" />, items: report!.blockers!, tone: "warning" });

  // 상단 스탯 칩(시스템 사실). 활동이 없으면 칩도 비고 — 그땐 report 만 있는 케이스.
  const stats: { icon: React.ReactNode; label: string }[] = [];
  if (totalToolCalls > 0) stats.push({ icon: <Wrench className="size-3" />, label: t("talk.act.tools", { n: String(totalToolCalls) }) });
  if (fileList.length > 0) stats.push({ icon: <FilePen className="size-3" />, label: t("talk.act.files", { n: String(fileList.length) }) });
  if (durationMs != null) stats.push({ icon: <Terminal className="size-3" />, label: fmtDuration(durationMs) });
  if (costUsd != null && costUsd > 0) stats.push({ icon: <Sparkles className="size-3" />, label: `${costEstimated ? "~" : ""}$${costUsd.toFixed(4)}` });
  // 토큰(입력↑/출력↓) + 캐시 적중률 — loom 의 안정 시스템프롬프트가 캐시를 높이는 가성비 신호.
  if (tokens && (tokens.input > 0 || tokens.output > 0)) {
    const pct = tokens.input > 0 && tokens.cached > 0 ? Math.round((tokens.cached / tokens.input) * 100) : 0;
    stats.push({
      icon: <Coins className="size-3" />,
      label: `↑${fmtTok(tokens.input)} ↓${fmtTok(tokens.output)}${pct > 0 ? ` · ${t("talk.act.cached")} ${pct}%` : ""}`,
    });
  }

  return (
    <div className="mb-2 overflow-hidden rounded-2xl rounded-bl-md border border-primary/25 bg-card shadow-[var(--shadow-glow-sm)]">
      <div className="h-0.5 w-full bg-gradient-accent opacity-60" />
      <div className="space-y-2.5 px-4 py-3">
        {/* 요약 헤드라인(에이전트) */}
        {report?.summary ? <p className="text-sm font-medium leading-snug">{report.summary}</p> : null}

        {/* 스탯 스트립(시스템 사실) */}
        {stats.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {stats.map((s, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-md bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                <span className="text-primary">{s.icon}</span>{s.label}
              </span>
            ))}
          </div>
        ) : null}

        {/* 한 일 / 결정 / 블로커(에이전트) */}
        {narrative.map((s) => (
          <div key={s.key}>
            <p className={cn("mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider",
              s.tone === "warning" ? "text-warning" : "text-muted-foreground")}>
              <span className={s.tone === "warning" ? "text-warning" : "text-primary"}>{s.icon}</span>
              {t(`talk.report.${s.key}`)}
            </p>
            <ul className="space-y-0.5">
              {s.items.map((it, i) => (
                <li key={i} className="flex gap-1.5 text-[13px] leading-snug text-foreground/90">
                  <span className={cn("mt-1.5 size-1 shrink-0 rounded-full", s.tone === "warning" ? "bg-warning" : "bg-primary/50")} />
                  <span className="min-w-0">{it}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {/* 사용한 도구(시스템) */}
        {tools.length > 0 ? (
          <div>
            <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Wrench className="size-3 text-primary" />{t("talk.report.tools")}
            </p>
            <div className="flex flex-wrap gap-1">
              {tools.map((tl, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {prettyTool(tl.name)}{tl.count > 1 ? <span className="text-primary">×{tl.count}</span> : null}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {/* 바뀐 파일(시스템) */}
        {fileList.length > 0 ? (
          <div>
            <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <FilePen className="size-3 text-primary" />{t("talk.report.files")}
            </p>
            <div className="flex flex-wrap gap-1">
              {fileList.map((f, i) => (
                <span key={i} title={f.path} className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px]",
                  f.action === "edit" ? "border-warning/40 bg-warning/10 text-warning" : "border-success/40 bg-success/10 text-success")}>
                  {f.path.split("/").pop()}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {/* 끌고 온 스킬·MCP(시스템) */}
        {loadout && (loadout.skills.length > 0 || loadout.mcp.length > 0) ? (
          <div className="flex flex-wrap gap-1">
            {loadout.skills.map((s) => (
              <span key={`sk-${s}`} className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                <Sparkles className="size-2.5" />{s}
              </span>
            ))}
            {loadout.mcp.map((m) => (
              <span key={`mcp-${m}`} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                <Plug className="size-2.5" />{m}
              </span>
            ))}
          </div>
        ) : null}

        {/* 질문(에이전트) */}
        {report?.question ? (
          <div className="rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-2">
            <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
              <MessagesSquare className="size-3" />{t("talk.report.question")}
            </p>
            <p className="text-[13px] leading-snug">{report.question}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// run 에 실린 스킬·MCP·위임 — 평문 CLI 도 "무엇을 쓸 수 있었나"를 보여주는 칩 줄.
function LoadoutChips({ loadout }: { loadout: NonNullable<DerivedView["loadout"]> }) {
  const { t } = useI18n();
  const { skills, mcp, delegate } = loadout;
  if (!skills.length && !mcp.length && !delegate) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5">
      {skills.map((s) => (
        <span
          key={`sk-${s}`}
          title={t("talk.loadout.skill")}
          className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
        >
          <Sparkles className="size-2.5" />
          {s}
        </span>
      ))}
      {mcp.map((m) => (
        <span
          key={`mcp-${m}`}
          title={t("talk.loadout.mcp")}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
        >
          <Plug className="size-2.5" />
          {m}
        </span>
      ))}
      {delegate ? (
        <span
          title={t("talk.loadout.delegate")}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
        >
          <Workflow className="size-2.5" />
          {t("talk.loadout.delegate")}
        </span>
      ) : null}
    </div>
  );
}

// 작업 중 패널 — "에이전트가 지금 무슨 일을 하는지"를 라이브로. 펄스 아바타 +
// 경과시간 + 실시간 행동 타임라인(도구·파일·위임). 결과 텍스트는 스트리밍 안 함(완료 시).
function WorkingPanel({ agent, startedAt, projectName, trace }: {
  agent?: AgentSpec; startedAt?: string; projectName?: string; trace: TraceItem[];
}) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const sec = startedAt ? Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000)) : null;
  const elapsed = sec === null ? null : sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;

  return (
    <div className="mb-2 overflow-hidden rounded-2xl rounded-bl-md border border-primary/40 bg-primary/5 shadow-[var(--shadow-glow-sm)]">
      <div className="flex items-center gap-2.5 px-3.5 pt-3">
        {/* 펄스 아바타 — 살아 일하는 신호 */}
        <span className="relative flex shrink-0">
          {agent ? <AgentAvatar adapter={agent.adapter} size={30} className="rounded-lg" /> : <Avatar size={30} />}
          <span className="absolute inset-0 animate-ping rounded-lg bg-primary/30" />
          <span className="absolute -bottom-0.5 -right-0.5 size-2.5 animate-pulse rounded-full bg-primary ring-2 ring-card" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{agent?.label || agent?.name}</span>
            <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">{t("talk.workingOn")}</span>
          </span>
          {/* 프로젝트 컨텍스트 — "이 프로젝트에서" 를 명시 */}
          {projectName ? (
            <span className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
              <FolderGit2 className="size-3 shrink-0 text-primary/70" />
              {t("talk.workingIn", { project: projectName })}
            </span>
          ) : null}
        </span>
        {elapsed ? <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{elapsed}</span> : null}
      </div>

      {/* 라이브 작업 — 지금 무슨 도구·파일·위임을 하는지(행동만, 결과 텍스트는 안 흘림) */}
      {trace.length > 0 ? (
        <div className="space-y-0.5 px-3.5 pt-2">
          {trace.slice(-6).map((it, i, arr) => {
            const Icon = traceIcon(it);
            const isLast = i === arr.length - 1;
            const isHandoff = it.kind === "handoff";
            return (
              <div key={`${it.kind}-${it.name}-${i}`} className={cn("flex items-center gap-1.5 text-[12px]", isLast ? "text-foreground" : "text-muted-foreground/60")}>
                <Icon className={cn("size-3.5 shrink-0", isHandoff || isLast ? "text-primary" : "text-muted-foreground/50")} />
                <span className={cn("shrink-0", isHandoff && "font-medium")}>{isHandoff ? `→ ${it.name}` : it.name}</span>
                {it.target ? <span className="truncate font-mono text-[11px] opacity-75">{isHandoff ? it.target : it.target.split("/").pop()}</span> : null}
                {isLast ? <Loader2 className="ml-auto size-3 shrink-0 animate-spin text-primary" /> : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 px-3.5 pt-2 text-[12px]">
          <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
          <span className="text-muted-foreground">{t("talk.thinking")}</span>
        </div>
      )}

      {/* 미정형 진행 셔머 — 끝을 알 수 없지만 "돌고 있다"는 강한 신호 */}
      <div className="loom-shimmer-track mx-3.5 mb-3 mt-2 h-1 rounded-full bg-primary/10" />
    </div>
  );
}

// 완료된 run 에서 제안할 워크플로우 — ask 모드 + 트리거가 결과와 맞을 때.
// auto+매치는 엔진이 이미 발화했으니 여기 안 옴(autoFired 로도 이중 방어).
function suggestedWorkflows(workflows: WorkflowSpec[], agent: string, status: string, changedFiles: number): WorkflowSpec[] {
  if (status !== "succeeded" && status !== "failed") return [];
  return workflows.filter((w) => {
    const tr = w.trigger;
    if (!tr || tr.mode !== "ask" || tr.agent !== agent) return false;
    if (tr.on === "success") return status === "succeeded";
    if (tr.on === "fail") return status === "failed";
    return status === "succeeded" && changedFiles > 0; // changes
  });
}
