// 사이드 패널 — 활성 프로젝트의 파일 트리. 프로젝트 모드 전용 탭.
//
// 이전에는 ProjectsTab 한 곳에 "프로젝트 스위처 + 파일 트리" 가 같이 있었지만
// 메뉴 트리가 main / project 로 분리되면서 파일 트리는 자기 탭으로 독립.
// 프로젝트 스위처는 ActivityBar 의 chip 드롭다운이 담당.

import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { api } from "../../api/client.js";
import { FilesTree } from "../FilesTree.js";
import { useI18n } from "../../context/I18nContext.js";
import { emit } from "../../lib/loomEvents.js";
import { PanelHeader } from "./shared.js";

export function FilesTab() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();

  if (!projectId) {
    return (
      <>
        <PanelHeader title={t("activity.files")} />
        <div className="flex-1 flex items-center justify-center px-4 text-center">
          <p className="text-xs text-muted-foreground/70 italic">
            {t("activity.projects.pickFirst")}
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <PanelHeader title={t("activity.files")} />
      <FilesSection projectId={projectId} />
    </>
  );
}

function FilesSection({ projectId }: { projectId: string }) {
  const touched = useQuery({
    queryKey: ["projectTouched", projectId],
    queryFn: () => api.getProjectTouched(projectId),
  });
  const agents = useQuery({
    queryKey: ["agents", { projectId }],
    queryFn: () => api.listAgents({ projectId }),
  });
  const activeTouches = useQuery({
    queryKey: ["projectActiveTouches", projectId],
    queryFn: () => api.getProjectActiveTouches(projectId),
    refetchInterval: 1500,
  });

  const touchedByAgent = new Map<string, string>(
    (touched.data?.paths ?? []).map((p) => [p.path, p.lastAgentId]),
  );
  const changesByPath = new Map<
    string,
    { additions: number; deletions: number }
  >(
    (touched.data?.paths ?? [])
      .filter((p) => p.totalAdditions > 0 || p.totalDeletions > 0)
      .map((p) => [
        p.path,
        { additions: p.totalAdditions, deletions: p.totalDeletions },
      ]),
  );
  // 활성 편집이 과거 터치를 덮어씀 — 지금 편집 중인 사람이 도트 주인.
  const activeByPath = new Map<string, string>();
  const lineByPath = new Map<string, number>();
  for (const tch of activeTouches.data?.touches ?? []) {
    for (const p of tch.paths) {
      activeByPath.set(p, tch.agentId);
      touchedByAgent.set(p, tch.agentId);
    }
    for (const loc of tch.locations) {
      lineByPath.set(loc.path, loc.line);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden subtle-scrollbar">
      <FilesTree
        projectId={projectId}
        selectedPath={null}
        touched={touchedByAgent}
        activeByAgent={activeByPath}
        lineByPath={lineByPath}
        changesByPath={changesByPath}
        agents={agents.data?.agents ?? []}
        onPick={(path) => emit("viewFile", { path })}
      />
    </div>
  );
}
