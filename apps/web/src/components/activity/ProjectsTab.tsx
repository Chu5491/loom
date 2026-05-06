// 사이드 패널 — 프로젝트 목록 (main mode 전용).
//
// 메뉴 트리를 main / project 로 분리하면서 이 탭은 "프로젝트 카탈로그" 역할만 함.
// 프로젝트 스위처와 파일 트리는 각각 ActivityBar 의 chip 드롭다운 / FilesTab 으로
// 분리됐다. 여기선 lobby 에서 프로젝트를 고르거나 새로 만드는 게 전부.

import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { Plus } from "lucide-react";
import { api } from "../../api/client.js";
import { Button } from "../ui/button.js";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";
import { useAutoAnimate } from "../../lib/useAutoAnimate.js";
import { PanelHeader } from "./shared.js";

export function ProjectsTab() {
  const { t } = useI18n();
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
  });
  const list = projects.data?.projects ?? [];
  const listRef = useAutoAnimate<HTMLUListElement>();

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
      <div className="flex-1 min-h-0 flex flex-col px-2 py-1.5">
        {list.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground/70 italic">
            {t("sidebar.projects.empty")}
          </p>
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
    </>
  );
}
