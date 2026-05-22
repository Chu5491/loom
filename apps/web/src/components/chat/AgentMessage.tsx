// 에이전트 응답 메시지 — 본문 + 상태 배지 + 비용 + 도구 스트립 + 변경된 파일 패널.
// 부속 컴포넌트(FailedReason, ActiveProgress, ToolStrip, HandoffMenu, SelectionQuoteScope)도
// 같은 파일에 — 모두 AgentMessage 본문에 종속적이라 응집도 우선.

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import {
  Forward,
  MessageSquareReply,
  MoreHorizontal,
  Quote,
  X,
} from "lucide-react";
import type { AdapterManifest, Agent, Run, RunStatus } from "@loom/core";
import { api } from "../../api/client.js";
import { ChangedFiles } from "../ChangedFiles.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";
import { runStatusVariant, elapsedSecs } from "../../lib/runStatus.js";
import { agentColorOf, classesFor } from "../agentColor.js";
import { AgentAvatar } from "./AgentAvatar.js";
import { MarkdownView } from "./MarkdownView.js";
import {
  HoverActions,
  HoverButton,
  MessageRow,
} from "./MessageRow.js";
import { useRunTail } from "./useRunTail.js";
import { formatCost, formatTokens, formatElapsed, type TailEvent } from "./utils.js";

export function AgentMessage({
  run,
  agent,
  manifest,
  isContinuation,
  allAgents,
  allManifests,
  onReply,
  onHandoff,
  onQuoteSelection,
}: {
  run: Run;
  agent: Agent | undefined;
  manifest: AdapterManifest | undefined;
  isContinuation: boolean;
  /** hand-off 메뉴에 띄울 모든 에이전트 목록. */
  allAgents: Agent[];
  allManifests: AdapterManifest[];
  onReply: (run: Run, agent: Agent | undefined) => void;
  onHandoff: (run: Run, fromAgent: Agent | undefined, toAgent: Agent) => void;
  /** 선택 영역 인용을 composer로 올리는 콜백. */
  onQuoteSelection: (
    selection: string,
    run: Run,
    agent: Agent | undefined,
  ) => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const isActive = run.status === "queued" || run.status === "running";
  const { events, resultText } = useRunTail(run.id, isActive);

  const cancel = useMutation({
    mutationFn: () => api.cancelRun(run.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["runs"] }),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : String(err)),
  });

  const restingResult = useQuery({
    queryKey: ["run", run.id, "result"],
    queryFn: () => api.getRunResult(run.id),
    enabled:
      !isActive &&
      run.status === "succeeded" &&
      events.length === 0 &&
      resultText === null,
    staleTime: 60_000,
  });

  const name = agent?.name ?? run.agentId.slice(0, 8);
  const cls = agent ? classesFor(agentColorOf(agent)) : null;
  const finalText = resultText ?? restingResult.data?.resultText ?? null;
  const hasContent = events.length > 0 || finalText !== null;

  // run 상세 페이지는 /projects/:id/runs/:runId 라우트 — 메시지가 워크스페이스
  // 안에서 그려지므로 이 useParams 가 항상 채워짐. agent.projectId 도 fallback.
  const { id: routeProjectId } = useParams<{ id: string }>();
  const projectId = routeProjectId ?? agent?.projectId ?? "";
  const runHref = projectId ? `/projects/${projectId}/runs/${run.id}` : "#";

  return (
    <MessageRow
      avatar={
        agent ? (
          <AgentAvatar agent={agent} manifest={manifest} working={isActive} />
        ) : (
          <span className="size-9 inline-flex items-center justify-center text-xs text-muted-foreground">
            ?
          </span>
        )
      }
      name={name}
      nameClassName={cls?.text}
      timestamp={run.createdAt}
      isContinuation={isContinuation}
      runId={{ id: run.id, kind: "agent" }}
      tag={
        <span className="inline-flex items-center gap-1.5">
          <Badge variant={runStatusVariant(run.status)} className="h-4 px-1.5 text-[9px] gap-1">
            {isActive ? <span className="size-1 rounded-full bg-current animate-pulse" /> : null}
            {t(`status.${run.status}`)}
          </Badge>
          {/* 세션 상태 — 이 run이 이전 대화를 이어왔는지(resumed) 새로
              시작했는지(fresh)를 한 글자로 표시. 디버깅 + 컨텍스트 추적용. */}
          {run.resumedSessionId ? (
            <span
              className="text-[9px] mono text-sky-700 dark:text-sky-400"
              title={t("run.resume.fromSession", {
                id: run.resumedSessionId.slice(0, 8),
              })}
            >
              ↪
            </span>
          ) : (
            <span
              className="text-[9px] mono text-amber-700 dark:text-amber-400"
              title={t("run.resume.fresh")}
            >
              ✦
            </span>
          )}
          {run.costUsd !== null && run.costUsd !== undefined ? (
            <span
              className="text-[10px] text-muted-foreground/70 mono"
              title={buildUsageTooltip(run)}
            >
              {formatCost(run.costUsd)}
            </span>
          ) : null}
          {run.model ? (
            <span className="text-[9px] text-muted-foreground/50 mono">
              {run.model}
            </span>
          ) : null}
        </span>
      }
      actions={
        <HoverActions>
          {!isActive ? (
            <>
              <HoverButton
                onClick={() => onReply(run, agent)}
                icon={<MessageSquareReply />}
                label={t("chat.message.reply")}
              />
              <HandoffMenu
                speaker={agent}
                agents={allAgents}
                manifests={allManifests}
                onPick={(to) => onHandoff(run, agent, to)}
              />
            </>
          ) : (
            <HoverButton
              onClick={() => {
                // 비차단 확인 — toast의 액션 버튼이 native confirm() 대체.
                toast(t("chat.message.cancelConfirm"), {
                  action: {
                    label: t("chat.message.cancel"),
                    onClick: () => cancel.mutate(),
                  },
                });
              }}
              icon={<X />}
              label={t("chat.message.cancel")}
            />
          )}
          <Button asChild variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-foreground">
            <Link to={runHref} aria-label={t("chat.message.openLog")}>
              <MoreHorizontal />
            </Link>
          </Button>
        </HoverActions>
      }
    >
      {!hasContent ? (
        // ActiveProgress가 flex divs를 쓰므로 <p>로 감싸면 nested 경고. div 사용.
        <div className="text-sm italic text-muted-foreground">
          {isActive ? (
            <ActiveProgress
              run={run}
              events={events}
              onCancel={() => cancel.mutate()}
            />
          ) : (
            <FailedReason runId={run.id} status={run.status} />
          )}
        </div>
      ) : (
        <SelectionQuoteScope
          onQuote={(text) => onQuoteSelection(text, run, agent)}
        >
          <div className="space-y-1.5">
            {/* 답변(텍스트) → 도구 호출(작동 과정) → 활성 진행 표시 순서. */}
            {finalText === null
              ? events
                  .filter((e) => e.kind === "text")
                  .map((evt, i) => <MarkdownView key={i} text={evt.text} />)
              : null}
            {finalText ? <MarkdownView text={finalText} /> : null}
            <ToolStrip events={events} />
            {isActive ? (
              <ActiveProgress
              run={run}
              events={events}
              onCancel={() => cancel.mutate()}
            />
            ) : null}
          </div>
        </SelectionQuoteScope>
      )}
      {/* run이 만진 파일 변경 패널. 변경 없으면 자동 숨김. 종료 후에만 fetch. */}
      <ChangedFiles runId={run.id} enabled={!isActive} />
    </MessageRow>
  );
}

function buildUsageTooltip(run: Run): string {
  const lines: string[] = [];
  if (typeof run.costUsd === "number") lines.push(`$${run.costUsd.toFixed(4)}`);
  if (typeof run.inputTokens === "number") lines.push(`in: ${formatTokens(run.inputTokens)}`);
  if (typeof run.outputTokens === "number") lines.push(`out: ${formatTokens(run.outputTokens)}`);
  if (typeof run.cacheReadTokens === "number" && run.cacheReadTokens > 0) lines.push(`cache read: ${formatTokens(run.cacheReadTokens)}`);
  if (typeof run.cacheWriteTokens === "number" && run.cacheWriteTokens > 0) lines.push(`cache write: ${formatTokens(run.cacheWriteTokens)}`);
  if (run.model) lines.push(run.model);
  return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────────────
// 부속 컴포넌트
// ────────────────────────────────────────────────────────────────────────

/** failed/cancelled에서 결과 텍스트가 없을 때 stderr 마지막 부분을 lazy fetch. */
function FailedReason({
  runId,
  status,
}: {
  runId: string;
  status: RunStatus;
}) {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();
  const runHref = projectId ? `/projects/${projectId}/runs/${runId}` : "#";
  const enabled = status === "failed" || status === "cancelled";
  const q = useQuery({
    queryKey: ["run", runId, "error"],
    queryFn: () => api.getRunError(runId),
    enabled,
    staleTime: 5 * 60_000,
  });
  if (!enabled) return <>—</>;
  const stderr = q.data?.stderr ?? "";
  if (!stderr) {
    return (
      <span className="not-italic">
        <Badge variant="destructive" className="h-4 px-1.5 text-[9px]">
          {t(`status.${status}`)}
        </Badge>
        <Link
          to={runHref}
          className="ml-2 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
        >
          {t("chat.message.openLog")}
        </Link>
      </span>
    );
  }
  return (
    <div className="not-italic space-y-1">
      <Badge variant="destructive" className="h-4 px-1.5 text-[9px]">
        {t(`status.${status}`)}
      </Badge>
      <pre className="mt-1 max-h-32 overflow-auto rounded border border-border/60 bg-muted/40 px-2 py-1.5 mono text-[11px] leading-snug whitespace-pre-wrap break-words text-destructive">
        {stderr}
      </pre>
      <Link
        to={runHref}
        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
      >
        {t("chat.message.openLog")}
      </Link>
    </div>
  );
}

/** 활성 run 라이브 진행 표시 — 경과 시간 + 마지막 도구 + 대상 경로. */
function ActiveProgress({
  run,
  events,
  onCancel,
}: {
  run: Run;
  events: TailEvent[];
  /** 활성 run을 멈추는 콜백. 부모(AgentMessage)가 cancel mutation으로 연결.
   *  hover-only 액션 외에 인라인으로 항상 보이는 Stop 버튼이 필요해서 추가. */
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const [elapsed, setElapsed] = useState(() => elapsedSecs(run));
  useEffect(() => {
    // 1Hz로 충분 — 초 단위 표시.
    const id = window.setInterval(() => setElapsed(elapsedSecs(run)), 1000);
    return () => window.clearInterval(id);
  }, [run]);

  const lastTool = [...events].reverse().find((e) => e.kind === "tool");

  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground mono min-w-0">
      <span className="inline-flex size-1.5 rounded-full bg-foreground/40 animate-pulse shrink-0" />
      <span className="shrink-0">{formatElapsed(elapsed)}</span>
      {lastTool ? (
        <>
          <span className="text-muted-foreground/40 shrink-0">·</span>
          <span className="text-foreground/80 font-medium shrink-0">
            {lastTool.text}
          </span>
          {lastTool.detail ? (
            <span
              className="truncate text-muted-foreground"
              title={lastTool.detail}
            >
              {lastTool.detail}
            </span>
          ) : null}
        </>
      ) : null}
      {onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto shrink-0 inline-flex items-center gap-1 rounded border border-border px-1.5 h-5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-destructive hover:border-destructive/50 hover:bg-destructive/5 transition-colors"
          title={t("chat.message.cancel")}
        >
          <span aria-hidden className="size-1.5 rounded-[1px] bg-current" />
          {t("chat.message.cancel")}
        </button>
      ) : null}
    </div>
  );
}

/** 도구 호출 요약 — 종류별 카운트로 컴팩트하게. layout 애니메이션으로 도구가
 *  새로 등장하면 미끄러져 들어옴. */
function ToolStrip({ events }: { events: TailEvent[] }) {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const ev of events) {
    if (ev.kind !== "tool") continue;
    if (!counts.has(ev.text)) order.push(ev.text);
    counts.set(ev.text, (counts.get(ev.text) ?? 0) + 1);
  }
  if (order.length === 0) return null;
  return (
    <motion.div
      layout
      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground mono"
    >
      <span aria-hidden className="opacity-70">🔧</span>
      <AnimatePresence initial={false}>
        {order.map((name) => {
          const n = counts.get(name)!;
          return (
            <motion.span
              key={name}
              layout
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="inline-flex items-baseline gap-0.5"
            >
              <span>{name}</span>
              {n > 1 ? (
                <motion.span
                  key={n}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="text-muted-foreground/60"
                >
                  ·{n}
                </motion.span>
              ) : null}
            </motion.span>
          );
        })}
      </AnimatePresence>
    </motion.div>
  );
}

/** Slack-style hand-off 멤버 메뉴. 다른 에이전트로 직접 위임. */
function HandoffMenu({
  speaker,
  agents,
  manifests,
  onPick,
}: {
  speaker: Agent | undefined;
  agents: Agent[];
  manifests: AdapterManifest[];
  onPick: (to: Agent) => void;
}) {
  const { t } = useI18n();
  // hand-off는 *다른* 에이전트에게만 의미 있음 — 같은 화자 대답은 Reply 버튼이 담당.
  const others = speaker
    ? agents.filter((a) => a.id !== speaker.id)
    : agents;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-foreground"
          title={t("chat.message.handoff")}
          aria-label={t("chat.message.handoff")}
        >
          <Forward />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]">
        <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("chat.message.handoff.title")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {others.length === 0 ? (
          <div className="px-2 py-2 text-xs text-muted-foreground">
            {t("chat.message.handoff.empty")}
          </div>
        ) : (
          others.map((a) => {
            const m = manifests.find((mm) => mm.kind === a.adapterKind);
            const cls = classesFor(agentColorOf(a));
            return (
              <DropdownMenuItem
                key={a.id}
                onSelect={() => onPick(a)}
                className="gap-2"
              >
                <AgentAvatar agent={a} manifest={m} size="sm" />
                <span className={cn("text-sm font-medium", cls.text)}>
                  @{a.name}
                </span>
                {a.role ? (
                  <span className="ml-auto text-[10px] text-muted-foreground/70">
                    {a.role}
                  </span>
                ) : null}
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 본문 텍스트 드래그 시 위에 떠오르는 "선택 영역 인용" 알약. */
function SelectionQuoteScope({
  children,
  onQuote,
}: {
  children: React.ReactNode;
  onQuote: (text: string) => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{
    text: string;
    top: number;
    left: number;
  } | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const handler = () => {
      // 한 틱 지연 — 브라우저가 selection을 mouseup *이후* 갱신하므로 동기 읽기는 stale.
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
          setPill(null);
          return;
        }
        const range = sel.getRangeAt(0);
        // 이 메시지 안에서 시작·끝나는 selection만 인정 (메시지 가로지르는 경우 무시).
        if (
          !root.contains(range.startContainer) ||
          !root.contains(range.endContainer)
        ) {
          setPill(null);
          return;
        }
        const text = sel.toString().trim();
        if (!text) {
          setPill(null);
          return;
        }
        const rect = range.getBoundingClientRect();
        const rootRect = root.getBoundingClientRect();
        setPill({
          text,
          top: rect.top - rootRect.top - 32,
          left: rect.left - rootRect.left + rect.width / 2,
        });
      }, 0);
    };
    document.addEventListener("mouseup", handler);
    document.addEventListener("selectionchange", handler);
    return () => {
      document.removeEventListener("mouseup", handler);
      document.removeEventListener("selectionchange", handler);
    };
  }, []);

  return (
    <div ref={ref} className="relative">
      {children}
      <AnimatePresence>
        {pill ? (
          <motion.button
            key="quote-pill"
            type="button"
            initial={{ opacity: 0, y: 6, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.95 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
            onMouseDown={(e) => {
              // selection이 collapse되기 전에 click 핸들러가 실행되도록 mousedown 차단.
              e.preventDefault();
            }}
            onClick={() => {
              onQuote(pill.text);
              window.getSelection()?.removeAllRanges();
              setPill(null);
            }}
            style={{
              position: "absolute",
              top: pill.top,
              left: pill.left,
              transform: "translateX(-50%)",
            }}
            className="z-20 inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-medium shadow-md hover:bg-muted"
          >
            <Quote className="size-3" />
            {t("chat.message.quoteSelection")}
          </motion.button>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
