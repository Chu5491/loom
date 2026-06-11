// Talk 화면 — office 에이전트와 대화. 한 턴 = 한 run.
// 입력 → POST /api/runs → useRunStream 으로 SSE 이벤트를 버블에 흘린다.
// @ 멘션 하나로 에이전트(라우팅)·스킬(이 run 에 첨부)·프로젝트 파일(경로 삽입)을 찾는다.
// 자동주입 없음 — 스킬 첨부는 사용자의 명시적 선택, 파일은 텍스트로 경로만 들어간다.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp, Bot, ChevronDown, ChevronRight, FilePen, FilePlus2, FileSearch, FileText, Globe,
  MessageSquarePlus, Pencil, Plug, Sparkles, Terminal, Trash2, Workflow, Wrench, X, Zap,
} from "lucide-react";
import type { AgentSpec, HarnessEdge, OfficeEvent, RunInfo, SkillSpec } from "@loom/core";
import { api } from "../api/client.js";
import { AgentAvatar } from "../components/AgentAvatar.js";
import { Markdown } from "../components/Markdown.js";
import { useI18n } from "../context/I18nContext.js";
import { useRunStream } from "../hooks/useRunStream.js";
import { cn } from "../lib/utils.js";

interface UserMsg { id: string; role: "user"; agent: string; text: string }
interface AgentMsg { id: string; role: "agent"; agent: string; runId: string; fromAgent?: string; startedAt?: string }
type Msg = UserMsg | AgentMsg;

/** 대상 칩의 "자동" 모드 — 서버 디스패치가 적합 에이전트를 고른다. */
const AUTO = "__auto";

export function TalkPage({ projectId }: { projectId: string | null }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const office = useQuery({ queryKey: ["office"], queryFn: api.getOffice });
  const threads = useQuery({ queryKey: ["threads", projectId], queryFn: () => api.listThreads(projectId) });
  const [threadId, setThreadId] = useState<string | null>(null);
  // threadId 가 현재 프로젝트의 스레드가 아니면(프로젝트 전환/삭제) 최신 스레드로.
  // null(새 대화 대기)은 사용자가 명시한 상태라 유지한다.
  useEffect(() => {
    const list = threads.data?.threads ?? [];
    if (threadId && !list.some((th) => th.id === threadId)) setThreadId(list[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads.data]);
  // 첫 로드: 스레드가 있으면 최신 것을 연다.
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    if (booted || !threads.data) return;
    setThreadId(threads.data.threads[0]?.id ?? null);
    setBooted(true);
  }, [threads.data, booted]);

  const runs = useQuery({
    queryKey: ["runs", threadId],
    queryFn: () => api.listRuns(threadId!),
    enabled: !!threadId,
  });
  const agents = office.data?.office.agents ?? [];

  const [active, setActive] = useState<string>("");
  const [pending, setPending] = useState<{ agent: string; text: string } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 첫 에이전트를 기본 대상으로.
  useEffect(() => {
    if (!active && agents.length) setActive(agents[0]!.name);
  }, [agents, active]);

  // 스레드 = runs.data 단일 진실에서 파생(이중 경로 제거 — 중복 버블 방지).
  // 부모 run = user+agent 버블, 하네스 자식(parentRunId) = 핸드오프 agent 버블만.
  // runs 쿼리는 projectId 로 키잉돼 있어 프로젝트 전환도 자동 반영.
  const byId = useMemo(() => new Map((runs.data?.runs ?? []).map((r) => [r.id, r])), [runs.data]);
  const messages = useMemo<Msg[]>(
    () =>
      [...(runs.data?.runs ?? [])]
        .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1))
        .flatMap((r): Msg[] =>
          r.parentRunId
            ? [{ id: `a-${r.id}`, role: "agent", agent: r.agent, runId: r.id, fromAgent: byId.get(r.parentRunId)?.agent, startedAt: r.startedAt }]
            : [
                { id: `u-${r.id}`, role: "user", agent: r.agent, text: r.prompt },
                { id: `a-${r.id}`, role: "agent", agent: r.agent, runId: r.id, startedAt: r.startedAt },
              ],
        ),
    [runs.data, byId],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  async function send(rawText: string, skills: string[]) {
    const text = rawText.trim();
    if (!text) return;
    // 선행 @mention 이 있으면 대상 에이전트 결정 + 토큰 제거(에이전트엔 안 보냄).
    let agent = active;
    let prompt = text;
    const m = text.match(/^@([a-zA-Z0-9_-]+)\s*/);
    if (m && agents.some((a) => a.name === m[1])) {
      agent = m[1]!;
      prompt = text.slice(m[0].length).trim();
      setActive(agent);
    }
    if (!agent || !prompt) return;

    // 낙관적 user 버블 하나만(pending). run 이 runs.data 에 들어오면 실제 버블이 대체.
    setSendError(null);
    setPending({ agent, text: prompt });
    try {
      // 스레드가 없으면(새 대화) 첫 메시지로 자동 생성 — 이름은 프롬프트 머리.
      let tid = threadId;
      if (!tid) {
        const { thread } = await api.createThread(prompt.slice(0, 40), projectId);
        tid = thread.id;
        setThreadId(tid);
        await threads.refetch();
      }
      const opts = { prompt, projectId, threadId: tid, ...(skills.length ? { skills } : {}) };
      if (agent === AUTO) await api.dispatchRun(opts); // 서버가 적합 에이전트 선택(라우팅만)
      else await api.startRun({ ...opts, agent });
      await qc.invalidateQueries({ queryKey: ["runs", tid] });
      setPending(null);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e));
      // pending 유지 → 사용자 메시지 + 에러를 같이 보여줌
    }
  }

  if (!office.data || !threads.data || (threadId && !runs.data)) {
    return <Centered>{t("common.checking")}</Centered>;
  }
  if (agents.length === 0) {
    return <Centered>{t("talk.noAgents")}</Centered>;
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-3.5rem)] max-w-6xl gap-6 px-4 sm:px-6">
      {/* 채팅 컬럼 */}
      <div className="mx-auto flex h-full w-full max-w-3xl min-w-0 flex-1 flex-col">
        {/* 스레드 바 — 대화 전환·이름변경·새 대화·삭제. 같은 스레드 안에서 세션이 이어진다. */}
        <div className="flex items-center gap-2 border-b border-border/60 py-2">
          {renaming && threadId ? (
            <input
              className="h-8 min-w-0 flex-1 rounded-md border border-primary/50 bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring sm:max-w-72"
              defaultValue={threads.data.threads.find((th) => th.id === threadId)?.name ?? ""}
              autoFocus
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Escape") setRenaming(false);
                if (e.key === "Enter") {
                  const v = (e.target as HTMLInputElement).value.trim();
                  if (v) void api.renameThread(threadId, v).then(() => threads.refetch());
                  setRenaming(false);
                }
              }}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v) void api.renameThread(threadId, v).then(() => threads.refetch());
                setRenaming(false);
              }}
            />
          ) : (
            <select
              className="h-8 min-w-0 flex-1 truncate rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring sm:max-w-72"
              value={threadId ?? ""}
              onChange={(e) => setThreadId(e.target.value || null)}
            >
              <option value="">{t("talk.thread.new")}</option>
              {threads.data.threads.map((th) => (
                <option key={th.id} value={th.id}>{th.name}</option>
              ))}
            </select>
          )}
          {threadId ? (
            <button
              type="button"
              title={t("talk.thread.rename")}
              onClick={() => setRenaming(true)}
              className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              <Pencil className="size-4" />
            </button>
          ) : null}
          <button
            type="button"
            title={t("talk.thread.new")}
            onClick={() => setThreadId(null)}
            className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
          >
            <MessageSquarePlus className="size-4" />
          </button>
          {threadId ? (
            <button
              type="button"
              title={t("talk.thread.delete")}
              onClick={() => {
                if (!confirm(t("talk.thread.deleteConfirm"))) return;
                void api.deleteThread(threadId).then(() => { setThreadId(null); void threads.refetch(); });
              }}
              className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </button>
          ) : null}
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto py-6">
          {messages.length === 0 && !pending ? (
            <Welcome activeAgent={agents.find((a) => a.name === active)} />
          ) : (
            <div className="space-y-5">
              {messages.map((msg, i) =>
                msg.role === "user" ? (
                  <UserBubble key={msg.id} text={msg.text} />
                ) : (
                  <AgentBubble
                    key={msg.id}
                    agent={agents.find((a) => a.name === msg.agent)}
                    fromAgent={msg.fromAgent}
                    runId={msg.runId}
                    startedAt={msg.startedAt}
                    edges={office.data.office.edges}
                    isLast={i === messages.length - 1}
                    onDone={() => void runs.refetch()}
                  />
                ),
              )}
              {pending ? <UserBubble key="pending" text={pending.text} /> : null}
              {sendError ? <ErrorLine text={sendError} /> : null}
            </div>
          )}
        </div>

        <Composer
          agents={agents}
          skills={office.data.office.skills}
          projectId={projectId}
          active={active}
          onActive={setActive}
          onSend={send}
        />
      </div>

      {/* 팀 패널 — 누가 일하고 있고, 누굴 부를 수 있는지 (xl+) */}
      <TeamPanel
        agents={agents}
        edges={office.data.office.edges}
        runs={runs.data?.runs ?? []}
        active={active}
        onActive={setActive}
      />
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex h-[calc(100vh-3.5rem)] max-w-3xl items-center justify-center px-6">
      <p className="text-center text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

// 에이전트 아바타 = 그 CLI 의 브랜드 아이콘(Office 와 동일). 미상이면 글자 폴백.
function Avatar({ agent, size = 32 }: { agent?: AgentSpec; size?: number }) {
  if (agent) return <AgentAvatar adapter={agent.adapter} size={size} className="rounded-lg" />;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-lg border border-border bg-muted/60 font-mono text-xs text-muted-foreground"
      style={{ width: size, height: size }}
    >
      ?
    </span>
  );
}

function Welcome({ activeAgent }: { activeAgent?: AgentSpec }) {
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-accent text-white shadow-[var(--shadow-glow)]">
        <Bot className="size-6" />
      </span>
      <h2 className="font-display text-xl font-semibold">{t("talk.welcomeTitle")}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        {activeAgent ? t("talk.welcomeWith", { name: activeAgent.label || activeAgent.name }) : t("talk.welcomeSub")}
      </p>
    </div>
  );
}

// ── 팀 패널 — 가능/작업중 에이전트 + 핸드오프 규칙 한눈에 (xl 이상) ──────────────
function TeamPanel({
  agents,
  edges,
  runs,
  active,
  onActive,
}: {
  agents: AgentSpec[];
  edges: HarnessEdge[];
  runs: RunInfo[];
  active: string;
  onActive: (name: string) => void;
}) {
  const { t } = useI18n();
  const workingAgents = useMemo(
    () => new Set(runs.filter((r) => r.status === "running").map((r) => r.agent)),
    [runs],
  );
  const totalCost = useMemo(() => runs.reduce((sum, r) => sum + (r.costUsd ?? 0), 0), [runs]);

  return (
    <aside className="hidden w-60 shrink-0 overflow-y-auto py-6 xl:block">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("talk.team")}</h3>
      <div className="space-y-1">
        {agents.map((a) => {
          const working = workingAgents.has(a.name);
          const on = a.name === active;
          return (
            <button
              key={a.name}
              type="button"
              onClick={() => onActive(a.name)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors",
                on ? "border-primary/40 bg-primary/10" : "border-transparent hover:border-border hover:bg-muted/50",
              )}
            >
              <Avatar agent={a} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{a.label || a.name}</span>
                <span className="block truncate font-mono text-[10px] text-muted-foreground">{a.model || a.adapter}</span>
              </span>
              {working ? (
                <span className="flex items-center gap-1 text-[10px] font-medium text-primary">
                  <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                  {t("talk.team.working")}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {edges.length > 0 ? (
        <>
          <h3 className="mb-2 mt-5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Workflow className="size-3.5" />
            {t("talk.team.harness")}
          </h3>
          <div className="space-y-1">
            {edges.map((e, i) => (
              <div key={i} className="rounded-lg border border-border/60 px-2.5 py-1.5 text-xs">
                <span className="font-medium">@{e.from}</span>
                <span className="mx-1 text-muted-foreground">→</span>
                <span className="font-medium">@{e.to}</span>
                <span className="ml-1.5 rounded bg-muted/70 px-1 py-0.5 text-[10px] text-muted-foreground">
                  {e.trigger.replace("on_", "")}{e.mode === "auto" ? " · auto" : " · ask"}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {/* 스레드 총 비용 — CLI 가 보고한 run 만 합산 */}
      {totalCost > 0 ? (
        <div className="mt-5 flex items-center justify-between rounded-lg border border-border/60 px-2.5 py-1.5 text-xs">
          <span className="text-muted-foreground">{t("talk.team.cost")}</span>
          <span className="font-mono font-medium">${totalCost.toFixed(4)}</span>
        </div>
      ) : null}
    </aside>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary/15 px-4 py-2.5 text-sm leading-relaxed">
        {text}
      </div>
    </div>
  );
}

// ── 에이전트 버블 — runId 의 SSE 를 구독해 이벤트를 렌더 ─────────────────────────
function AgentBubble({ agent, fromAgent, runId, startedAt, edges, isLast, onDone }: { agent?: AgentSpec; fromAgent?: string; runId: string; startedAt?: string; edges: HarnessEdge[]; isLast?: boolean; onDone?: () => void }) {
  const { t } = useI18n();
  const isStartError = runId.startsWith("err:");
  const stream = useRunStream(isStartError ? null : runId);
  const [handedOff, setHandedOff] = useState<string[]>([]);

  const name = agent?.label || agent?.name || "?";
  const view = useMemo(() => deriveView(stream.events), [stream.events]);
  const running = !isStartError && stream.status === "running";

  // run 이 끝나면 부모에 알림 → runs 재조회로 하네스 자동발화 자식을 끌어온다.
  useEffect(() => {
    if (!isStartError && stream.status !== "running") onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.status, isStartError]);

  // 수동 발화 제안 — 자동발화로 이미 자식이 생긴 핸드오프(view.trace 의 →)는 제외.
  const autoFired = useMemo(
    () => new Set(stream.events.filter((e) => e.kind === "handoff").map((e) => (e as Extract<OfficeEvent, { kind: "handoff" }>).toAgent)),
    [stream.events],
  );
  // 마지막 버블에만 제안 — 과거 모든 버블에 붙으면 시끄럽다.
  const suggestions = isStartError || !isLast
    ? []
    : suggestedEdges(edges, agent?.name ?? "", stream.status, view.changedFiles).filter(
        (e) => !autoFired.has(e.to) && !handedOff.includes(e.to),
      );

  async function fireHandoff(to: string) {
    setHandedOff((prev) => [...prev, to]);
    try {
      await api.handoffRun(runId, to);
      onDone?.();
    } catch {
      setHandedOff((prev) => prev.filter((x) => x !== to)); // 실패 시 버튼 복원
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
            // hover 시에만 — 이 run(user+agent 버블 한 쌍)을 기록에서 삭제.
            !isStartError && (
              <button
                type="button"
                aria-label={t("talk.deleteRun")}
                onClick={() => confirm(t("talk.deleteConfirm")) && void api.deleteRun(runId).then(() => onDone?.()).catch(() => {})}
                className="text-muted-foreground/50 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            )
          )}
        </div>

        {/* 실행 중 — 현재 작업 + 경과 시간 */}
        {running ? <WorkingLine trace={view.trace} startedAt={startedAt} /> : null}

        {/* 작업 타임라인 — 도구·파일·핸드오프를 순서대로 */}
        <TraceTimeline items={view.trace} running={running} />

        {/* 본문 텍스트 */}
        {isStartError ? (
          <ErrorLine text={runId.slice(4)} />
        ) : view.errors.length > 0 ? (
          view.errors.map((m, i) => <ErrorLine key={i} text={m} />)
        ) : view.body ? (
          <div className="rounded-2xl rounded-bl-md bg-card border border-border px-4 py-2.5 text-sm leading-relaxed">
            <Markdown>{view.body}</Markdown>
            {running ? <span className="mt-1 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-primary/70" /> : null}
          </div>
        ) : running ? (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("talk.noOutput")}</p>
        )}

        {/* 결과 메타(비용·취소·실패) */}
        {view.result?.costUsd != null ? (
          <p className="mt-1 text-[11px] text-muted-foreground">${view.result.costUsd.toFixed(4)}</p>
        ) : null}
        {!isStartError && (stream.status === "failed" || stream.status === "cancelled") ? (
          <p className="mt-1 text-[11px] text-muted-foreground">{t(`talk.status.${stream.status}`)}</p>
        ) : null}

        {/* ask/manual 엣지 수동 발화 제안 */}
        {suggestions.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {suggestions.map((e) => (
              <button
                key={e.to}
                type="button"
                onClick={() => void fireHandoff(e.to)}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-primary/50 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
              >
                <Workflow className="size-3" />
                {t("talk.handoffTo", { name: e.to })}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap rounded-2xl rounded-bl-md border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm leading-relaxed text-destructive">
      {text}
    </div>
  );
}

interface TraceItem {
  kind: "tool" | "file" | "handoff";
  name: string; // 도구명 / 파일 action / 대상 에이전트
  target?: string;
  action?: "edit" | "write";
}
interface DerivedView {
  trace: TraceItem[];
  body: string;
  result?: Extract<OfficeEvent, { kind: "result" }>;
  errors: string[];
  changedFiles: number;
}
function deriveView(events: OfficeEvent[]): DerivedView {
  const trace: TraceItem[] = [];
  const texts: string[] = [];
  const errors: string[] = [];
  let result: Extract<OfficeEvent, { kind: "result" }> | undefined;
  let changedFiles = 0;
  for (const e of events) {
    if (e.kind === "text") texts.push(e.text);
    else if (e.kind === "tool") trace.push({ kind: "tool", name: e.name, target: e.target });
    else if (e.kind === "file") {
      trace.push({ kind: "file", name: e.action === "edit" ? "Edit" : "Write", target: e.path, action: e.action });
      changedFiles++;
    } else if (e.kind === "handoff") trace.push({ kind: "handoff", name: `@${e.toAgent}` });
    else if (e.kind === "result") result = e;
    else if (e.kind === "error") errors.push(e.message);
  }
  // result 가 오면 그게 최종 전체 텍스트 — 누적 text 보다 우선.
  const body = result?.text ?? texts.join("");
  return { trace, body, result, errors, changedFiles };
}

// 도구 이름 → 아이콘. CLI마다 이름이 달라 휴리스틱 매칭(모르면 렌치).
function traceIcon(it: TraceItem) {
  if (it.kind === "handoff") return Workflow;
  if (it.kind === "file") return it.action === "edit" ? FilePen : FilePlus2;
  const n = it.name.toLowerCase();
  if (n.startsWith("mcp__")) return Plug;
  if (/(^|_)(read|glob|grep|search|ls|cat)/.test(n)) return FileSearch;
  if (/(edit|write|notebook|apply)/.test(n)) return Pencil;
  if (/(bash|shell|terminal|exec|command)/.test(n)) return Terminal;
  if (/(web|fetch|http|browser)/.test(n)) return Globe;
  if (/(task|agent|subagent)/.test(n)) return Bot;
  return Wrench;
}

// ── 작업 타임라인 — 에이전트가 지금 뭘 하는지 눈으로 따라간다 ───────────────────
// running: 라이브 스트림(최근 8개 + 마지막 항목 펄스). done: "도구 N · 파일 M" 요약으로
// 접히고 클릭하면 전체 기록 펼침.
function TraceTimeline({ items, running }: { items: TraceItem[]; running: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;

  const tools = items.filter((i) => i.kind === "tool").length;
  const files = items.filter((i) => i.kind === "file").length;

  if (!running && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-2 inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        <ChevronRight className="size-3" />
        <Wrench className="size-3" />
        {t("talk.trace.summary", { tools: String(tools), files: String(files) })}
      </button>
    );
  }

  const visible = running ? items.slice(-8) : items;
  const hidden = items.length - visible.length;

  return (
    <div className="mb-2">
      {!running ? (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="mb-1 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown className="size-3" />
          {t("talk.trace.summary", { tools: String(tools), files: String(files) })}
        </button>
      ) : null}
      <div className="space-y-1 border-l-2 border-primary/25 pl-3">
        {hidden > 0 ? <p className="text-[10px] text-muted-foreground/60">… +{hidden}</p> : null}
        {visible.map((it, i) => {
          const Icon = traceIcon(it);
          const isLive = running && i === visible.length - 1;
          return (
            <div
              key={`${items.length - visible.length + i}`}
              className={cn(
                "flex items-center gap-1.5 text-[11px]",
                isLive ? "text-foreground" : "text-muted-foreground",
                it.kind === "file" && "text-warning",
              )}
            >
              <Icon className={cn("size-3 shrink-0", isLive && "text-primary")} />
              <span className="shrink-0 font-medium">{it.name}</span>
              {it.target ? <span className="truncate font-mono text-[10px] opacity-80">{it.target}</span> : null}
              {isLive ? <span className="size-1 shrink-0 animate-pulse rounded-full bg-primary" /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 실행 중 상태선 — 지금 뭘 하는지 + 경과 시간. "같이 일하는" 감각의 핵심.
function WorkingLine({ trace, startedAt }: { trace: TraceItem[]; startedAt?: string }) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const sec = startedAt ? Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000)) : null;
  const last = [...trace].reverse().find((it) => it.kind !== "handoff");
  const Icon = last ? traceIcon(last) : Wrench;

  return (
    <div className="mb-1.5 inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-[11px]">
      <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
      <span className="shrink-0 font-medium text-primary">{t("talk.workingOn")}</span>
      {last ? (
        <>
          <Icon className="size-3 shrink-0 text-muted-foreground" />
          <span className="shrink-0">{last.name}</span>
          {last.target ? <span className="truncate font-mono text-[10px] text-muted-foreground">{last.target}</span> : null}
        </>
      ) : (
        <span className="text-muted-foreground">{t("talk.thinking")}</span>
      )}
      {sec !== null ? <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{sec}s</span> : null}
    </div>
  );
}

// 완료된 run 에서 수동 발화를 제안할 엣지 — manual 트리거는 항상,
// ask 모드는 트리거가 결과와 맞을 때만. auto+매치는 엔진이 이미 발화했으니 제외.
function suggestedEdges(edges: HarnessEdge[], agent: string, status: string, changedFiles: number): HarnessEdge[] {
  if (status !== "succeeded" && status !== "failed") return [];
  return edges.filter((e) => {
    if (e.from !== agent) return false;
    if (e.trigger === "manual") return true;
    if (e.mode !== "ask") return false;
    if (e.trigger === "on_success") return status === "succeeded";
    if (e.trigger === "on_fail") return status === "failed";
    return status === "succeeded" && changedFiles > 0; // on_changes
  });
}

// ── Composer — @ 하나로 에이전트(라우팅)·스킬(첨부)·파일(경로 삽입) 검색 ─────────
type MenuItem =
  | { kind: "agent"; agent: AgentSpec }
  | { kind: "skill"; skill: SkillSpec }
  | { kind: "file"; path: string };

function Composer({
  agents,
  skills,
  projectId,
  active,
  onActive,
  onSend,
}: {
  agents: AgentSpec[];
  skills: SkillSpec[];
  projectId: string | null;
  active: string;
  onActive: (name: string) => void;
  onSend: (text: string, skills: string[]) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [attached, setAttached] = useState<string[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 커서 앞 텍스트의 끝이 "@partial" 이면 멘션 메뉴를 띄운다. 파일은 / . 도 허용.
  const token = useMemo(() => {
    const m = text.match(/(?:^|\s)@([a-zA-Z0-9_\-./]*)$/);
    return m ? m[1]! : null;
  }, [text]);
  const q = (token ?? "").toLowerCase();

  // 파일 검색 — 프로젝트가 선택돼 있고 멘션 중일 때만 서버 질의.
  const files = useQuery({
    queryKey: ["files", projectId, q],
    queryFn: () => api.searchProjectFiles(projectId!, q),
    enabled: !!projectId && token !== null,
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });

  const menu = useMemo<MenuItem[]>(() => {
    if (token === null) return [];
    const agentHits = agents
      .filter((a) => a.name.toLowerCase().startsWith(q))
      .map((a): MenuItem => ({ kind: "agent", agent: a }));
    const skillHits = skills
      .filter((s) => !attached.includes(s.name) && s.name.toLowerCase().includes(q))
      .slice(0, 5)
      .map((s): MenuItem => ({ kind: "skill", skill: s }));
    const fileHits = (files.data?.files ?? [])
      .slice(0, 8)
      .map((p): MenuItem => ({ kind: "file", path: p }));
    return [...agentHits, ...skillHits, ...fileHits];
  }, [token, q, agents, skills, attached, files.data]);

  // 멘션 토큰을 replacement 로 치환(없애려면 ""). 끝에서만 동작 — token 검출과 동일 위치.
  function consumeToken(replacement: string) {
    setText((prev) => prev.replace(/@[a-zA-Z0-9_\-./]*$/, replacement));
    taRef.current?.focus();
  }

  function pick(item: MenuItem) {
    if (item.kind === "agent") {
      onActive(item.agent.name);
      consumeToken("");
    } else if (item.kind === "skill") {
      setAttached((prev) => [...prev, item.skill.name]);
      consumeToken("");
    } else {
      consumeToken(`${item.path} `);
    }
  }

  function submit() {
    if (!text.trim()) return;
    onSend(text, attached);
    setText("");
    setAttached([]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // IME(한글/일본어/중국어) 조합 중 Enter 는 글자 확정용 — 전송하면 안 됨.
    // 안 막으면 조합 완료 Enter + 실제 Enter 가 둘 다 발화해 마지막 글자가 또 전송됨.
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape" && token !== null) {
      e.preventDefault();
      consumeToken("");
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (menu.length > 0) {
        pick(menu[0]!);
        return;
      }
      submit();
    }
  }

  // 메뉴를 종류별 섹션으로.
  const sections: { key: string; label: string; items: MenuItem[] }[] = [
    { key: "agents", label: t("talk.menu.agents"), items: menu.filter((m) => m.kind === "agent") },
    { key: "skills", label: t("talk.menu.skills"), items: menu.filter((m) => m.kind === "skill") },
    { key: "files", label: t("talk.menu.files"), items: menu.filter((m) => m.kind === "file") },
  ].filter((s) => s.items.length > 0);

  return (
    <div className="relative pb-5">
      {/* 멘션 메뉴 — 에이전트/스킬/파일 섹션 */}
      {sections.length > 0 ? (
        <div className="absolute bottom-full left-0 z-10 mb-2 max-h-72 w-80 overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
          {sections.map((sec) => (
            <div key={sec.key}>
              <div className="px-3 pb-0.5 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{sec.label}</div>
              {sec.items.map((item, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => pick(item)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted/60"
                >
                  {item.kind === "agent" ? (
                    <>
                      <Avatar agent={item.agent} size={22} />
                      <span className="font-medium">{item.agent.label || item.agent.name}</span>
                      <span className="ml-auto text-[11px] text-muted-foreground">{item.agent.adapter}</span>
                    </>
                  ) : item.kind === "skill" ? (
                    <>
                      <Sparkles className="size-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{item.skill.name}</span>
                        {item.skill.description ? <span className="block truncate text-[11px] text-muted-foreground">{item.skill.description}</span> : null}
                      </span>
                    </>
                  ) : (
                    <>
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate font-mono text-xs">{item.path}</span>
                    </>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      {/* 대상 에이전트 칩 + 첨부 스킬 칩 */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">{t("talk.talkingTo")}</span>
        {/* 자동 — 서버 디스패치가 스킬·설명 매칭으로 적합 에이전트 선택 */}
        <button
          type="button"
          onClick={() => onActive(AUTO)}
          title={t("talk.auto.hint")}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
            active === AUTO
              ? "border-primary/50 bg-gradient-accent text-white shadow-[var(--shadow-glow-sm)]"
              : "border-border text-muted-foreground hover:bg-muted/60",
          )}
        >
          <Zap className="size-3" />
          {t("talk.auto")}
        </button>
        {agents.map((a) => {
          const on = a.name === active;
          return (
            <button
              key={a.name}
              type="button"
              onClick={() => onActive(a.name)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs font-medium transition-colors",
                on ? "border-primary/50 bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:bg-muted/60",
              )}
            >
              <Avatar agent={a} size={20} />
              {a.label || a.name}
            </button>
          );
        })}
        {attached.map((s) => (
          <span key={s} className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 py-0.5 pl-2 pr-1 text-xs font-medium text-primary">
            <Sparkles className="size-3" />
            {s}
            <button type="button" aria-label={`detach ${s}`} onClick={() => setAttached((prev) => prev.filter((x) => x !== s))} className="rounded-full p-0.5 hover:bg-primary/20">
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>

      {/* 입력 */}
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring">
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={t("talk.placeholder")}
          className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed outline-none"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          aria-label={t("talk.send")}
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl text-white transition-all",
            text.trim() ? "bg-gradient-accent shadow-[var(--shadow-glow-sm)]" : "bg-muted text-muted-foreground",
          )}
        >
          <ArrowUp className="size-4" />
        </button>
      </div>
    </div>
  );
}
