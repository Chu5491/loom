// 프로젝트 대시보드 — 에이전트 현황, 활동 스트림, Git 요약, 실행 기록.
// 채팅은 WorkspacePage(index)에서 전담.

import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOutletContext, useParams } from "react-router-dom";
import { toast } from "sonner";
import type { AdapterManifest } from "@loom/core";
import type { LayoutOutletContext } from "../components/Layout.js";
import { api } from "../api/client.js";
import { useConfirm } from "../components/ConfirmDialog.js";
import { useRoomDerived } from "../components/chat/index.js";
import { TeamRibbon } from "../components/TeamRibbon.js";
import { useI18n } from "../context/I18nContext.js";
import { emit } from "../lib/loomEvents.js";
import { ActivePin } from "./workspace/ActivePin.js";
import { LiveView } from "./workspace/LiveView.js";

export function DashboardPage() {
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
  const activeToolsQuery = useQuery({
    queryKey: ["projectActiveTools", projectId],
    queryFn: () => api.getProjectActiveTools(projectId!),
    enabled: !!projectId,
    refetchInterval: 1500,
  });
  const activeDelegationsQuery = useQuery({
    queryKey: ["projectActiveDelegations", projectId],
    queryFn: () => api.getProjectActiveDelegations(projectId!),
    enabled: !!projectId,
    refetchInterval: 2000,
  });

  const touchingIds = useMemo(() => {
    const s = new Set<string>();
    for (const tch of activeTouchesQuery.data?.touches ?? []) {
      s.add(tch.agentId);
    }
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
  const adapterByKind = useMemo(() => {
    const map: Record<string, AdapterManifest> = {};
    for (const m of manifests) map[m.kind] = m;
    return map;
  }, [manifests]);

  const { workingIds } = useRoomDerived(projectRuns, agentList);

  const workingThreadIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of projectRuns) {
      if (r.status === "running" || r.status === "queued") {
        if (r.threadId) s.add(r.threadId);
      }
    }
    return s;
  }, [projectRuns]);

  const threadByAgent = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of projectRuns) {
      if ((r.status === "running" || r.status === "queued") && r.threadId) {
        m.set(r.agentId, r.threadId);
      }
    }
    return m;
  }, [projectRuns]);

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


  // ── Early returns
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

  return (
    <div className="flex h-full min-w-0 flex-col">
      <TeamRibbon
        project={p}
        agents={agentList}
        workingIds={workingIds}
        touchingIds={touchingIds}
        activeThread={null}
        threadList={threadList}
      />

      <ActivePin
        touches={activeTouchesQuery.data?.touches ?? []}
        agents={agentList}
        onPick={openFileExternal}
      />

      <section className="flex-1 min-w-0 min-h-0 flex flex-col">
        <LiveView
          agents={agentList}
          runs={projectRuns}
          workingIds={workingIds}
          touchingIds={touchingIds}
          activeTouches={activeTouchesQuery.data?.touches ?? []}
          activeTools={activeToolsQuery.data?.tools ?? []}
          delegations={activeDelegationsQuery.data?.delegations ?? []}
          threadList={threadList}
          workingThreadIds={workingThreadIds}
          activeThreadId={null}
          threadByAgent={threadByAgent}
          adapterByKind={adapterByKind}
          onPickFile={(path) => emit("viewFile", { path })}
          onPickAgent={() => {}}
          onPickThread={() => {}}
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
      </section>
    </div>
  );
}
