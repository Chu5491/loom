// 프로젝트 워크스페이스. 채널 배너 + 중앙 채팅 + 우측 파일 뷰어 패널.
// 채팅의 파일 알약을 클릭하면 우측에 탭으로 열림. 파일 history rail에서
// run을 클릭하면 채팅의 해당 메시지로 점프.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOutletContext, useParams } from "react-router-dom";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { toast } from "sonner";
import type { AdapterManifest } from "@loom/core";
import type { LayoutOutletContext } from "../components/Layout.js";
import { api } from "../api/client.js";
import { TooltipProvider, useRoomDerived } from "../components/Chat.js";
import { ContextDrawer } from "../components/ContextDrawer.js";
import { FilePalette } from "../components/FilePalette.js";
import { FileTab } from "../components/FileTab.js";
import { LiveActivityRail } from "../components/LiveActivityRail.js";
import { TeamRibbon } from "../components/TeamRibbon.js";
import { useI18n } from "../context/I18nContext.js";
import { useLoomEvent } from "../lib/loomEvents.js";
import { ChatPanel } from "./workspace/ChatPanel.js";
import { FileTabBar } from "./workspace/FileTabBar.js";
import { ThreadBar } from "./workspace/ThreadBar.js";
import { readPersistedTabs } from "./workspace/persistence.js";

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
  }, []);
  const closeFile = useCallback((path: string) => {
    setOpenFiles((prev) => {
      const next = prev.filter((p) => p !== path);
      setActiveFile((cur) => {
        if (cur !== path) return cur;
        return next[next.length - 1] ?? null;
      });
      return next;
    });
  }, []);
  const closeAllFiles = useCallback(() => {
    setOpenFiles([]);
    setActiveFile(null);
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

  // 파일이 하나라도 열려 있고 focus mode가 아닐 때만 우측 뷰어 패널 노출.
  const fileViewerVisible = openFiles.length > 0 && !chatFullModal;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full min-w-0 flex-col">
        {chatFullModal ? null : (
          <TeamRibbon
            project={p}
            agents={agentList}
            workingIds={workingIds}
            activeThread={activeThread}
          />
        )}

        <div className="flex-1 min-h-0 min-w-0 flex">
          {fileViewerVisible ? (
            // 파일 뷰어가 열린 경우: react-resizable-panels로 가로 분할.
            // 키보드 접근성·스냅·리사이즈 핸들 hover 효과는 라이브러리가 무료 제공.
            <PanelGroup
              direction="horizontal"
              autoSaveId={`loom:workspace:${p.id}:split`}
              className="flex-1 min-w-0"
            >
              <Panel defaultSize={62} minSize={30}>
                <section className="h-full min-w-0 flex flex-col bg-card">
                  <ThreadBar
                    projectId={p.id}
                    threads={threadList}
                    activeThread={activeThread}
                    activeThreadCost={threadCost}
                    fullModal={chatFullModal}
                    onToggleFullModal={() => setChatFullModal(!chatFullModal)}
                    onOpenContext={() => setContextOpen(true)}
                    onPickThread={(id) => setActiveThreadId(id)}
                    onNewThread={() => setActiveThreadId(null)}
                    onNewIsolatedThread={async () => {
                      try {
                        const r = await api.createThread({
                          projectId: p.id,
                          name: t("thread.isolated.defaultName"),
                          isolate: true,
                        });
                        setActiveThreadId(r.thread.id);
                      } catch (err) {
                        toast.error(
                          err instanceof Error ? err.message : String(err),
                        );
                      }
                    }}
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
                </section>
              </Panel>
              <PanelResizeHandle className="w-px bg-border data-[resize-handle-state=hover]:bg-foreground/25 data-[resize-handle-state=drag]:bg-foreground/40 transition-colors" />
              <Panel
                defaultSize={38}
                minSize={20}
                maxSize={70}
                className="hidden lg:flex"
              >
                <aside className="flex h-full w-full flex-col border-l border-border bg-background">
                  <FileTabBar
                    activeFile={activeFile}
                    openFiles={openFiles}
                    activeByPath={activeByPath}
                    lineByPath={lineByPath}
                    agents={agentList}
                    onActivate={(path) => setActiveFile(path)}
                    onClose={closeFile}
                    onCloseAll={closeAllFiles}
                  />
                  <div className="flex-1 min-h-0 flex flex-col">
                    {activeFile && openFiles.includes(activeFile) ? (
                      <FileTab
                        projectId={p.id}
                        path={activeFile}
                        activeAgentId={activeByPath.get(activeFile)}
                        activeLine={lineByPath.get(activeFile)}
                        agents={agentList}
                        onJumpToRun={handleJumpToRun}
                        adapterByKind={adapterByKind}
                      />
                    ) : null}
                  </div>
                </aside>
              </Panel>
            </PanelGroup>
          ) : (
            // 파일 뷰어 닫힘: 채팅 풀폭 + 우측에 좁은 활동 레일.
            <>
              <section className="flex-1 min-w-0 flex flex-col bg-card">
                <ThreadBar
                  projectId={p.id}
                  threads={threadList}
                  activeThread={activeThread}
                  activeThreadCost={threadCost}
                  fullModal={chatFullModal}
                  onToggleFullModal={() => setChatFullModal(!chatFullModal)}
                  onOpenContext={() => setContextOpen(true)}
                  onPickThread={(id) => setActiveThreadId(id)}
                  onNewThread={() => setActiveThreadId(null)}
                  onNewIsolatedThread={async () => {
                    try {
                      const r = await api.createThread({
                        projectId: p.id,
                        name: t("thread.isolated.defaultName"),
                        isolate: true,
                      });
                      setActiveThreadId(r.thread.id);
                    } catch (err) {
                      toast.error(
                        err instanceof Error ? err.message : String(err),
                      );
                    }
                  }}
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
              </section>
              {!chatFullModal ? (
                <LiveActivityRail
                  agents={agentList}
                  manifests={manifests}
                  runs={projectRuns}
                />
              ) : null}
            </>
          )}
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
    </TooltipProvider>
  );
}
