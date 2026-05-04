// 사이드 패널 — 시스템 레벨 MCP 서버 카탈로그. 에이전트가 자기 폼에서
// 일부를 선택해 호출 권한을 가져감.

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { api } from "../../api/client.js";
import { Button } from "../ui/button.js";
import { useI18n } from "../../context/I18nContext.js";
import { useAutoAnimate } from "../../lib/useAutoAnimate.js";
import { ListSkeleton, ManageFooter, PanelHeader } from "./shared.js";

export function McpsTab() {
  const { t } = useI18n();
  const servers = useQuery({
    queryKey: ["mcp-servers"],
    queryFn: api.listMcpServers,
  });
  const listRef = useAutoAnimate<HTMLUListElement>();

  const list = servers.data?.servers ?? [];
  return (
    <>
      <PanelHeader
        title={t("activity.mcps")}
        action={
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="size-5 text-muted-foreground hover:text-foreground"
            title={t("mcps.new")}
          >
            <Link to="/mcps/new" aria-label={t("mcps.new")}>
              <Plus className="size-3.5" />
            </Link>
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto subtle-scrollbar py-1 min-h-0">
        {servers.isLoading ? (
          <ListSkeleton rows={4} withAvatar={false} />
        ) : list.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground/70 italic">
            {t("activity.mcps.empty")}
          </p>
        ) : (
          <ul ref={listRef} className="space-y-px">
            {list.map((s) => (
              <li key={s.id}>
                <Link
                  to={`/mcps/${s.id}`}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50 transition-colors"
                  title={s.name}
                >
                  <span className="size-1.5 shrink-0 rounded-full bg-violet-500/60" />
                  <span className="text-sm truncate flex-1">{s.name}</span>
                  <span className="text-[10px] text-muted-foreground/60 mono shrink-0">
                    {s.kind}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ManageFooter to="/mcps" label={t("activity.manage")} />
    </>
  );
}
