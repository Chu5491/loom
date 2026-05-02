// 사이드 패널 — 프로젝트 파일 트리. 라이브 편집 도트 표시.

import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { api } from "../../api/client.js";
import { FilesTree } from "../FilesTree.js";
import { useI18n } from "../../context/I18nContext.js";
import { emit } from "../../lib/loomEvents.js";
import { NoProjectState, PanelHeader } from "./shared.js";

export function FilesTab() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();
  const touched = useQuery({
    queryKey: ["projectTouched", projectId],
    queryFn: () => api.getProjectTouched(projectId!),
    enabled: !!projectId,
  });
  const agents = useQuery({
    queryKey: ["agents", { projectId }],
    queryFn: () => api.listAgents({ projectId }),
    enabled: !!projectId,
  });
  // 라이브 "에이전트 편집 중" 맵. 패널 열린 동안 빠른 폴링 → 트리가 거의 실시간으로 박동.
  const activeTouches = useQuery({
    queryKey: ["projectActiveTouches", projectId],
    queryFn: () => api.getProjectActiveTouches(projectId!),
    enabled: !!projectId,
    refetchInterval: 1500,
  });
  const touchedByAgent = new Map<string, string>(
    (touched.data?.paths ?? []).map((p) => [p.path, p.lastAgentId]),
  );
  // 활성 편집은 과거 터치를 덮어씀 — 지금 편집 중인 사람이 도트 주인.
  const activeByPath = new Map<string, string>();
  for (const tch of activeTouches.data?.touches ?? []) {
    for (const p of tch.paths) {
      activeByPath.set(p, tch.agentId);
      touchedByAgent.set(p, tch.agentId);
    }
  }

  if (!projectId) {
    return (
      <>
        <PanelHeader title={t("activity.files")} />
        <NoProjectState message={t("activity.requiresProject")} />
      </>
    );
  }
  return (
    <>
      <PanelHeader title={t("activity.files")} />
      <div className="flex-1 overflow-y-auto overflow-x-hidden subtle-scrollbar">
        <FilesTree
          projectId={projectId}
          selectedPath={null}
          touched={touchedByAgent}
          activeByAgent={activeByPath}
          agents={agents.data?.agents ?? []}
          onPick={(path) => emit("openFile", { path })}
        />
      </div>
    </>
  );
}
