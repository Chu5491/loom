// Talk 화면 — office 에이전트와 대화. 한 턴 = 한 run.
// 입력 → POST /api/runs → useRunStream 으로 SSE 이벤트를 버블에 흘린다.
// @ 멘션 하나로 에이전트(라우팅)·스킬(이 run 에 첨부)·프로젝트 파일(경로 삽입)을 찾는다.
// 자동주입 없음 — 스킬 첨부는 사용자의 명시적 선택, 파일은 텍스트로 경로만 들어간다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  CalendarClock, CirclePlay, FolderOpen, GitBranch, MessagesSquare,
  ListTodo, NotebookPen, ScanSearch, Users, Wrench,
} from "lucide-react";
import type { Project } from "@loom/core";
import { api } from "../api/client.js";
import { AnalysisView } from "../components/AnalysisView.js";
import { ErrorBoundary } from "../components/ErrorBoundary.js";
import { FilesView } from "../components/FilesView.js";
import { SchedulesView } from "../components/SchedulesView.js";
import { GitView } from "../components/GitView.js";
import { MeetingView } from "../components/MeetingView.js";
import { TasksView } from "../components/TasksView.js";
import { NotesModal, WorkflowRunModal } from "../components/talk/Modals.js";
import { Centered, Welcome, HandoffDivider, UserBubble } from "../components/talk/atoms.js";
import { ThreadSidebar } from "../components/talk/ThreadSidebar.js";
import { AgentBubble, ErrorLine } from "../components/talk/AgentBubble.js";
import { WorkflowProgress } from "../components/talk/WorkflowCards.js";
import { TeamPanel } from "../components/talk/TeamPanel.js";
import { Composer } from "../components/talk/Composer.js";
import { useI18n } from "../context/I18nContext.js";
import { useConfirm, useAlert } from "../context/DialogContext.js";
import { cn } from "../lib/utils.js";
import { getParam, setParams } from "../lib/url.js";
import type { TraceItem } from "../lib/derive.js";

interface UserMsg { id: string; role: "user"; agent: string; text: string }
interface AgentMsg { id: string; role: "agent"; agent: string; runId: string; fromAgent?: string; startedAt?: string }
type Msg = UserMsg | AgentMsg;

/** 워크스페이스 내부 뷰 — 대화 / 파일(Monaco) / Git / 분석 / 스케줄. */
type WsView = "talk" | "tasks" | "meeting" | "files" | "git" | "analysis" | "schedules";

export function TalkPage({ project }: { project: Project }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const alert = useAlert();
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

  // 기본 대상 = 마스터(유일 인입점). 그냥 보내면 마스터가 받아 직접 답하거나 팀원에게
  // 위임 → 한 작업이 된다. 특정 에이전트와 직접 대화하려면 컴포저에서 바꾸면 된다.
  useEffect(() => {
    if (!active && agents.length) setActive((agents.find((a) => a.master) ?? agents.find((a) => a.delegate) ?? agents[0]!).name);
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

  // 두 그룹으로 분리 — 협업(대화·작업·회의실)과 프로젝트 도구(파일·깃·분석·스케줄)는
  // 기능이 다르다(req 7). 한 워크스페이스 안에서 구분선 + 그룹 라벨로 나눈다.
  const wsGroups: { key: string; label: string; items: { key: WsView; label: string; icon: React.ReactNode }[] }[] = [
    {
      key: "collab",
      label: t("ws.group.collab"),
      items: [
        { key: "talk", label: t("ws.talk"), icon: <MessagesSquare className="size-4" /> },
        { key: "tasks", label: t("ws.tasks"), icon: <ListTodo className="size-4" /> },
        { key: "meeting", label: t("ws.meeting"), icon: <Users className="size-4" /> },
      ],
    },
    {
      key: "tools",
      label: t("ws.group.tools"),
      items: [
        { key: "files", label: t("ws.files"), icon: <FolderOpen className="size-4" /> },
        { key: "git", label: t("ws.git"), icon: <GitBranch className="size-4" /> },
        { key: "analysis", label: t("ws.analysis"), icon: <ScanSearch className="size-4" /> },
        { key: "schedules", label: t("ws.schedules"), icon: <CalendarClock className="size-4" /> },
      ],
    },
  ];

  return (
    <div className="workspace-enter flex min-h-0 flex-1 flex-col px-4 py-3 sm:px-6 lg:px-8">
      {/* 워크스페이스 바 — 뷰 스위처(헤더 네비와 같은 글로우 필) + 스레드 컨트롤 */}
      <div className="flex items-center gap-2 py-2">
        <div className="inline-flex items-center gap-1">
          {wsGroups.map((g, gi) => (
            <div key={g.key} className="inline-flex items-center gap-1">
              {gi > 0 ? <span className="mx-1.5 h-5 w-px shrink-0 bg-border" /> : null}
              <span className="hidden shrink-0 px-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/60 xl:inline">{g.label}</span>
              {g.items.map((v) => (
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
        onDelete={async (id) => {
          if (!(await confirm({ body: t("talk.thread.deleteConfirm"), tone: "danger", confirmLabel: t("common.delete") }))) return;
          void api.deleteThread(id)
            .then(() => { setThreadId(null); void threads.refetch(); })
            .catch((e: unknown) => {
              // 실행 중 run 보호(서버 409) — 무음이면 삭제 버튼이 죽은 것처럼 보인다.
              void alert(String(e).includes("still_running") ? t("talk.thread.deleteRunning") : String(e));
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
