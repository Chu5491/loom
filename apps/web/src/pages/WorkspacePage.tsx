// 프로젝트 워크스페이스 — 채팅 중심. 사이드바 파일 클릭 시 메인 영역에 파일 뷰어 표시.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOutletContext, useParams } from "react-router-dom";
import { toast } from "sonner";
import type { LayoutOutletContext } from "../components/Layout.js";
import { api } from "../api/client.js";
import { useConfirm } from "../components/ConfirmDialog.js";
import { useRoomDerived } from "../components/chat/index.js";
import { ContextDrawer } from "../components/ContextDrawer.js";
import { TeamRibbon } from "../components/TeamRibbon.js";
import { useI18n } from "../context/I18nContext.js";
import { useLoomEvent } from "../lib/loomEvents.js";
import { ActivePin } from "./workspace/ActivePin.js";
import { ChatPanel } from "./workspace/ChatPanel.js";
import { ThreadBar } from "./workspace/ThreadBar.js";
import { readPersistedState } from "./workspace/persistence.js";

const STATE_KEY_PREFIX = "loom:workspace:";

export function WorkspacePage() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const { id: projectId } = useParams<{ id: string }>();
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

  const activeTouchesQuery = useQuery({
    queryKey: ["projectActiveTouches", projectId],
    queryFn: () => api.getProjectActiveTouches(projectId!),
    enabled: !!projectId,
    refetchInterval: 1500,
  });
  const touchingIds = useMemo(() => {
    const s = new Set<string>();
    for (const tch of activeTouchesQuery.data?.touches ?? []) s.add(tch.agentId);
    return s;
  }, [activeTouchesQuery.data]);

  const threadsQuery = useQuery({
    queryKey: ["threads", { projectId }],
    queryFn: () => api.listThreads({ projectId }),
    enabled: !!projectId,
    refetchInterval: () => {
      const active = runsQuery.data?.runs.some(
        (r) => r.status === "queued" || r.status === "running",
      );
      return active ? 3000 : 30_000;
    },
  });
  const threadList = threadsQuery.data?.threads ?? [];

  const agentList = agents.data?.agents ?? [];
  const manifests = adapters.data?.adapters ?? [];
  const { working, workingIds } = useRoomDerived(projectRuns, agentList);

  // ── Thread state
  const stateKey = projectId ? `${STATE_KEY_PREFIX}${projectId}:tabs` : null;
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    () => readPersistedState(stateKey).activeThreadId,
  );

  useEffect(() => {
    setActiveThreadId(readPersistedState(stateKey).activeThreadId);
  }, [stateKey]);

  useEffect(() => {
    if (!stateKey) return;
    try {
      window.localStorage.setItem(
        stateKey,
        JSON.stringify({ activeThreadId }),
      );
    } catch {
      // quota
    }
  }, [stateKey, activeThreadId]);

  const [hasInitializedThread, setHasInitializedThread] = useState(false);
  useEffect(() => {
    if (hasInitializedThread) return;
    if (threadList.length === 0) return;
    if (activeThreadId === null) {
      const persisted = readPersistedState(stateKey).activeThreadId;
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

  const threadTokens = useMemo(() => {
    let input = 0, output = 0, cacheRead = 0, cacheWrite = 0;
    let any = false;
    for (const r of filteredRuns) {
      if (typeof r.inputTokens === "number") { input += r.inputTokens; any = true; }
      if (typeof r.outputTokens === "number") output += r.outputTokens;
      if (typeof r.cacheReadTokens === "number") cacheRead += r.cacheReadTokens;
      if (typeof r.cacheWriteTokens === "number") cacheWrite += r.cacheWriteTokens;
    }
    return any ? { input, output, cacheRead, cacheWrite } : null;
  }, [filteredRuns]);

  const openFileExternal = useCallback(
    async (path: string) => {
      if (!projectId) return;
      const ok = await confirm({
        title: t("file.openConfirm.title"),
        description: t("file.openConfirm.desc", { path: path.split("/").pop() ?? path }),
        confirmLabel: t("file.openConfirm.open"),
      });
      if (!ok) return;
      api.openInEditor(projectId, { path }).catch((err) => {
        toast.error(err instanceof Error ? err.message : String(err));
      });
    },
    [projectId, confirm, t],
  );

  // ── Composer state
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<string | undefined>();
  const [draftKey, setDraftKey] = useState(0);
  useEffect(() => {
    if (agentIds.length === 0 && agentList.length) {
      setAgentIds([agentList[0]!.id]);
    }
  }, [agentList, agentIds.length]);

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

  useLoomEvent("pickThread", ({ id }) => setActiveThreadId(id));
  useLoomEvent("newThread", () => setActiveThreadId(null));
  useLoomEvent("pickAgent", ({ id }) => setAgentIds([id]));
  useLoomEvent("jumpToRun", ({ runId }) => handleJumpToRun(runId));

  const [contextOpen, setContextOpen] = useState(false);

  // ── Derived
  const participantsForThread = useMemo(() => {
    const ids = new Set(filteredRuns.map((r) => r.agentId));
    return agentList.filter((a) => ids.has(a.id));
  }, [filteredRuns, agentList]);

  // ── Early returns (hooks 다 끝난 뒤)
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

  return (
    <>
      <div className="flex h-full min-w-0 flex-col">
        <TeamRibbon
          project={p}
          agents={agentList}
          workingIds={workingIds}
          touchingIds={touchingIds}
          activeThread={activeThread}
          threadList={threadList}
        />

        <ActivePin
          touches={activeTouchesQuery.data?.touches ?? []}
          agents={agentList}
          onPick={openFileExternal}
        />

        <div className="flex-1 min-h-0 min-w-0 flex flex-col">
          <ThreadBar
            activeThread={activeThread}
            activeThreadCost={threadCost}
            activeThreadTokens={threadTokens}
            participants={participantsForThread}
            workingIds={workingIds}
            touchingIds={touchingIds}
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

      <ContextDrawer
        open={contextOpen}
        thread={activeThread}
        onClose={() => setContextOpen(false)}
      />
    </>
  );
}
