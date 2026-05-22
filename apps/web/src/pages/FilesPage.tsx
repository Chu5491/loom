// 파일 전용 메인 뷰 — /projects/:id/files.
// 사이드바 Files 클릭 시 메인 영역을 독점. 열린 파일이 없으면 안내 메시지.
// openFile / viewFile 이벤트는 ProjectShell이 이 라우트로 navigate 시켜주므로
// 여기선 search param(?path=...)만 읽어서 렌더.

import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { Files, X } from "lucide-react";
import type { AdapterManifest } from "@loom/core";
import type { LayoutOutletContext } from "../components/Layout.js";
import { api } from "../api/client.js";
import { FileTab } from "../components/FileTab.js";
import type { AgentPresence } from "../components/MonacoView.js";
import { TeamRibbon } from "../components/TeamRibbon.js";
import { agentColorOf } from "../components/agentColor.js";
import { useI18n } from "../context/I18nContext.js";

export function FilesPage() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();
  useOutletContext<LayoutOutletContext>();

  const [searchParams, setSearchParams] = useSearchParams();
  const viewingFile = searchParams.get("path");

  const closeFile = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

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
  const agentList = agents.data?.agents ?? [];
  const manifests = adapters.data?.adapters ?? [];

  const activeTouchesQuery = useQuery({
    queryKey: ["projectActiveTouches", projectId],
    queryFn: () => api.getProjectActiveTouches(projectId!),
    enabled: !!projectId,
    refetchInterval: 1500,
  });

  const touchingIds = useMemo(() => {
    const s = new Set<string>();
    for (const tch of activeTouchesQuery.data?.touches ?? []) {
      s.add(tch.agentId);
    }
    return s;
  }, [activeTouchesQuery.data]);

  const projectAgentIds = useMemo(
    () => new Set(agentList.map((a) => a.id)),
    [agentList],
  );
  const runsQuery = useQuery({
    queryKey: ["runs", { projectId }],
    queryFn: () => api.listRuns({ limit: 100 }),
    enabled: !!projectId,
  });
  const projectRuns = useMemo(
    () => (runsQuery.data?.runs ?? []).filter((r) => projectAgentIds.has(r.agentId)),
    [runsQuery.data, projectAgentIds],
  );
  const workingIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of projectRuns) {
      if (r.status === "running" || r.status === "queued") s.add(r.agentId);
    }
    return s;
  }, [projectRuns]);

  const threadsQuery = useQuery({
    queryKey: ["threads", { projectId }],
    queryFn: () => api.listThreads({ projectId }),
    enabled: !!projectId,
  });
  const threadList = threadsQuery.data?.threads ?? [];

  const adapterByKind = useMemo(() => {
    const m: Record<string, AdapterManifest> = {};
    for (const a of manifests) m[a.kind] = a;
    return m;
  }, [manifests]);

  const filePresences = useMemo<AgentPresence[]>(() => {
    if (!viewingFile) return [];
    const touches = activeTouchesQuery.data?.touches ?? [];
    const out: AgentPresence[] = [];
    for (const tch of touches) {
      if (!tch.paths.includes(viewingFile)) continue;
      const agent = agentList.find((a) => a.id === tch.agentId);
      if (!agent) continue;
      const loc = tch.locations.find((l) => l.path === viewingFile);
      out.push({
        agentId: agent.id,
        agentName: agent.name,
        color: agentColorOf(agent),
        line: loc?.line ?? 1,
        primary: out.length === 0,
      });
    }
    return out;
  }, [viewingFile, activeTouchesQuery.data, agentList]);

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

      {viewingFile ? (
        <div className="flex-1 min-h-0 min-w-0 flex flex-col">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/20 shrink-0">
            <button
              type="button"
              onClick={closeFile}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="size-3" />
              <span>{t("workspace.tab.close")}</span>
            </button>
            <span className="text-[10px] text-muted-foreground/50 mono truncate">
              {viewingFile}
            </span>
          </div>
          <FileTab
            projectId={projectId!}
            path={viewingFile}
            presences={filePresences}
            agents={agentList}
            onJumpToRun={() => {}}
            adapterByKind={adapterByKind}
          />
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground/60">
          <Files className="size-10 stroke-[1.2]" />
          <p className="text-sm">{t("files.empty.pickAFile")}</p>
        </div>
      )}
    </div>
  );
}
