// 사이드 패널 — 첨부 가능한 스킬(마크다운) 목록.

import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { api } from "../../api/client.js";
import { Button } from "../ui/button.js";
import { useI18n } from "../../context/I18nContext.js";
import { useAutoAnimate } from "../../lib/useAutoAnimate.js";
import { ListSkeleton, ManageFooter, NoProjectState, PanelHeader } from "./shared.js";

export function SkillsTab() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();
  const specs = useQuery({
    queryKey: ["specs"],
    queryFn: () => api.listSpecs(),
    enabled: !!projectId,
  });
  const listRef = useAutoAnimate<HTMLUListElement>();

  if (!projectId) {
    return (
      <>
        <PanelHeader title={t("activity.skills")} />
        <NoProjectState message={t("activity.requiresProject")} />
      </>
    );
  }

  const list = specs.data?.specs ?? [];
  return (
    <>
      <PanelHeader
        title={t("activity.skills")}
        action={
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="size-5 text-muted-foreground hover:text-foreground"
            title={t("specs.new")}
          >
            <Link
              to={`/projects/${projectId}/skills/new`}
              aria-label={t("specs.new")}
            >
              <Plus className="size-3.5" />
            </Link>
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto subtle-scrollbar py-1 min-h-0">
        {specs.isLoading ? (
          <ListSkeleton rows={4} withAvatar={false} />
        ) : list.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground/70 italic">
            {t("activity.skills.empty")}
          </p>
        ) : (
          <ul ref={listRef} className="space-y-px">
            {list.map((s) => (
              <li key={s.id}>
                <Link
                  to={`/projects/${projectId}/skills/${s.id}`}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50 transition-colors"
                  title={s.name}
                >
                  <span className="size-1.5 shrink-0 rounded-full bg-foreground/30" />
                  <span className="text-sm truncate flex-1">{s.name}</span>
                  <span className="text-[10px] text-muted-foreground/60 mono shrink-0">
                    {(s.content.length / 1024).toFixed(1)}k
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ManageFooter
        to={`/projects/${projectId}/skills`}
        label={t("activity.manage")}
      />
    </>
  );
}
