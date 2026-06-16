// Talk 화면 — office 에이전트와 대화. 한 턴 = 한 run.
// 입력 → POST /api/runs → useRunStream 으로 SSE 이벤트를 버블에 흘린다.
// @ 멘션 하나로 에이전트(라우팅)·스킬(이 run 에 첨부)·프로젝트 파일(경로 삽입)을 찾는다.
// 자동주입 없음 — 스킬 첨부는 사용자의 명시적 선택, 파일은 텍스트로 경로만 들어간다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUp, Bot, CalendarClock, Check, ChevronDown, ChevronRight, CirclePlay, FilePen, FilePlus2, FileSearch, FileText, Info,
  FolderGit2, FolderOpen, GitBranch, Globe, Image as ImageIcon, MessagesSquare, MessageSquarePlus,
  ListTodo, Loader2, NotebookPen, Paperclip, Pencil, Plug, RotateCcw, ScanSearch, Sparkles, Terminal, ThumbsDown, ThumbsUp, Trash2, Users, Workflow, Wrench, X,
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
import { MeetingView } from "../components/MeetingView.js";
import { TasksView } from "../components/TasksView.js";
import { WorkflowLiveGraph } from "../components/WorkflowLiveGraph.js";
import { Button } from "../components/ui.js";
import { useI18n } from "../context/I18nContext.js";
import { useRunStream } from "../hooks/useRunStream.js";
import { cn } from "../lib/utils.js";
import { getParam, setParams } from "../lib/url.js";
import { extractReport, type WorkReport } from "../lib/report.js";

interface UserMsg { id: string; role: "user"; agent: string; text: string }
interface AgentMsg { id: string; role: "agent"; agent: string; runId: string; fromAgent?: string; startedAt?: string }
type Msg = UserMsg | AgentMsg;

/** 워크스페이스 내부 뷰 — 대화 / 파일(Monaco) / Git / 분석 / 스케줄. */
type WsView = "talk" | "tasks" | "meeting" | "files" | "git" | "analysis" | "schedules";

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
  // 첫 로드: URL 에 지정된 스레드가 목록에 있으면 그것, 없으면 최신 것을 연다.
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    if (booted || !threads.data) return;
    const list = threads.data.threads;
    const fromUrl = getParam("thread");
    setThreadId(fromUrl && list.some((th) => th.id === fromUrl) ? fromUrl : (list[0]?.id ?? null));
    setBooted(true);
  }, [threads.data, booted]);

  // 프로젝트 전역 run — 다른 스레드에서 도는 run 을 감지해 동시 파일수정 충돌을
  // 경고한다(강제 차단은 안 함 — 의도적 병렬도 있으니 알리기만).
  const projectRuns = useQuery({
    queryKey: ["runs", "project", project.id],
    queryFn: () => api.listProjectRuns(project.id),
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });
  const otherRunning = useMemo(
    () => (projectRuns.data?.runs ?? []).filter((r) => r.status === "running" && r.threadId !== threadId),
    [projectRuns.data, threadId],
  );

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
  const [view, setView] = useState<WsView>(() => {
    const p = getParam("view");
    return (["talk", "tasks", "meeting", "files", "git", "analysis", "schedules"] as const).includes(p as WsView) ? (p as WsView) : "talk";
  });
  // 스레드·뷰를 URL 에 반영(새로고침/딥링크 복원). talk 은 기본값이라 키 생략.
  useEffect(() => {
    setParams({ thread: threadId, view: view === "talk" ? null : view });
  }, [threadId, view]);
  // 워크플로우 실행 모달 — null=닫힘, ""=열림(선택 없음), "이름"=그 워크플로우 preselect.
  const [wfOpen, setWfOpen] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 라이브 활동 집계 — 각 버블(run)이 보고하는 "지금 하는 일"을 팀 패널에 흘린다.
  const [activities, setActivities] = useState<Record<string, { agent: string; item: TraceItem | null }>>({});
  // 활동 스트림 — 보고가 바뀔 때마다 시간순 누적(최근 50). 스레드 전환 시 리셋.
  const [feed, setFeed] = useState<{ at: number; runId: string; agent: string; item: TraceItem }[]>([]);
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
    if (running && item) {
      setFeed((prev) => {
        const last = [...prev].reverse().find((f) => f.runId === runId);
        if (last && last.item.name === item.name && last.item.target === item.target) return prev;
        return [...prev, { at: Date.now(), runId, agent, item }].slice(-50);
      });
    }
  }, []);
  useEffect(() => setFeed([]), [threadId]);

  // 기본 대상 = 리드(위임 가능 에이전트). 그냥 보내면 리드가 받아 내부 위임 →
  // 한 작업이 된다. 특정 에이전트와 직접 대화하려면 컴포저에서 바꾸면 된다.
  useEffect(() => {
    if (!active && agents.length) setActive((agents.find((a) => a.delegate) ?? agents[0]!).name);
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
    // @auto 는 특수 — 서버가 작업 텍스트로 적임자를 고른다(디스패치).
    let agent = active;
    let prompt = text;
    let auto = active === "auto";
    const m = text.match(/^@([a-zA-Z0-9_-]+)\s*/);
    if (m && m[1] === "auto") {
      auto = true;
      prompt = text.slice(m[0].length).trim();
    } else if (m && agents.some((a) => a.name === m[1])) {
      agent = m[1]!;
      auto = false;
      prompt = text.slice(m[0].length).trim();
      setActive(agent);
    }
    if (!prompt || (!auto && !agent)) return;

    // 낙관적 user 버블 하나만(pending). run 이 runs.data 에 들어오면 실제 버블이 대체.
    setSendError(null);
    setPending({ agent: auto ? "auto" : agent, text: prompt });
    try {
      // 스레드가 없으면(새 대화) 첫 메시지로 자동 생성 — 이름은 프롬프트 머리.
      let tid = threadId;
      if (!tid) {
        const { thread } = await api.createThread(prompt.slice(0, 40), projectId);
        tid = thread.id;
        setThreadId(tid);
        await threads.refetch();
      }
      if (auto) {
        const { pick } = await api.dispatchRun({ prompt, projectId, threadId: tid });
        setActive(pick.agent); // 다음 턴 기본값을 고른 에이전트로
      } else {
        const opts = { prompt, projectId, threadId: tid, ...(skills.length ? { skills } : {}) };
        await api.startRun({ ...opts, agent });
      }
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
    { key: "tasks", label: t("ws.tasks"), icon: <ListTodo className="size-4" /> },
    { key: "meeting", label: t("ws.meeting"), icon: <Users className="size-4" /> },
    { key: "files", label: t("ws.files"), icon: <FolderOpen className="size-4" /> },
    { key: "git", label: t("ws.git"), icon: <GitBranch className="size-4" /> },
    { key: "analysis", label: t("ws.analysis"), icon: <ScanSearch className="size-4" /> },
    { key: "schedules", label: t("ws.schedules"), icon: <CalendarClock className="size-4" /> },
  ];

  return (
    <div className="workspace-enter flex min-h-0 flex-1 flex-col px-4 py-3 sm:px-6 lg:px-8">
      {/* 워크스페이스 바 — 뷰 스위처(헤더 네비와 같은 글로우 필) + 스레드 컨트롤 */}
      <div className="flex items-center gap-2 py-2">
        <div className="inline-flex gap-1">
          {wsViews.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all",
                view === v.key
                  ? "bg-primary/15 text-foreground shadow-[var(--shadow-glow-sm)]"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
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
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                title={t("notes.title")}
                onClick={() => setNotesOpen(true)}
                className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
              >
                <NotebookPen className="size-4" />
                {t("notes.title")}
              </button>
              {(office.data?.office.workflows.length ?? 0) > 0 ? (
                <button
                  type="button"
                  title={t("talk.workflow.run")}
                  onClick={() => setWfOpen("")}
                  className="flex h-8 items-center gap-1.5 rounded-md border border-primary/40 px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                >
                  <CirclePlay className="size-4" />
                  {t("talk.workflow.run")}
                </button>
              ) : null}
            </span>
          </>
        ) : null}
      </div>

      {notesOpen ? <NotesModal projectId={projectId} onClose={() => setNotesOpen(false)} /> : null}

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

      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial={{ opacity: 0, y: 10, filter: "blur(2px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -10, filter: "blur(2px)" }}
          transition={{ duration: 0.25 }}
          className="flex min-h-0 flex-1 gap-5 mb-4 w-full"
        >
          {view === "tasks" ? (
            <TasksView project={project} />
          ) : view === "meeting" ? (
            <MeetingView project={project} />
          ) : view === "files" ? (
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
          void api.deleteThread(id)
            .then(() => { setThreadId(null); void threads.refetch(); })
            .catch((e: unknown) => {
              // 실행 중 run 보호(서버 409) — 무음이면 삭제 버튼이 죽은 것처럼 보인다.
              alert(String(e).includes("still_running") ? t("talk.thread.deleteRunning") : String(e));
            });
        }}
      />

      {/* 채팅 컬럼 = 스테이지 — 워크스페이스의 주인공 서피스 */}
      <div className="mx-auto flex h-full w-full min-w-0 max-w-6xl flex-1 flex-col rounded-3xl glass-panel border-cyber px-6 sm:px-8">
        {/* overflow-anchor 끔 — 브라우저 앵커링이 scrollTop 을 임의 조정해 바닥 고정과 충돌 */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto py-6 [overflow-anchor:none]">
          {messages.length === 0 && !pending ? (
            <Welcome activeAgent={agents.find((a) => a.name === active)} />
          ) : (
            <div className="space-y-5">
              {messages.map((msg, i) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 15, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  layout
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                >
                  {msg.role === "user" ? (
                    <UserBubble text={msg.text} />
                  ) : (
                    <div>
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
                        projectName={project.name}
                      />
                      </ErrorBoundary>
                    </div>
                  )}
                </motion.div>
              ))}
              <AnimatePresence>
                {pending ? (
                  <motion.div
                    key="pending"
                    initial={{ opacity: 0, y: 15, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    layout
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  >
                    <UserBubble text={pending.text} />
                  </motion.div>
                ) : null}
              </AnimatePresence>
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

        {otherRunning.length > 0 ? (
          <div className="mx-auto flex w-full max-w-3xl items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-1.5 text-[11px] text-warning">
            <Wrench className="size-3.5 shrink-0" />
            <span>{t("talk.concurrentWarn", { n: String(otherRunning.length), agents: otherRunning.map((r) => `@${r.agent}`).join(", ") })}</span>
          </div>
        ) : null}

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
            feed={feed}
            active={active}
            onActive={setActive}
            onRunWorkflow={(name) => setWfOpen(name)}
          />
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// 프로젝트 공유 메모 — <project>/.loom/notes.md. 사람과 에이전트가 같은 파일을
// 읽고 쓴다(run 프롬프트에는 파일이 있을 때만 경로 안내).
function NotesModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const notes = useQuery({ queryKey: ["notes", projectId], queryFn: () => api.getNotes(projectId) });
  const [draft, setDraft] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (text: string) => api.putNotes(projectId, text),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["notes", projectId] }); onClose(); },
  });
  const value = draft ?? notes.data?.notes ?? "";
  const empty = !notes.isLoading && notes.data?.notes == null && draft === null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-card p-4 shadow-2xl">
        <div className="mb-2 flex items-center gap-2">
          <NotebookPen className="size-4 text-primary" />
          <h2 className="font-display text-base font-semibold">{t("notes.title")}</h2>
          <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">.loom/notes.md</code>
          <button type="button" onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground" aria-label="close">
            <X className="size-4" />
          </button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">{t("notes.hint")}</p>
        {empty ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-10 text-center">
            <p className="max-w-sm text-sm text-muted-foreground">{t("notes.empty")}</p>
            <Button size="sm" onClick={() => setDraft(`# ${t("notes.title")}\n\n`)}>
              <NotebookPen className="size-3.5" />
              {t("notes.start")}
            </Button>
          </div>
        ) : (
          <>
            <textarea
              value={value}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-72 flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2.5 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={onClose}>{t("common.cancel")}</Button>
              <Button size="sm" disabled={draft === null || save.isPending} onClick={() => save.mutate(value)}>
                {save.isPending ? "…" : t("notes.save")}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex h-full max-w-3xl items-center justify-center px-6">
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
    <aside className="hidden w-64 shrink-0 flex-col overflow-y-auto rounded-2xl glass-panel p-4 lg:flex">
      <div className="mb-4 flex items-center justify-between">
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
function AgentBubble({ agent, fromAgent, runId, run, startedAt, workflows, isLast, onDone, onActivity, projectName }: { agent?: AgentSpec; fromAgent?: string; runId: string; run?: RunInfo; startedAt?: string; workflows: WorkflowSpec[]; isLast?: boolean; onDone?: () => void; onActivity?: (runId: string, agent: string, item: TraceItem | null, running: boolean) => void; projectName?: string }) {
  const { t } = useI18n();
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
    return { tools, files, loadout: view.loadout, costUsd: view.result?.costUsd, durationMs };
  }, [view.trace, view.loadout, view.result, run?.startedAt, run?.endedAt]);

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
                    onClick={() => void api.rerunRun(runId).then(() => onDone?.()).catch((e: unknown) => alert(String(e)))}
                    className="text-muted-foreground/50 opacity-0 transition-opacity hover:text-primary group-hover:opacity-100"
                  >
                    <RotateCcw className="size-3.5" />
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
            />
            {view.loadout ? <LoadoutChips loadout={view.loadout} /> : null}
          </>
        ) : null}

        {/* 완료 — 활동 카드 하나로 통합(시스템: 도구·파일·스킬·비용·시간 + 에이전트: 요약). */}
        {showCard ? <ActivityCard report={view.report} activity={activity} /> : null}

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
              <span className="text-[11px] text-muted-foreground">${view.result.costUsd.toFixed(4)}</span>
            ) : null}
            <RatingButtons runId={runId} initial={run?.rating ?? null} />
            {/* 완료 → 작업 상세로(전체 파싱 결과 + 위임 흐름). 리드가 받아 위임한 흐름은
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
  report?: WorkReport;
  result?: Extract<OfficeEvent, { kind: "result" }>;
  errors: string[];
  changedFiles: number;
  loadout?: { skills: string[]; mcp: string[]; delegate: boolean };
}

// 도구 표시명 정리 — mcp__server__tool → server·tool, 그 외는 그대로.
function prettyTool(name: string): string {
  const m = /^mcp__([^_]+)__(.+)$/.exec(name);
  return m ? `${m[1]}·${m[2]}` : name;
}
function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

interface ActivityData {
  tools: { name: string; count: number }[];
  files: { path: string; action?: string }[];
  loadout?: { skills: string[]; mcp: string[]; delegate: boolean };
  costUsd?: number;
  durationMs?: number;
}

// 활동 카드 — 시스템이 파싱한 사실(도구·파일·스킬·비용·시간) + 에이전트 요약(report).
// 산문 대신 "무엇을, 어떤 도구로 했나"를 한눈에. 빈 섹션은 생략.
function ActivityCard({ report, activity }: { report?: WorkReport; activity: ActivityData }) {
  const { t } = useI18n();
  const has = (a?: unknown[]) => Array.isArray(a) && a.length > 0;
  const { tools, files, loadout, costUsd, durationMs } = activity;
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
  if (costUsd != null && costUsd > 0) stats.push({ icon: <Sparkles className="size-3" />, label: `$${costUsd.toFixed(4)}` });

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

function deriveView(events: OfficeEvent[]): DerivedView {
  const trace: TraceItem[] = [];
  const texts: string[] = [];
  const errors: string[] = [];
  let result: Extract<OfficeEvent, { kind: "result" }> | undefined;
  let loadout: { skills: string[]; mcp: string[]; delegate: boolean } | undefined;
  let changedFiles = 0;
  for (const e of events) {
    if (e.kind === "text") texts.push(e.text);
    else if (e.kind === "tool") trace.push({ kind: "tool", name: e.name, target: e.target });
    else if (e.kind === "file") {
      trace.push({ kind: "file", name: e.action === "edit" ? "Edit" : "Write", target: e.path, action: e.action });
      changedFiles++;
    } else if (e.kind === "handoff") trace.push({ kind: "handoff", name: `@${e.toAgent}`, target: e.reason });
    else if (e.kind === "loadout") loadout = { skills: e.skills, mcp: e.mcp, delegate: e.delegate };
    else if (e.kind === "result") result = e;
    else if (e.kind === "error") errors.push(e.message);
  }
  // result 가 오면 그게 최종 전체 텍스트 — 누적 text 보다 우선.
  const rawBody = result?.text ?? texts.join("");
  const { body, report } = extractReport(rawBody);
  return { trace, body, report, result, errors, changedFiles, loadout };
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

// 작업 중 패널 — "에이전트가 이 프로젝트에서 지금 일하고 있다"를 전달(스트리밍 없이).
// 펄스 아바타 + 프로젝트 컨텍스트 + 경과시간 + 셔머 진행 바. 결과는 완료 시 한 번에.
function WorkingPanel({ agent, startedAt, projectName }: {
  agent?: AgentSpec; startedAt?: string; projectName?: string;
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

      {/* 작업 중 — 스트리밍 없이 상태만(결과는 완료 시 한 번에) */}
      <div className="flex items-center gap-1.5 px-3.5 pt-2 text-[12px]">
        <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
        <span className="text-muted-foreground">{t("talk.thinking")}</span>
      </div>

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
  const isAuto = active === "auto";
  const cur = agents.find((a) => a.name === active) ?? agents[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={t("talk.target.change")}
        className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 py-0.5 pl-0.5 pr-1.5 text-xs font-medium text-foreground transition-colors hover:bg-primary/15"
      >
        {isAuto ? (
          <span className="flex size-5 items-center justify-center rounded-full bg-primary/20 text-primary"><Sparkles className="size-3" /></span>
        ) : cur ? <Avatar agent={cur} size={20} /> : null}
        <span className="max-w-28 truncate">{isAuto ? t("talk.target.auto") : cur?.label || cur?.name || "—"}</span>
        <ChevronDown className={cn("size-3.5 text-primary transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="absolute bottom-full left-0 z-30 mb-1.5 w-56 rounded-xl border border-border bg-card p-1 shadow-lg">
          <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("talk.target.change")}</p>
          {/* @auto — 서버가 작업 텍스트로 적임자 자동 선택. */}
          <button
            type="button"
            onClick={() => { onActive("auto"); setOpen(false); }}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
              isAuto ? "bg-primary/10" : "hover:bg-muted/60",
            )}
          >
            <span className="flex size-[22px] items-center justify-center rounded-full bg-primary/20 text-primary"><Sparkles className="size-3.5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{t("talk.target.auto")}</span>
              <span className="block truncate text-[10px] text-muted-foreground">{t("talk.target.autoHint")}</span>
            </span>
            {isAuto ? <Check className="size-3.5 shrink-0 text-primary" /> : null}
          </button>
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
