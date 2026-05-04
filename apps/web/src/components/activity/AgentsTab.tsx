// 사이드 패널 — 프로젝트 에이전트 목록 + 라이브 working 표시.

import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Plus } from "lucide-react";
import type { Run } from "@loom/core";
import { api } from "../../api/client.js";
import { AgentAvatar } from "../chat/index.js";
import { Button } from "../ui/button.js";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";
import { elapsedSecs } from "../../lib/runStatus.js";
import { useAutoAnimate } from "../../lib/useAutoAnimate.js";
import { agentColorOf, classesFor } from "../agentColor.js";
import { ListSkeleton, ManageFooter, NoProjectState, PanelHeader } from "./shared.js";

export function AgentsTab() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();
  const agents = useQuery({
    queryKey: ["agents", { projectId }],
    queryFn: () => api.listAgents({ projectId }),
    enabled: !!projectId,
  });
  const adapters = useQuery({
    queryKey: ["adapters"],
    queryFn: api.listAdapters,
  });
  const runs = useQuery({
    queryKey: ["runs", { projectId, panel: "agents" }],
    queryFn: () => api.listRuns({ limit: 50 }),
    enabled: !!projectId,
    refetchInterval: 4000,
  });
  const listRef = useAutoAnimate<HTMLUListElement>();

  if (!projectId) {
    return (
      <>
        <PanelHeader title={t("activity.agents")} />
        <NoProjectState message={t("activity.requiresProject")} />
      </>
    );
  }

  const agentList = agents.data?.agents ?? [];
  const manifests = adapters.data?.adapters ?? [];
  const workingIds = new Set<string>();
  const latestActiveByAgent = new Map<string, Run>();
  for (const r of runs.data?.runs ?? []) {
    if (r.status === "running" || r.status === "queued") {
      workingIds.add(r.agentId);
      const cur = latestActiveByAgent.get(r.agentId);
      if (!cur || r.createdAt > cur.createdAt) {
        latestActiveByAgent.set(r.agentId, r);
      }
    }
  }

  return (
    <>
      <PanelHeader
        title={t("activity.agents")}
        action={
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="size-5 text-muted-foreground hover:text-foreground"
            title={t("chat.manageAgents")}
          >
            <Link
              to={`/projects/${projectId}/agents`}
              aria-label={t("chat.manageAgents")}
            >
              <Plus className="size-3.5" />
            </Link>
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto subtle-scrollbar py-1 min-h-0">
        {agents.isLoading ? (
          <ListSkeleton rows={4} />
        ) : agentList.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground/70 italic">
            {t("topStrip.empty")}
          </p>
        ) : (
          <ul ref={listRef} className="space-y-px">
            {agentList.map((a) => {
              const m = manifests.find((mm) => mm.kind === a.adapterKind);
              const cls = classesFor(agentColorOf(a));
              const working = workingIds.has(a.id);
              const active = latestActiveByAgent.get(a.id);
              return (
                <li key={a.id}>
                  <Link
                    to={`/projects/${projectId}/agents?edit=${a.id}`}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/50 transition-colors"
                  >
                    <AgentAvatar
                      agent={a}
                      manifest={m}
                      working={working}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className={cn("text-sm font-medium truncate", cls.text)}>
                        @{a.name}
                      </div>
                      {working && active ? (
                        <div className="text-[10px] text-muted-foreground/80 mono">
                          ● running · {elapsedSecs(active)}s
                        </div>
                      ) : a.role ? (
                        <div className="text-[10px] text-muted-foreground/60">
                          {a.role}
                        </div>
                      ) : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <ManageFooter
        to={`/projects/${projectId}/agents`}
        label={t("activity.manage")}
      />
    </>
  );
}
