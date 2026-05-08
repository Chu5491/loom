// 프로젝트 워크스페이스. 에디터를 메인 캔버스로, 채팅은 우측 floating overlay.
// 우측 가장자리의 아이콘 rail에서 채팅을 토글, 채팅창은 에디터를 밀지 않고
// 위에 그림자 + border로 떠 있다. 카톡 PC + 챗봇 패턴.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOutletContext, useParams } from "react-router-dom";
import { toast } from "sonner";
import type { AdapterManifest } from "@loom/core";
import type { LayoutOutletContext } from "../components/Layout.js";
import { api } from "../api/client.js";
import { useRoomDerived } from "../components/chat/index.js";
import { agentColorOf } from "../components/agentColor.js";
import {
  ChatDock,
  readDockPlacement,
  type DockPlacement,
} from "../components/ChatDock.js";
import { ContextDrawer } from "../components/ContextDrawer.js";
import { FilePalette } from "../components/FilePalette.js";
import { FileTab } from "../components/FileTab.js";
import { TeamRibbon } from "../components/TeamRibbon.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";
import { useLoomEvent } from "../lib/loomEvents.js";
import { ActivePin } from "./workspace/ActivePin.js";
import { ChatPanel } from "./workspace/ChatPanel.js";
import { FileTabBar } from "./workspace/FileTabBar.js";
import { MeetingRoom } from "./workspace/MeetingRoom.js";
import { ThreadBar } from "./workspace/ThreadBar.js";
import { ThreadList } from "./workspace/ThreadList.js";
import { readPersistedTabs } from "./workspace/persistence.js";

const VIEW_KEY = "loom:workspace:view";
const CANVAS_COLLAPSED_KEY = "loom:workspace:canvasCollapsed";
type WorkspaceView = "office" | "editor";

export function WorkspacePage() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();
  const { chatFullModal, setChatFullModal } =
    useOutletContext<LayoutOutletContext>();

  // ── Data
  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.getProject(projectId!),
    enabled: !!projectId,
  });
  const agents = useQuery({
    queryKey: ["agents", { projectId }],
    queryFn: () => api.listAgents({ projectId }),
    enabled: !!projectId,
  });
  const adapters = useQuery({
    queryKey: ["adapters"],
    queryFn: api.listAdapters,
  });
  const projectAgentIds = useMemo(
    () => new Set((agents.data?.agents ?? []).map((a) => a.id)),
    [agents.data],
  );
  const runsQuery = useQuery({
    queryKey: ["runs", { projectId }],
    queryFn: () => api.listRuns({ limit: 100 }),
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return false;
      const hasActive = data.runs.some(
        (r) => r.status === "queued" || r.status === "running",
      );
      return hasActive ? 2000 : false;
    },
    enabled: !!projectId,
  });
  const projectRuns = useMemo(
    () =>
      (runsQuery.data?.runs ?? []).filter((r) => projectAgentIds.has(r.agentId)),
    [runsQuery.data, projectAgentIds],
  );

  // 라이브 "@agent가 이 파일 편집 중" 맵 (project-relative path → agent id).
  // run 진행 중에는 빠르게 폴링해 탭/뷰어 배지가 거의 실시간으로 박동.
  const activeTouchesQuery = useQuery({
    queryKey: ["projectActiveTouches", projectId],
    queryFn: () => api.getProjectActiveTouches(projectId!),
    enabled: !!projectId,
    refetchInterval: 1500,
  });
  // 사무실 책상의 "지금 들고 있는 도구". 동일 폴링 cadence — 시각적 일관성.
  const activeToolsQuery = useQuery({
    queryKey: ["projectActiveTools", projectId],
    queryFn: () => api.getProjectActiveTools(projectId!),
    enabled: !!projectId,
    refetchInterval: 1500,
  });
  const activeByPath = useMemo(() => {
    const m = new Map<string, string>();
    for (const tch of activeTouchesQuery.data?.touches ?? []) {
      for (const p of tch.paths) m.set(p, tch.agentId);
    }
    return m;
  }, [activeTouchesQuery.data]);
  const lineByPath = useMemo(() => {
    const m = new Map<string, number>();
    for (const tch of activeTouchesQuery.data?.touches ?? []) {
      for (const loc of tch.locations) m.set(loc.path, loc.line);
    }
    return m;
  }, [activeTouchesQuery.data]);
  // FileTabBar 단일 표시는 activeByPath/lineByPath로 충분하지만, Monaco는
  // 한 파일에 떠있는 모든 에이전트를 동시에 표시하므로 path → presence[] 맵을
  // 별도로 만든다. 첫 항목이 가장 최근(primary).
  const presencesByPath = useMemo(() => {
    const m = new Map<string, Array<{ agentId: string; line: number }>>();
    for (const tch of activeTouchesQuery.data?.touches ?? []) {
      const lineFor = new Map(tch.locations.map((l) => [l.path, l.line]));
      for (const p of tch.paths) {
        const list = m.get(p) ?? [];
        list.push({ agentId: tch.agentId, line: lineFor.get(p) ?? 1 });
        m.set(p, list);
      }
    }
    return m;
  }, [activeTouchesQuery.data]);
  // TeamRibbon presence dot용 — 어떤 파일이든 만지고 있는 에이전트면 working.
  const touchingIds = useMemo(() => {
    const s = new Set<string>();
    for (const tch of activeTouchesQuery.data?.touches ?? []) {
      s.add(tch.agentId);
    }
    return s;
  }, [activeTouchesQuery.data]);

  // 서버는 updated_at 내림차순 정렬 — 가장 최근 thread가 항상 위.
  const threadsQuery = useQuery({
    queryKey: ["threads", { projectId }],
    queryFn: () => api.listThreads({ projectId }),
    enabled: !!projectId,
    refetchInterval: () => {
      // run 진행 중에는 빠르게 — 첫 메시지 직후 새 thread가 어디 갔는지 의문이 들기 전에 표시.
      const active = runsQuery.data?.runs.some(
        (r) => r.status === "queued" || r.status === "running",
      );
      return active ? 3000 : 30_000;
    },
  });
  const threadList = threadsQuery.data?.threads ?? [];

  const agentList = agents.data?.agents ?? [];
  const manifests = adapters.data?.adapters ?? [];
  const adapterByKind = useMemo(() => {
    const map: Record<string, AdapterManifest> = {};
    for (const m of manifests) map[m.kind] = m;
    return map;
  }, [manifests]);

  // 프로젝트 어디서든 작업 중인 사람 — 다른 thread에 있어도 team ribbon에 present.
  const { working, workingIds } = useRoomDerived(projectRuns, agentList);

  // 탭은 파일 경로 only. 채팅은 자체 패널. activeFile null = 가운데 비어있음.
  // activeThreadId null = 다음 전송에서 서버가 새 thread 생성 → 반환 id 채택.
  const tabsKey = projectId ? `loom:workspace:${projectId}:tabs` : null;
  const [openFiles, setOpenFiles] = useState<string[]>(() =>
    readPersistedTabs(tabsKey).openFiles,
  );
  const [activeFile, setActiveFile] = useState<string | null>(() => {
    const persisted = readPersistedTabs(tabsKey);
    return persisted.activeTab === "chat" ? null : persisted.activeTab;
  });
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    () => readPersistedTabs(tabsKey).activeThreadId,
  );

  // 메인 캔버스 뷰 모드 — Office가 기본. 사용자가 파일 탭을 누르거나 ⌘P로
  // 파일을 열면 자동으로 editor로 전환됨. 명시적으로 Office 탭을 누르면 다시 office.
  const [view, setView] = useState<WorkspaceView>(() => {
    if (typeof window === "undefined") return "office";
    const raw = window.localStorage.getItem(VIEW_KEY);
    return raw === "editor" ? "editor" : "office";
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_KEY, view);
    } catch {
      // quota — 무시
    }
  }, [view]);

  // 캔버스(사무실 + 에디터)를 통째로 접어서 채팅을 메인으로 쓰는 모드. 사무실
  // 비주얼이 매력적이지만 시니어 사용자에겐 채팅이 본체 — 자기 외부 에디터 쓰는
  // 사람한테 캔버스는 화면 낭비라 사용자 선택을 영속.
  const [canvasCollapsed, setCanvasCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(CANVAS_COLLAPSED_KEY) === "1";
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(
        CANVAS_COLLAPSED_KEY,
        canvasCollapsed ? "1" : "0",
      );
    } catch {
      // ignore
    }
  }, [canvasCollapsed]);

  // 프로젝트 간 네비게이션 시 unmount 없이 재읽기.
  useEffect(() => {
    const next = readPersistedTabs(tabsKey);
    setOpenFiles(next.openFiles);
    setActiveFile(next.activeTab === "chat" ? null : next.activeTab);
    setActiveThreadId(next.activeThreadId);
  }, [tabsKey]);

  useEffect(() => {
    if (!tabsKey) return;
    try {
      window.localStorage.setItem(
        tabsKey,
        JSON.stringify({
          openFiles,
          activeTab: activeFile ?? "chat",
          activeThreadId,
        }),
      );
    } catch {
      // quota / private mode — 무시
    }
  }, [tabsKey, openFiles, activeFile, activeThreadId]);

  // 첫 로드 시 가장 최근 thread 자동 선택. 사용자가 "new thread" 클릭 후
  // null 상태인 경우는 의도적이므로 건드리지 않음.
  const [hasInitializedThread, setHasInitializedThread] = useState(false);
  useEffect(() => {
    if (hasInitializedThread) return;
    if (threadList.length === 0) return;
    if (activeThreadId === null) {
      const persisted = readPersistedTabs(tabsKey).activeThreadId;
      if (persisted === null) {
        setActiveThreadId(threadList[0]!.id);
      }
    }
    setHasInitializedThread(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadList.length]);

  const filteredRuns = useMemo(
    () =>
      activeThreadId
        ? projectRuns.filter((r) => r.threadId === activeThreadId)
        : [],
    [projectRuns, activeThreadId],
  );
  const { threads } = useRoomDerived(filteredRuns, agentList);

  // 비용 없는 run(non-claude-code 어댑터)은 합계에서 빠짐.
  const threadCost = useMemo(() => {
    let total = 0;
    let any = false;
    for (const r of filteredRuns) {
      if (typeof r.costUsd === "number") {
        total += r.costUsd;
        any = true;
      }
    }
    return any ? total : null;
  }, [filteredRuns]);

  const openFile = useCallback((path: string) => {
    setOpenFiles((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setActiveFile(path);
    // 파일을 여는 행위 자체가 "에디터로 보고 싶다"는 신호 — 명시적 전환.
    setView("editor");
  }, []);
  const closeFile = useCallback((path: string) => {
    setOpenFiles((prev) => {
      const next = prev.filter((p) => p !== path);
      setActiveFile((cur) => {
        if (cur !== path) return cur;
        return next[next.length - 1] ?? null;
      });
      // 마지막 파일을 닫으면 자동으로 Office로 — 빈 에디터 자리에 사무실이 의미 있음.
      if (next.length === 0) setView("office");
      return next;
    });
  }, []);
  const closeAllFiles = useCallback(() => {
    setOpenFiles([]);
    setActiveFile(null);
    setView("office");
  }, []);

  // composer 상태는 이 레벨에 — 파일 히스토리 → 채팅 점프 시 타깃 에이전트 스왑 + draft 표시 가능.
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<string | undefined>();
  const [draftKey, setDraftKey] = useState(0);
  useEffect(() => {
    if (agentIds.length === 0 && agentList.length) {
      setAgentIds([agentList[0]!.id]);
    }
  }, [agentList, agentIds.length]);

  // 파일 히스토리 / live activity / 사이드바에서 특정 메시지로 점프 요청 시.
  // run이 다른 thread면 먼저 thread 전환 → DOM 노드 매칭 가능.
  const [pendingJumpRunId, setPendingJumpRunId] = useState<string | null>(null);
  const handleJumpToRun = useCallback(
    (runId: string) => {
      const run = projectRuns.find((r) => r.id === runId);
      if (run && run.threadId && run.threadId !== activeThreadId) {
        setActiveThreadId(run.threadId);
      }
      setPendingJumpRunId(runId);
    },
    [projectRuns, activeThreadId],
  );

  // activity 패널들은 트리 위에 있어 이 페이지 상태에 직접 접근 불가 — typed bus로 통신.
  useLoomEvent("openFile", ({ path }) => openFile(path));
  useLoomEvent("pickThread", ({ id }) => setActiveThreadId(id));
  useLoomEvent("newThread", () => setActiveThreadId(null));
  useLoomEvent("pickAgent", ({ id }) => setAgentIds([id]));
  useLoomEvent("jumpToRun", ({ runId }) => handleJumpToRun(runId));

  const [contextOpen, setContextOpen] = useState(false);

  // 채팅 dock의 open/height/width 상태는 ChatDock 자체가 관리 (localStorage 영속).
  // 다만 placement는 외부 레이아웃(WorkspacePage)이 함께 알아야 — bottom이면 column,
  // right면 row로 flex 방향이 달라짐.
  const [dockPlacement, setDockPlacement] = useState<DockPlacement>(() =>
    readDockPlacement(),
  );

  // ⌘P → 파일 팔레트, ⌘\ → 모든 파일 닫기. 입력 중에는 무시.
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const inEditable = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      return !!(
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      );
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return;
      if (inEditable(e)) return;
      const k = e.key.toLowerCase();
      if (k === "p") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === "\\") {
        e.preventDefault();
        closeAllFiles();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeAllFiles]);

  // 이 thread에 발화한 적 있는 모든 에이전트 — 단톡방 참여자 헤더용.
  // 모든 useMemo는 early return 전에 위치해야 React 훅 순서가 안정적.
  const participantsForThread = useMemo(() => {
    const ids = new Set(filteredRuns.map((r) => r.agentId));
    return agentList.filter((a) => ids.has(a.id));
  }, [filteredRuns, agentList]);

  // ThreadList 사이드바에서 행마다 라이브 닷을 표시하기 위한 현재 active thread id 집합.
  const workingThreadIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of projectRuns) {
      if (r.status === "running" || r.status === "queued") {
        if (r.threadId) s.add(r.threadId);
      }
    }
    return s;
  }, [projectRuns]);

  // 회의실: 현재 진행 중 run 의 thread → 그 에이전트. 같은 thread 끼리 tether.
  const threadByAgent = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of projectRuns) {
      if ((r.status === "running" || r.status === "queued") && r.threadId) {
        m.set(r.agentId, r.threadId);
      }
    }
    return m;
  }, [projectRuns]);

  // 채팅 dock의 open/height 상태는 ChatDock 자체가 관리. 여기서는 unread count
  // 같은 floating-launcher 시절의 보조 상태가 더 이상 필요 없음.

  // Monaco에 넘길 multi-presence — 활성 파일에 떠있는 에이전트들을 색·이름과 함께.
  const editorPresences = useMemo(() => {
    if (!activeFile) return [];
    const raw = presencesByPath.get(activeFile) ?? [];
    return raw
      .map((it, idx) => {
        const a = agentList.find((ag) => ag.id === it.agentId);
        if (!a) return null;
        return {
          agentId: a.id,
          agentName: a.name,
          color: agentColorOf(a),
          line: it.line,
          primary: idx === 0,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [activeFile, presencesByPath, agentList]);

  // 이 시점부터는 훅 호출 없음 — early return 안전.
  if (project.isLoading || agents.isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }
  if (project.isError || !project.data) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-destructive">
        {project.error?.message ?? t("common.notFound")}
      </div>
    );
  }
  const p = project.data.project;
  const activeThread =
    threadList.find((th) => th.id === activeThreadId) ?? null;
  // Office 뷰일 땐 view === "office", editor 뷰일 땐 활성 파일 유무에 따라 FileTab/EditorEmpty.
  const showEditor =
    view === "editor" &&
    activeFile !== null &&
    openFiles.includes(activeFile);
  // 파일 탭바는 항상 표시 (Office 가짜 탭이 항상 있어서) — chat full-modal 또는
  // 캔버스 collapsed 일 때만 숨김. 캔버스가 안 보이면 탭 strip도 의미 없음.
  const showFileTabs = !chatFullModal && !canvasCollapsed;

  const newIsolatedThread = async () => {
    try {
      const r = await api.createThread({
        projectId: p.id,
        name: t("thread.isolated.defaultName"),
        isolate: true,
      });
      setActiveThreadId(r.thread.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <div className="flex h-full min-w-0 flex-col">
        {chatFullModal ? null : (
          <TeamRibbon
            project={p}
            agents={agentList}
            workingIds={workingIds}
            touchingIds={touchingIds}
            activeThread={activeThread}
          />
        )}

        {showFileTabs ? (
          <FileTabBar
            view={view}
            activeFile={activeFile}
            openFiles={openFiles}
            activeByPath={activeByPath}
            lineByPath={lineByPath}
            agents={agentList}
            onActivate={(path) => {
              setActiveFile(path);
              setView("editor");
            }}
            onClose={closeFile}
            onCloseAll={closeAllFiles}
            onSelectOffice={() => setView("office")}
            onSelectEditor={() => setView("editor")}
            onCollapseCanvas={() => setCanvasCollapsed(true)}
          />
        ) : null}

        <ActivePin
          touches={activeTouchesQuery.data?.touches ?? []}
          agents={agentList}
          onPick={openFile}
        />

        {/* 메인 영역 — 에디터 + 채팅 dock. dockPlacement에 따라 row/col 전환.
         *   bottom: 에디터 위, dock 아래 (flex-col)
         *   right : 에디터 좌, dock 우 (flex-row)
         *  좁은 / 세로가 짧은 화면에선 right가 훨씬 살림. */}
        <div
          className={cn(
            "flex-1 min-h-0 min-w-0 flex",
            dockPlacement === "bottom" ? "flex-col" : "flex-row",
          )}
        >
          {/* canvasCollapsed 시 캔버스 섹션 자체를 mount 해제 — 사무실 타이머는
              잠깐 멈췄다가 펼치면 재가동. 채팅 풀 모드 진입 시 ChatDock 이 100%
              차지하도록 의도. */}
          {!canvasCollapsed ? (
            <section className="flex-1 min-w-0 min-h-0 flex flex-col">
              {/* ProjectMap (협업 캔버스) ↔ FileTab (에디터) 모드 전환. Map 은
                  view 전환에도 mount 유지 — 트리 펼침 상태/로드된 children 유지하려고. */}
              <div
                className={cn(
                  "flex-1 min-h-0 flex flex-col",
                  view !== "office" && "hidden",
                )}
              >
                <MeetingRoom
                  projectName={p.name}
                  agents={agentList}
                  workingIds={workingIds}
                  touchingIds={touchingIds}
                  activeTouches={activeTouchesQuery.data?.touches ?? []}
                  activeTools={activeToolsQuery.data?.tools ?? []}
                  threadList={threadList}
                  workingThreadIds={workingThreadIds}
                  activeThreadId={activeThreadId}
                  threadByAgent={threadByAgent}
                  onPickFile={openFile}
                  onPickAgent={(id) => setAgentIds([id])}
                  onPickThread={(id) => setActiveThreadId(id)}
                  onRefresh={() => {
                    void runsQuery.refetch();
                    void threadsQuery.refetch();
                    void activeTouchesQuery.refetch();
                  }}
                  refreshing={
                    runsQuery.isFetching ||
                    threadsQuery.isFetching ||
                    activeTouchesQuery.isFetching
                  }
                />
              </div>
              {view === "editor" ? (
                showEditor ? (
                  <FileTab
                    projectId={p.id}
                    path={activeFile}
                    presences={editorPresences}
                    agents={agentList}
                    onJumpToRun={handleJumpToRun}
                    adapterByKind={adapterByKind}
                  />
                ) : (
                  <EditorEmpty
                    onOpenPalette={() => setPaletteOpen(true)}
                    onSwitchToOffice={() => setView("office")}
                    hint={t("workspace.empty.hint")}
                  />
                )
              ) : null}
            </section>
          ) : null}

          {!chatFullModal ? (
            <ChatDock
              title={
                p
                  ? `# ${p.name}`
                  : (activeThread?.name ?? t("chat.overlay.title"))
              }
              placement={dockPlacement}
              onPlacementChange={setDockPlacement}
              fullSize={canvasCollapsed}
              onShowCanvas={
                canvasCollapsed ? () => setCanvasCollapsed(false) : undefined
              }
            >
              {/* dock 본문 = [좌측 ThreadList | 우측 ThreadBar + ChatPanel].
                  VSCode 터미널의 세션 사이드바와 동일한 컨셉. */}
              <div className="flex flex-1 min-h-0 min-w-0">
                <ThreadList
                  projectId={p.id}
                  threads={threadList}
                  activeThread={activeThread}
                  workingThreadIds={workingThreadIds}
                  compact={dockPlacement === "right"}
                  onPick={(id) => setActiveThreadId(id)}
                  onNewThread={() => setActiveThreadId(null)}
                  onNewIsolatedThread={newIsolatedThread}
                />
                <div className="flex-1 min-w-0 min-h-0 flex flex-col">
                  <ThreadBar
                    activeThread={activeThread}
                    activeThreadCost={threadCost}
                    participants={participantsForThread}
                    workingIds={workingIds}
                    touchingIds={touchingIds}
                    fullModal={chatFullModal}
                    onToggleFullModal={() => setChatFullModal(!chatFullModal)}
                    onOpenContext={() => setContextOpen(true)}
                  />
                  <ChatPanel
                    project={p}
                    agentList={agentList}
                    manifests={manifests}
                    threads={threads}
                    working={working}
                    activeThreadId={activeThreadId}
                    threadHasContext={!!activeThread?.contextBundle}
                    onAdoptThreadId={setActiveThreadId}
                    agentIds={agentIds}
                    setAgentIds={setAgentIds}
                    draft={draft}
                    setDraft={setDraft}
                    draftKey={draftKey}
                    setDraftKey={setDraftKey}
                    pendingJumpRunId={pendingJumpRunId}
                    onConsumedJump={() => setPendingJumpRunId(null)}
                  />
                </div>
              </div>
            </ChatDock>
          ) : null}
        </div>
      </div>

      <FilePalette
        projectId={p.id}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onPickFile={openFile}
      />

      <ContextDrawer
        open={contextOpen}
        thread={activeThread}
        onClose={() => setContextOpen(false)}
      />
    </>
  );
}

function EditorEmpty({
  hint,
  onOpenPalette,
  onSwitchToOffice,
}: {
  hint: string;
  onOpenPalette: () => void;
  onSwitchToOffice: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
      <p className="text-sm text-muted-foreground/70 max-w-md">{hint}</p>
      <div className="flex items-center gap-2 mono text-[11px] text-muted-foreground/60">
        <button
          type="button"
          onClick={onOpenPalette}
          className="px-2 h-7 rounded border border-border hover:bg-muted hover:border-foreground/30 transition-colors"
        >
          ⌘P · {t("workspace.empty.openFile")}
        </button>
        <button
          type="button"
          onClick={onSwitchToOffice}
          className="px-2 h-7 rounded border border-border hover:bg-muted hover:border-foreground/30 transition-colors"
        >
          👥 {t("workspace.empty.openRoom")}
        </button>
      </div>
    </div>
  );
}
