// 사이드 패널 — 프로젝트 목록 + 활성 프로젝트 파일 트리.
//
// 두 개의 별도 사이드 탭(프로젝트 / 파일)을 하나로 합침. 프로젝트는 보통 동시에
// 1개만 작업하므로 "프로젝트 스위처는 작게 위에, 파일 트리는 그 아래 크게" 가
// 자연스럽다. 프로젝트 밖 라우트(/projects)에선 file tree 자리에 빈 안내.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, useParams } from "react-router-dom";
import { ChevronDown, ChevronRight, Folder, Plus } from "lucide-react";
import type { Project } from "@loom/core";
import { api } from "../../api/client.js";
import { Button } from "../ui/button.js";
import { FilesTree } from "../FilesTree.js";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";
import { useAutoAnimate } from "../../lib/useAutoAnimate.js";
import { emit } from "../../lib/loomEvents.js";
import { PanelHeader } from "./shared.js";

export function ProjectsTab() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
  });
  const list = projects.data?.projects ?? [];
  const activeProject = projectId
    ? list.find((p) => p.id === projectId)
    : undefined;

  return (
    <>
      <PanelHeader
        title={t("activity.projects")}
        action={
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="size-5 text-muted-foreground hover:text-foreground"
            title={t("sidebar.projects.new")}
          >
            <NavLink to="/projects" aria-label={t("sidebar.projects.new")}>
              <Plus className="size-3.5" />
            </NavLink>
          </Button>
        }
      />
      <div className="flex-1 min-h-0 flex flex-col">
        {/* 프로젝트 스위처 — 활성 프로젝트가 있을 땐 collapsible로 접혀
         *  있다가 열어서 다른 프로젝트로 전환. 프로젝트 밖이면 풀 리스트
         *  로 펼쳐서 첫 진입을 쉽게. */}
        <ProjectSwitcher
          list={list}
          activeProject={activeProject ?? null}
          empty={
            <p className="px-2 text-xs text-muted-foreground/70 italic">
              {t("sidebar.projects.empty")}
            </p>
          }
        />

        {/* 활성 프로젝트의 파일 트리. 프로젝트 밖이면 안내. */}
        {projectId ? (
          <FilesSection projectId={projectId} />
        ) : (
          <div className="flex-1 flex items-center justify-center px-4 text-center">
            <p className="text-xs text-muted-foreground/70 italic">
              {t("activity.projects.pickFirst")}
            </p>
          </div>
        )}
      </div>
    </>
  );
}

// 활성 프로젝트가 있을 때는 헤더 한 줄(프로젝트명 + chevron)만 보이다가
// 클릭하면 풀 리스트 펼침. 활성이 없으면 처음부터 풀 리스트.
function ProjectSwitcher({
  list,
  activeProject,
  empty,
}: {
  list: Project[];
  activeProject: Project | null;
  empty: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(!activeProject);
  const listRef = useAutoAnimate<HTMLUListElement>();
  const showList = expanded || !activeProject;

  return (
    <div className="shrink-0 border-b border-border/60">
      {activeProject ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="size-3 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="size-3 text-muted-foreground shrink-0" />
          )}
          <Folder className="size-3.5 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate flex-1">
            {activeProject.name}
          </span>
          <span className="text-[10px] text-muted-foreground/70 mono shrink-0">
            {list.length}
          </span>
        </button>
      ) : null}
      {showList ? (
        <div className="px-2 py-1.5">
          {list.length === 0 ? (
            empty
          ) : (
            <ul ref={listRef} className="space-y-0.5">
              {list.map((p) => (
                <li key={p.id}>
                  <NavLink
                    to={`/projects/${p.id}`}
                    end={false}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center rounded-md px-2 py-1.5 text-sm transition-colors",
                        isActive
                          ? "bg-foreground text-background font-medium"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )
                    }
                  >
                    <span className="truncate">{p.name}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

// 파일 트리 영역 — 활성 프로젝트의 파일 + 라이브 편집 표시. 이전 FilesTab 본체.
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
  // 활성 편집은 과거 터치를 덮어씀 — 지금 편집 중인 사람이 도트 주인.
  const activeByPath = new Map<string, string>();
  for (const tch of activeTouches.data?.touches ?? []) {
    for (const p of tch.paths) {
      activeByPath.set(p, tch.agentId);
      touchedByAgent.set(p, tch.agentId);
    }
  }

  return (
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
  );
}
