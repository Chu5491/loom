// Talk 화면 — office 에이전트와 대화. 한 턴 = 한 run.
// 입력 → POST /api/runs → useRunStream 으로 SSE 이벤트를 버블에 흘린다.
// @ 멘션 하나로 에이전트(라우팅)·스킬(이 run 에 첨부)·프로젝트 파일(경로 삽입)을 찾는다.
// 자동주입 없음 — 스킬 첨부는 사용자의 명시적 선택, 파일은 텍스트로 경로만 들어간다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp, Bot, CalendarClock, Check, ChevronDown, ChevronRight, CirclePlay, FilePen, FilePlus2, FileSearch, FileText, Info,
  FolderOpen, GitBranch, Globe, Image as ImageIcon, MessagesSquare, MessageSquarePlus,
  Paperclip, Pencil, Plug, ScanSearch, Sparkles, Terminal, Trash2, Workflow, Wrench, X,
} from "lucide-react";
import type { AgentSpec, OfficeEvent, Project, RunInfo, SkillSpec, Thread, WorkflowSpec } from "@loom/core";
import { api } from "../api/client.js";
import { AgentAvatar } from "../components/AgentAvatar.js";
import { AnalysisView } from "../components/AnalysisView.js";
import { ErrorBoundary } from "../components/ErrorBoundary.js";
import { FilesView } from "../components/FilesView.js";
import { SchedulesView } from "../components/SchedulesView.js";
import { GitView } from "../components/GitView.js";
import { Markdown } from "../components/Markdown.js";
import { WorkflowLiveGraph } from "../components/WorkflowLiveGraph.js";
import { useI18n } from "../context/I18nContext.js";
import { useRunStream } from "../hooks/useRunStream.js";
import { cn } from "../lib/utils.js";

interface UserMsg { id: string; role: "user"; agent: string; text: string }
interface AgentMsg { id: string; role: "agent"; agent: string; runId: string; fromAgent?: string; startedAt?: string }
type Msg = UserMsg | AgentMsg;

/** 워크스페이스 내부 뷰 — 대화 / 파일(Monaco) / Git / 분석 / 스케줄. */
type WsView = "talk" | "files" | "git" | "analysis" | "schedules";

export function TalkPage({ project }: { project: Project }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const projectId = project.id;
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
    // 외부에서 시작되는 run(스케줄·트리거·워크플로우 스텝)도 라이브로 흘러들어오게.
    // 창이 백그라운드여도 계속 — 에이전트는 사용자가 딴 데 보는 동안에도 일한다.
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });
  // 대기 중 휴먼 게이트 — 승인/거부 칩을 진행 보드에 띄운다.
  const gates = useQuery({
    queryKey: ["gates", threadId],
    queryFn: () => api.listGates(threadId!),
    enabled: !!threadId,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });
  const agents = office.data?.office.agents ?? [];

  const [active, setActive] = useState<string>("");
  const [pending, setPending] = useState<{ agent: string; text: string } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null); // rename 중인 thread id
  const [view, setView] = useState<WsView>("talk");
  // 워크플로우 실행 모달 — null=닫힘, ""=열림(선택 없음), "이름"=그 워크플로우 preselect.
  const [wfOpen, setWfOpen] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 라이브 활동 집계 — 각 버블(run)이 보고하는 "지금 하는 일"을 팀 패널에 흘린다.
  const [activities, setActivities] = useState<Record<string, { agent: string; item: TraceItem | null }>>({});
  const reportActivity = useCallback((runId: string, agent: string, item: TraceItem | null, running: boolean) => {
    setActivities((prev) => {
      if (!running) {
        if (!(runId in prev)) return prev;
        const next = { ...prev };
        delete next[runId];
        return next;
      }
      return { ...prev, [runId]: { agent, item } };
    });
  }, []);

  // 첫 에이전트를 기본 대상으로.
  useEffect(() => {
    if (!active && agents.length) setActive(agents[0]!.name);
  }, [agents, active]);

  // ⌘K 팔레트의 프로젝트 내부 명령 — 뷰 전환·스레드 점프·워크플로우 모달·타겟.
  useEffect(() => {
    const onCmd = (e: Event) => {
      const cmd = (e as CustomEvent<import("../components/CommandPalette.js").LoomCmd>).detail;
      if (cmd.view) setView(cmd.view);
      if (cmd.threadId) setThreadId(cmd.threadId);
      if (cmd.workflow !== undefined) setWfOpen(cmd.workflow);
      if (cmd.agent) setActive(cmd.agent);
    };
    window.addEventListener("loom:cmd", onCmd);
    return () => window.removeEventListener("loom:cmd", onCmd);
  }, []);

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

  // 바닥 고정(sticky-bottom) — 진입/스레드 전환 시 켜지고, 사용자가 위로 스크롤해
  // 바닥에서 멀어지면 꺼진다. 버블들이 SSE replay 로 비동기로 자라며 smooth 스크롤을
  // 추월해 중간에 멈추던 버그의 해법: 고정 모드 동안은 모든 성장에 즉시 점프.
  const stickRef = useRef(true);
  // 진입 직후엔 로딩 화면이라 scrollRef 가 null — 채팅 패널이 실제로 마운트된 뒤에
  // 아래 effect 들이 다시 붙도록 마운트 조건을 deps 로 끌어온다.
  const chatReady = !!office.data && !!threads.data && (!threadId || !!runs.data) && view === "talk";
  const chatEmpty = messages.length === 0;

  useEffect(() => {
    if (!chatReady) return;
    stickRef.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [threadId, chatReady]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  useEffect(() => {
    if (!chatReady) return;
    const el = scrollRef.current;
    // 내용 래퍼(firstElementChild)는 빈 상태 ↔ 메시지 목록 전환 시 교체된다 —
    // chatEmpty 를 deps 에 둬서 교체될 때 RO 를 새 래퍼에 다시 붙인다.
    const content = el?.firstElementChild;
    if (!el || !content) return;
    // 고정 해제는 "사용자 입력"만 — 프로그램 점프의 scroll 이벤트는 전달되는 사이
    // 콘텐츠가 또 자라면 거리가 커 보여서, 거리 기반 해제는 자기 점프를 사용자
    // 스크롤로 오판한다(실측). scroll 은 바닥 복귀 시 다시 켜는 용도로만 쓴다.
    const dist = () => el.scrollHeight - el.scrollTop - el.clientHeight;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) stickRef.current = false;
    };
    const onTouchMove = () => {
      if (dist() >= 80) stickRef.current = false;
    };
    const onScroll = () => {
      if (dist() < 80) stickRef.current = true;
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => {
      if (stickRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [threadId, chatReady, chatEmpty]);

  async function send(rawText: string, skills: string[], files: string[] = []) {
    // 첨부 파일은 프롬프트에 명시적으로 — 칩으로 고른 것이 그대로 보이게(주입 아님).
    const text = files.length
      ? `${rawText.trim()}\n\n[Files]\n${files.map((f) => `- ${f}`).join("\n")}`
      : rawText.trim();
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
      await api.startRun({ ...opts, agent });
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

  const wsViews: { key: WsView; label: string; icon: React.ReactNode }[] = [
    { key: "talk", label: t("ws.talk"), icon: <MessagesSquare className="size-4" /> },
    { key: "files", label: t("ws.files"), icon: <FolderOpen className="size-4" /> },
    { key: "git", label: t("ws.git"), icon: <GitBranch className="size-4" /> },
    { key: "analysis", label: t("ws.analysis"), icon: <ScanSearch className="size-4" /> },
    { key: "schedules", label: t("ws.schedules"), icon: <CalendarClock className="size-4" /> },
  ];

  return (
    <div className="workspace-enter mx-auto flex h-[calc(100vh-3.5rem)] max-w-7xl flex-col px-4 sm:px-6">
      {/* 워크스페이스 바 — 뷰 스위처 + (대화 뷰일 때) 스레드 컨트롤 */}
      <div className="flex items-center gap-2 border-b border-border/60 py-2">
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
          {wsViews.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                view === v.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className={cn(view === v.key && "text-primary")}>{v.icon}</span>
              {v.label}
            </button>
          ))}
        </div>

        {view === "talk" ? (
          <>
            {/* 작은 화면 폴백 — lg+ 에선 좌측 스레드 사이드바가 담당 */}
            <select
              className="h-8 min-w-0 flex-1 truncate rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring sm:max-w-72 lg:hidden"
              value={threadId ?? ""}
              onChange={(e) => setThreadId(e.target.value || null)}
            >
              <option value="">{t("talk.thread.new")}</option>
              {threads.data.threads.map((th) => (
                <option key={th.id} value={th.id}>{th.name}</option>
              ))}
            </select>
            {(office.data?.office.workflows.length ?? 0) > 0 ? (
              <button
                type="button"
                title={t("talk.workflow.run")}
                onClick={() => setWfOpen("")}
                className="ml-auto flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-primary/40 px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
              >
                <CirclePlay className="size-4" />
                {t("talk.workflow.run")}
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      {wfOpen !== null ? (
        <WorkflowRunModal
          workflows={office.data?.office.workflows ?? []}
          initialName={wfOpen || undefined}
          onClose={() => setWfOpen(null)}
          onRun={async (name, input) => {
            setWfOpen(null);
            setSendError(null);
            try {
              let tid = threadId;
              if (!tid) {
                const { thread } = await api.createThread(input.slice(0, 40), projectId);
                tid = thread.id;
                setThreadId(tid);
                await threads.refetch();
              }
              await api.runWorkflow({ workflow: name, input, projectId, threadId: tid });
              await qc.invalidateQueries({ queryKey: ["runs", tid] });
            } catch (e) {
              setSendError(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      ) : null}

      <div className="flex min-h-0 flex-1 gap-6">
      {view === "files" ? (
        <FilesView project={project} />
      ) : view === "git" ? (
        <GitView project={project} />
      ) : view === "analysis" ? (
        <AnalysisView project={project} />
      ) : view === "schedules" ? (
        <SchedulesView project={project} />
      ) : (
        <>
      {/* 스레드 사이드바 — 대화 목록 (lg+, 작은 화면은 상단 셀렉터 폴백) */}
      <ThreadSidebar
        threads={threads.data.threads}
        threadId={threadId}
        renaming={renaming}
        onRenaming={setRenaming}
        onPick={(id) => setThreadId(id)}
        onRename={(id, name) => void api.renameThread(id, name).then(() => threads.refetch())}
        onDelete={(id) => {
          if (!confirm(t("talk.thread.deleteConfirm"))) return;
          void api.deleteThread(id).then(() => { setThreadId(null); void threads.refetch(); });
        }}
      />

      {/* 채팅 컬럼 */}
      <div className="mx-auto flex h-full w-full max-w-3xl min-w-0 flex-1 flex-col">
        {/* overflow-anchor 끔 — 브라우저 앵커링이 scrollTop 을 임의 조정해 바닥 고정과 충돌 */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto py-6 [overflow-anchor:none]">
          {messages.length === 0 && !pending ? (
            <Welcome activeAgent={agents.find((a) => a.name === active)} />
          ) : (
            <div className="space-y-5">
              {messages.map((msg, i) =>
                msg.role === "user" ? (
                  <UserBubble key={msg.id} text={msg.text} />
                ) : (
                  <div key={msg.id}>
                    {/* 에이전트 간 핸드오프 커넥터 — 누가 누구에게 넘겼는지 한눈에 */}
                    {msg.fromAgent ? <HandoffDivider from={msg.fromAgent} to={msg.agent} /> : null}
                    <ErrorBoundary label={t("err.bubble")} retryLabel={t("err.retry")}>
                    <AgentBubble
                      agent={agents.find((a) => a.name === msg.agent)}
                      fromAgent={msg.fromAgent}
                      runId={msg.runId}
                      run={byId.get(msg.runId)}
                      startedAt={msg.startedAt}
                      workflows={office.data.office.workflows}
                      isLast={i === messages.length - 1}
                      onDone={() => void runs.refetch()}
                      onActivity={reportActivity}
                    />
                    </ErrorBoundary>
                  </div>
                ),
              )}
              {pending ? <UserBubble key="pending" text={pending.text} /> : null}
              {sendError ? <ErrorLine text={sendError} /> : null}
            </div>
          )}
        </div>

        {/* 워크플로우 진행 — 실행 중인 체인의 노드별 상태 + 대기 중 휴먼 게이트 */}
        <WorkflowProgress
          runs={runs.data?.runs ?? []}
          workflows={office.data.office.workflows}
          gates={gates.data?.gates ?? []}
          onGate={(id, ok) => void (ok ? api.approveGate(id) : api.rejectGate(id)).then(() => { void gates.refetch(); void runs.refetch(); })}
        />

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
        workflows={office.data.office.workflows}
        runs={runs.data?.runs ?? []}
        activities={activities}
        active={active}
        onActive={setActive}
        onRunWorkflow={(name) => setWfOpen(name)}
      />
        </>
      )}
      </div>
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

// ── 스레드 사이드바 — 대화 목록을 큼직하게 (lg+). hover 시 이름변경·삭제 ─────────
function ThreadSidebar({
  threads, threadId, renaming, onRenaming, onPick, onRename, onDelete,
}: {
  threads: Thread[];
  threadId: string | null;
  renaming: string | null;
  onRenaming: (id: string | null) => void;
  onPick: (id: string | null) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <aside className="hidden w-60 shrink-0 flex-col overflow-y-auto border-r border-border/60 py-4 pr-3 lg:flex">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("talk.sidebar.threads")}</h3>
        <button
          type="button"
          title={t("talk.thread.new")}
          onClick={() => onPick(null)}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
        >
          <MessageSquarePlus className="size-4" />
        </button>
      </div>
      <div className="space-y-0.5">
        {threadId === null ? (
          <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 px-2.5 py-2 text-sm text-primary">
            {t("talk.thread.new")}
          </div>
        ) : null}
        {threads.map((th) => {
          const active = th.id === threadId;
          if (renaming === th.id) {
            return (
              <input
                key={th.id}
                className="w-full rounded-lg border border-primary/50 bg-background px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                defaultValue={th.name}
                autoFocus
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === "Escape") onRenaming(null);
                  if (e.key === "Enter") {
                    const v = (e.target as HTMLInputElement).value.trim();
                    if (v) onRename(th.id, v);
                    onRenaming(null);
                  }
                }}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v) onRename(th.id, v);
                  onRenaming(null);
                }}
              />
            );
          }
          return (
            <div
              key={th.id}
              className={cn(
                "group/th flex items-center gap-1 rounded-lg transition-colors",
                active ? "bg-primary/10" : "hover:bg-muted/50",
              )}
            >
              <button
                type="button"
                onClick={() => onPick(th.id)}
                className={cn("min-w-0 flex-1 truncate px-2.5 py-2 text-left text-sm", active ? "font-medium" : "text-muted-foreground")}
              >
                {th.name}
              </button>
              <button
                type="button"
                title={t("talk.thread.rename")}
                onClick={() => onRenaming(th.id)}
                className="shrink-0 p-1 text-muted-foreground/50 opacity-0 transition hover:text-primary group-hover/th:opacity-100"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                type="button"
                title={t("talk.thread.delete")}
                onClick={() => onDelete(th.id)}
                className="mr-1 shrink-0 p-1 text-muted-foreground/50 opacity-0 transition hover:text-destructive group-hover/th:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

// ── 팀 패널 — 가능/작업중 에이전트 + 워크플로우 한눈에 (xl 이상) ─────────────────
function TeamPanel({
  agents,
  workflows,
  runs,
  activities,
  active,
  onActive,
  onRunWorkflow,
}: {
  agents: AgentSpec[];
  workflows: WorkflowSpec[];
  runs: RunInfo[];
  activities: Record<string, { agent: string; item: TraceItem | null }>;
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
    <aside className="hidden w-64 shrink-0 flex-col overflow-y-auto border-l border-border/60 py-4 pl-4 xl:flex">
      {/* 팀 현황 — 누가 일하고 있나 (선택이 아니라 상태 보드) */}
      <div className="mb-2 flex items-center gap-2">
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
                <span className="relative shrink-0">
                  <Avatar agent={a} size={30} />
                  {/* 상태 점 — 작업 중(펄스 프라이머리) / 대기(회색) */}
                  <span className={cn(
                    "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-background",
                    working ? "animate-pulse bg-primary" : "bg-muted-foreground/30",
                  )} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{a.label || a.name}</span>
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
                className="group/wf flex w-full items-center gap-2 rounded-xl border border-border/60 bg-card px-2.5 py-2 text-left text-xs transition-all hover:border-primary/40 hover:shadow-[var(--shadow-glow-sm)]"
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

// 핸드오프 커넥터 — 버블 사이에 "누가 → 누구" 흐름을 그린다.
function HandoffDivider({ from, to }: { from: string; to: string }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-primary/40" />
      <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-0.5 text-[11px] text-muted-foreground">
        <Workflow className="size-3 text-primary" />
        <span className="font-medium text-foreground">@{from}</span>
        <span className="text-primary">→</span>
        <span className="font-medium text-foreground">@{to}</span>
      </span>
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-primary/40" />
    </div>
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
function AgentBubble({ agent, fromAgent, runId, run, startedAt, workflows, isLast, onDone, onActivity }: { agent?: AgentSpec; fromAgent?: string; runId: string; run?: RunInfo; startedAt?: string; workflows: WorkflowSpec[]; isLast?: boolean; onDone?: () => void; onActivity?: (runId: string, agent: string, item: TraceItem | null, running: boolean) => void }) {
  const { t } = useI18n();
  const isStartError = runId.startsWith("err:");
  const stream = useRunStream(isStartError ? null : runId);
  const [handedOff, setHandedOff] = useState<string[]>([]);
  const [detail, setDetail] = useState(false);

  const name = agent?.label || agent?.name || "?";
  const view = useMemo(() => deriveView(stream.events), [stream.events]);
  const running = !isStartError && stream.status === "running";

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
                <button
                  type="button"
                  aria-label={t("talk.deleteRun")}
                  onClick={() => confirm(t("talk.deleteConfirm")) && void api.deleteRun(runId).then(() => onDone?.()).catch(() => {})}
                  className="text-muted-foreground/50 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </>
            )
          )}
          {detail && run ? <RunDetailModal run={run} agent={agent} onClose={() => setDetail(false)} /> : null}
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

        {/* 결과 메타(비용) + 전달된 프롬프트(투명성) */}
        {view.result?.costUsd != null ? (
          <p className="mt-1 text-[11px] text-muted-foreground">${view.result.costUsd.toFixed(4)}</p>
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

// 워크플로우 수동 실행 모달 — 워크플로우 선택 + 입력({{input}} 자리에 들어감).
function WorkflowRunModal({
  workflows, initialName, onClose, onRun,
}: {
  workflows: WorkflowSpec[];
  initialName?: string;
  onClose: () => void;
  onRun: (name: string, input: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initialName ?? workflows[0]?.name ?? "");
  const [input, setInput] = useState("");
  const wf = workflows.find((w) => w.name === name);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
            <CirclePlay className="size-4.5" />
          </span>
          <h2 className="font-display text-base font-semibold">{t("talk.workflow.run")}</h2>
        </div>
        <select
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-4 h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {workflows.map((w) => (
            <option key={w.name} value={w.name}>{w.name} · {t("talk.workflow.steps", { n: String(w.nodes.length) })}</option>
          ))}
        </select>
        {wf?.description ? <p className="mt-1.5 text-xs text-muted-foreground">{wf.description}</p> : null}
        <textarea
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("talk.workflow.inputPh")}
          className="mt-3 min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/60">
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={!name || !input.trim()}
            onClick={() => onRun(name, input.trim())}
            className="rounded-md bg-gradient-accent px-3 py-1.5 text-xs font-medium text-white shadow-[var(--shadow-glow-sm)] disabled:opacity-40"
          >
            {t("talk.workflow.go")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── run 상세 모달 — 메타 + [전달 프롬프트][Raw 로그] 탭. Raw 는 진실(디스크 보존본).
function RunDetailModal({ run, agent, onClose }: { run: RunInfo; agent?: AgentSpec; onClose: () => void }) {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<"prompt" | "raw">("prompt");
  const promptQ = useQuery({ queryKey: ["runPrompt", run.id], queryFn: () => api.getRunPrompt(run.id), staleTime: Infinity });
  const rawQ = useQuery({ queryKey: ["runRaw", run.id], queryFn: () => api.getRunRaw(run.id), enabled: tab === "raw" });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(lang === "ko" ? "ko-KR" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="flex h-[80vh] w-full max-w-3xl flex-col rounded-2xl border border-border bg-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        {/* 메타 */}
        <div className="flex flex-wrap items-center gap-2">
          {agent ? <AgentAvatar adapter={agent.adapter} size={24} className="rounded-md" /> : null}
          <span className="font-display text-sm font-semibold">@{run.agent}</span>
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium",
            run.status === "succeeded" ? "bg-success/15 text-success" : run.status === "running" ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive")}>
            {run.status}
          </span>
          {run.workflow ? (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">{run.workflow} · {run.node}</span>
          ) : null}
          {run.costUsd != null ? <span className="font-mono text-[11px] text-muted-foreground">${run.costUsd.toFixed(4)}</span> : null}
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">{run.id.slice(0, 8)}</span>
          <button type="button" aria-label="close" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">{fmt(run.startedAt)} → {fmt(run.endedAt)}</p>

        {/* 탭 */}
        <div className="mt-3 inline-flex w-fit rounded-lg border border-border bg-muted/40 p-0.5">
          {(["prompt", "raw"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-all", tab === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {t(`talk.detail.${k}`)}
            </button>
          ))}
        </div>

        <pre className="mt-2 min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {tab === "prompt"
            ? promptQ.data?.prompt ?? (promptQ.isLoading ? "…" : t("talk.promptPeek.missing"))
            : rawQ.data?.raw ?? (rawQ.isLoading ? "…" : t("talk.detail.rawMissing"))}
        </pre>
      </div>
    </div>
  );
}

// ── 워크플로우 진행 보드 — 이 스레드에서 도는 워크플로우 체인의 노드별 상태 ─────────
// 실행 중이거나 게이트가 대기 중일 때 채팅 위에 뜨는 스트립. run.workflow/node 태그 기반.
function WorkflowProgress({ runs, workflows, gates, onGate }: { runs: RunInfo[]; workflows: WorkflowSpec[]; gates: import("@loom/core").WorkflowGate[]; onGate: (id: string, ok: boolean) => void }) {
  const { t } = useI18n();
  // 실행 중인 체인만 — 같은 워크플로우를 여러 번 돌렸어도 parentRunId 루트로
  // 묶어 "이번 실행"만 그린다(역대 run 이 한 줄에 합쳐지는 것 방지).
  const active = useMemo(() => {
    const byId = new Map(runs.map((r) => [r.id, r]));
    const rootOf = (r: RunInfo): string => {
      let cur = r;
      while (cur.parentRunId) {
        const p = byId.get(cur.parentRunId);
        if (!p || p.workflow !== r.workflow) break;
        cur = p;
      }
      return cur.id;
    };
    const chains = new Map<string, { name: string; list: RunInfo[] }>();
    for (const r of runs) {
      if (!r.workflow) continue;
      const key = `${r.workflow}:${rootOf(r)}`;
      const g = chains.get(key) ?? { name: r.workflow, list: [] };
      g.list.push(r);
      chains.set(key, g);
    }
    return [...chains.values()]
      .map(({ name, list }) => ({ name, list: list.sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1)) }))
      // 게이트에서 멈춘 체인은 running run 이 없다 — 게이트가 있으면 같이 살린다.
      .filter(({ name, list }) => list.some((r) => r.status === "running") || gates.some((g) => g.workflow === name));
  }, [runs, gates]);
  if (active.length === 0 && gates.length === 0) return null;

  // 그래프에 노드가 그려지는 체인은 게이트 버튼도 그래프 안에 있다 — 스트립 중복 방지.
  const graphedWorkflows = new Set(active.map((c) => c.name));

  return (
    <div className="space-y-1.5 pt-3">
      {/* 휴먼 게이트 — 사람이 결정할 차례 (그래프 밖의 게이트만 스트립으로) */}
      {gates.filter((g) => !graphedWorkflows.has(g.workflow)).map((g) => (
        <div key={g.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2">
          <span className="text-sm">⏸</span>
          <span className="text-xs font-semibold">{g.workflow}</span>
          <span className="rounded-full border border-warning/40 px-2 py-0.5 text-[10px] font-medium text-warning">{g.nodeId} · {t("talk.gate.waiting")}</span>
          <span className="ml-auto flex gap-1.5">
            <button
              type="button"
              onClick={() => onGate(g.id, true)}
              className="rounded-md border border-success/40 bg-success/10 px-2.5 py-1 text-xs font-medium text-success transition-colors hover:bg-success/20"
            >
              {t("talk.gate.approve")}
            </button>
            <button
              type="button"
              onClick={() => onGate(g.id, false)}
              className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20"
            >
              {t("talk.gate.reject")}
            </button>
          </span>
        </div>
      ))}
      {active.map(({ name, list }) => (
        <WorkflowChainCard
          key={`${name}:${list[0]?.id ?? ""}`}
          name={name}
          list={list}
          wf={workflows.find((w) => w.name === name)}
          gates={gates.filter((g) => g.workflow === name)}
          onGate={onGate}
        />
      ))}
    </div>
  );
}

// 체인 1개 = 진행 칩 스트립 + 접을 수 있는 라이브 그래프(좌표가 있는 정의만).
function WorkflowChainCard({ name, list, wf, gates, onGate }: {
  name: string;
  list: RunInfo[];
  wf?: WorkflowSpec;
  gates: import("@loom/core").WorkflowGate[];
  onGate: (id: string, ok: boolean) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const total = wf?.nodes.length;
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 shadow-[var(--shadow-glow-sm)]">
      <div className="flex flex-wrap items-center gap-2">
        <Workflow className={cn("size-3.5 text-primary", list.some((r) => r.status === "running") && "animate-pulse")} />
        <span className="text-xs font-semibold">{name}</span>
        <span className="text-[10px] text-muted-foreground">
          {t("talk.wfProgress", { done: String(list.filter((r) => r.status !== "running").length), total: String(total ?? list.length) })}
        </span>
        <span className="flex flex-wrap items-center gap-1">
          {list.map((r, i) => (
            <span key={r.id} className="flex items-center gap-1">
              {i > 0 ? <span className="text-[10px] text-muted-foreground">→</span> : null}
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                  r.status === "running"
                    ? "border-primary/50 bg-primary/15 text-primary"
                    : r.status === "succeeded"
                      ? "border-success/40 bg-success/10 text-success"
                      : "border-destructive/40 bg-destructive/10 text-destructive",
                )}
              >
                {r.node ?? "?"} @{r.agent}{r.status === "running" ? " ⋯" : r.status === "succeeded" ? " ✓" : " ✗"}
              </span>
            </span>
          ))}
        </span>
        {wf ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="ml-auto rounded-md border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
          >
            {open ? t("talk.wfGraph.hide") : t("talk.wfGraph.show")}
          </button>
        ) : null}
      </div>
      {wf && open ? (
        <div className="mt-2">
          <WorkflowLiveGraph wf={wf} chainRuns={list} gates={gates} onGate={onGate} />
        </div>
      ) : null}
    </div>
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
    } else if (e.kind === "handoff") trace.push({ kind: "handoff", name: `@${e.toAgent}`, target: e.reason });
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

// ── 대상 선택 — 컴포저 인라인 단일 드롭다운(팀 패널과 중복 제거). ──────────────────
// "보내는 곳 = @에이전트" 한 곳에서만 고른다. 팀 패널은 현황 보드(클릭=바로가기).
function TargetSelector({ agents, active, onActive }: { agents: AgentSpec[]; active: string; onActive: (name: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);
  const cur = agents.find((a) => a.name === active) ?? agents[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={t("talk.target.change")}
        className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 py-0.5 pl-0.5 pr-1.5 text-xs font-medium text-foreground transition-colors hover:bg-primary/15"
      >
        {cur ? <Avatar agent={cur} size={20} /> : null}
        <span className="max-w-28 truncate">{cur?.label || cur?.name || "—"}</span>
        <ChevronDown className={cn("size-3.5 text-primary transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="absolute bottom-full left-0 z-30 mb-1.5 w-56 rounded-xl border border-border bg-card p-1 shadow-lg">
          <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("talk.target.change")}</p>
          {agents.map((a) => (
            <button
              key={a.name}
              type="button"
              onClick={() => { onActive(a.name); setOpen(false); }}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                a.name === active ? "bg-primary/10" : "hover:bg-muted/60",
              )}
            >
              <Avatar agent={a} size={22} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{a.label || a.name}</span>
                <span className="block truncate font-mono text-[10px] text-muted-foreground">{a.model || a.adapter}</span>
              </span>
              {a.name === active ? <Check className="size-3.5 shrink-0 text-primary" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
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
  onSend: (text: string, skills: string[], files: string[]) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [attached, setAttached] = useState<string[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const [selIdx, setSelIdx] = useState(0);
  const [dismissed, setDismissed] = useState(false); // Esc — 토큰은 두고 메뉴만 닫기
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 드롭/붙여넣기 파일 업로드 → 첨부 칩. 실패한 파일은 조용히 건너뛰지 않고 알림.
  async function addFiles(list: FileList | File[]) {
    const files = [...list];
    if (!files.length) return;
    setUploading((n) => n + files.length);
    for (const f of files) {
      try {
        const { path } = await api.uploadAttachment(f);
        setAttachedFiles((prev) => (prev.includes(path) ? prev : [...prev, path]));
      } catch (e) {
        alert(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  // 커서 앞 텍스트의 끝이 "@partial" 이면 멘션 메뉴를 띄운다. 파일은 / . 도 허용.
  const token = useMemo(() => {
    const m = text.match(/(?:^|\s)@([a-zA-Z0-9_\-./]*)$/);
    return m ? m[1]! : null;
  }, [text]);
  const q = (token ?? "").toLowerCase();

  // 토큰이 바뀌면(계속 타이핑) 선택을 처음으로, 닫았던 메뉴는 다시 연다.
  useEffect(() => {
    setSelIdx(0);
    setDismissed(false);
  }, [token]);

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
      // 파일도 텍스트가 아니라 "선택된" 첨부 칩으로 — 전송 시 명시적으로 실린다.
      setAttachedFiles((prev) => (prev.includes(item.path) ? prev : [...prev, item.path]));
      consumeToken("");
    }
  }

  function submit() {
    if (!text.trim()) return;
    onSend(text, attached, attachedFiles);
    setText("");
    setAttached([]);
    setAttachedFiles([]);
  }

  const menuOpen = menu.length > 0 && !dismissed;

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // IME(한글/일본어/중국어) 조합 중 Enter 는 글자 확정용 — 전송하면 안 됨.
    // 안 막으면 조합 완료 Enter + 실제 Enter 가 둘 다 발화해 마지막 글자가 또 전송됨.
    if (e.nativeEvent.isComposing) return;
    if (menuOpen) {
      // 키보드 네비 — ↑↓ 로 고르고 Enter/Tab 으로 확정, Esc 로 닫기(토큰 유지).
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelIdx((i) => (i + 1) % menu.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelIdx((i) => (i - 1 + menu.length) % menu.length);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(true);
        return;
      }
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        e.preventDefault();
        pick(menu[Math.min(selIdx, menu.length - 1)]!);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
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
      {/* 멘션 메뉴 — 에이전트/스킬/파일 섹션. ↑↓ 키보드 선택, Esc 닫기 */}
      {menuOpen ? (
        <div className="absolute bottom-full left-0 z-10 mb-2 max-h-72 w-80 overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
          <div className="sticky top-0 flex items-center justify-between border-b border-border/60 bg-card/95 px-3 py-1 backdrop-blur">
            <span className="text-[10px] text-muted-foreground">{t("talk.menu.hint")}</span>
            <button type="button" aria-label="close mention menu" onClick={() => setDismissed(true)} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
              <X className="size-3" />
            </button>
          </div>
          {sections.map((sec) => (
            <div key={sec.key}>
              <div className="px-3 pb-0.5 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{sec.label}</div>
              {sec.items.map((item, i) => {
                const flat = menu.indexOf(item);
                const sel = flat === selIdx;
                return (
                <button
                  key={i}
                  type="button"
                  ref={(el) => { if (sel && el) el.scrollIntoView({ block: "nearest" }); }}
                  onClick={() => pick(item)}
                  onMouseEnter={() => setSelIdx(flat)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                    sel ? "bg-primary/15" : "hover:bg-muted/60",
                  )}
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
                );
              })}
            </div>
          ))}
        </div>
      ) : null}

      {/* 입력 — 파일/이미지를 끌어다 놓거나(드롭) 붙여넣으면 첨부된다 */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "relative flex flex-col rounded-2xl border bg-card p-2 shadow-sm transition-colors focus-within:ring-2 focus-within:ring-ring",
          dragOver ? "border-primary border-dashed bg-primary/5" : "border-border",
        )}
      >
        {dragOver ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-primary/10 backdrop-blur-[1px]">
            <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
              <Paperclip className="size-4" />
              {t("talk.dropHint")}
            </span>
          </div>
        ) : null}

        {/* 상단 줄 — 대상 선택(단일, 컴포저 인라인) + 첨부 스킬·파일 칩 */}
        <div className="flex flex-wrap items-center gap-1.5 px-1 pb-1.5">
          <TargetSelector agents={agents} active={active} onActive={onActive} />
          {attached.length > 0 || attachedFiles.length > 0 ? (
            <span className="mx-0.5 h-4 w-px bg-border" />
          ) : null}
          {attached.length > 0 || attachedFiles.length > 0 ? (
            <>
            {attached.map((s) => (
              <span key={s} className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 py-0.5 pl-2 pr-1 text-xs font-medium text-primary">
                <Sparkles className="size-3" />
                {s}
                <button type="button" aria-label={`detach ${s}`} onClick={() => setAttached((prev) => prev.filter((x) => x !== s))} className="rounded-full p-0.5 hover:bg-primary/20">
                  <X className="size-3" />
                </button>
              </span>
            ))}
            {attachedFiles.map((f) => {
              const isImage = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(f);
              const Icon = isImage ? ImageIcon : FileText;
              return (
                <span key={f} title={f} className="inline-flex max-w-56 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 py-0.5 pl-2 pr-1 font-mono text-[11px] text-foreground">
                  <Icon className="size-3 shrink-0 text-primary" />
                  <span className="truncate">{f.split("/").pop()}</span>
                  <button type="button" aria-label={`detach ${f}`} onClick={() => setAttachedFiles((prev) => prev.filter((x) => x !== f))} className="shrink-0 rounded-full p-0.5 hover:bg-primary/20">
                    <X className="size-3" />
                  </button>
                </span>
              );
            })}
            </>
          ) : null}
        </div>

        <div className="flex items-end gap-2">
        {/* 파일 선택 폴백 */}
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }}
        />
        <button
          type="button"
          title={t("talk.attach")}
          onClick={() => fileRef.current?.click()}
          className="flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          {uploading > 0 ? <span className="size-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" /> : <Paperclip className="size-4" />}
        </button>
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
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
    </div>
  );
}
