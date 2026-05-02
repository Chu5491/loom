// 프로젝트 에이전트 관리 페이지. 카드 그리드 + 생성/편집 폼.
// 폼 본체와 부속 컴포넌트는 ./agents/ 디렉토리로 분리.

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type { Agent } from "@loom/core";
import { api, type UpdateAgentBody } from "../api/client.js";
import { Button, Card } from "../components/ui.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { Spotlight } from "../components/Spotlight.js";
import { useConfirm } from "../components/ConfirmDialog.js";
import { PageScroll } from "../components/PageScroll.js";
import { PageHeader } from "../components/PageHeader.js";
import { AgentAvatar } from "../components/Chat.js";
import { AdapterStatusLive } from "../components/AdapterStatus.js";
import { agentColorOf, classesFor } from "../components/agentColor.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";
import { useAutoAnimate } from "../lib/useAutoAnimate.js";
import { celebrate } from "../lib/celebrate.js";
import { AgentForm } from "./agents/AgentForm.js";
import { AutonomyChip } from "./agents/Autonomy.js";
import { readAutonomy, type FormMode } from "./agents/types.js";

export function AgentsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const confirm = useConfirm();
  // 항상 /projects/:id 아래 — 부모 라우트가 프로젝트 스코프 제공.
  const { id: projectId } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
  });
  const list = useQuery({
    queryKey: ["agents", { projectId }],
    queryFn: () => api.listAgents({ projectId }),
  });
  const adapters = useQuery({
    queryKey: ["adapters"],
    queryFn: api.listAdapters,
  });

  const activeProject = projectId
    ? projects.data?.projects.find((p) => p.id === projectId)
    : undefined;

  const [formState, setFormState] = useState<FormMode | null>(null);
  const gridRef = useAutoAnimate<HTMLDivElement>();

  // ?edit=:agentId 딥링크 — 사이드패널에서 직접 편집 폼 열기. 소비 후 파라미터 삭제.
  const editParam = searchParams.get("edit");
  useEffect(() => {
    if (!editParam) return;
    const target = list.data?.agents.find((a) => a.id === editParam);
    if (!target) return;
    setFormState({ mode: "edit", agent: target });
    const next = new URLSearchParams(searchParams);
    next.delete("edit");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editParam, list.data]);

  const onMutationError = (err: unknown) =>
    toast.error(err instanceof Error ? err.message : String(err));

  const create = useMutation({
    mutationFn: api.createAgent,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      setFormState(null);
      toast.success(t("agents.toast.created", { name: r.agent.name }));
      celebrate("firstAgent");
    },
    onError: onMutationError,
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAgentBody }) =>
      api.updateAgent(id, body),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      setFormState(null);
      toast.success(t("agents.toast.saved", { name: r.agent.name }));
    },
    onError: onMutationError,
  });

  const remove = useMutation({
    mutationFn: api.deleteAgent,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      toast.success(t("agents.toast.deleted"));
    },
    onError: onMutationError,
  });

  return (
    <PageScroll className="space-y-4">
      <PageHeader
        title={t("agents.title")}
        description={t("agents.subtitle")}
        action={
          <Button
            onClick={() =>
              setFormState((s) => (s ? null : { mode: "create" }))
            }
            disabled={
              !activeProject && (projects.data?.projects.length ?? 0) === 0
            }
          >
            {formState ? t("common.cancel") : t("agents.new")}
          </Button>
        }
      />

      {(projects.data?.projects.length ?? 0) === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            {t("agents.needsProject")}{" "}
            <Link
              to="/projects"
              className="text-sky-600 dark:text-sky-300 hover:underline"
            >
              {t("projects.new")}
            </Link>
          </p>
        </Card>
      ) : null}

      {formState ? (
        <AgentForm
          // 다른 에이전트로 전환 시 폼 새로 마운트 — 내부 useState initial이 한 번만 평가되므로
          // key 없이는 이전 에이전트 값이 input에 남음.
          key={formState.mode === "edit" ? formState.agent.id : "create"}
          state={formState}
          manifests={adapters.data?.adapters ?? []}
          loadingManifests={adapters.isLoading}
          projects={projects.data?.projects ?? []}
          defaultProjectId={projectId}
          onCancel={() => setFormState(null)}
          submitting={create.isPending || update.isPending}
          onSubmit={(body) => {
            if (formState.mode === "edit") {
              update.mutate({ id: formState.agent.id, body });
            } else {
              create.mutate(body);
            }
          }}
        />
      ) : null}

      {list.isLoading ? (
        // 그리드 형태 그대로 스켈레톤 — 진짜 로딩 후의 레이아웃이 그대로 자리 잡음.
        <div className="grid gap-2 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-lg border border-border bg-card p-3 flex items-start gap-3"
            >
              <Skeleton className="size-10 rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
        </div>
      ) : list.isError ? (
        <p className="text-destructive text-sm">
          {list.error.message}
        </p>
      ) : list.data!.agents.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            {t("agents.empty")}
          </p>
        </Card>
      ) : (
        <div ref={gridRef} className="grid gap-2 sm:grid-cols-2">
          {list.data!.agents.map((a) => (
            <AgentRow
              key={a.id}
              agent={a}
              manifest={adapters.data?.adapters.find(
                (m) => m.kind === a.adapterKind,
              )}
              onEdit={() => setFormState({ mode: "edit", agent: a })}
              onDelete={async () => {
                const ok = await confirm({
                  title: t("agents.deleteConfirm", { name: a.name }),
                  destructive: true,
                });
                if (ok) remove.mutate(a.id);
              }}
            />
          ))}
        </div>
      )}
    </PageScroll>
  );
}

function AgentRow({
  agent: a,
  manifest,
  onEdit,
  onDelete,
}: {
  agent: Agent;
  manifest: import("@loom/core").AdapterManifest | undefined;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const cls = classesFor(agentColorOf(a));
  const model =
    typeof a.adapterConfig?.model === "string"
      ? (a.adapterConfig.model as string)
      : undefined;
  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-card hover:bg-muted/40 transition-colors">
      <Spotlight color={`rgb(var(--spotlight-color, 14 165 233) / 0.18)`} />
      <div className="relative flex items-start gap-3 p-3">
        <AgentAvatar agent={a} manifest={manifest} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 min-w-0">
            <Link
              to={`/runs?agentId=${a.id}`}
              className={cn(
                "font-semibold tracking-tight hover:underline truncate",
                cls.text,
              )}
            >
              @{a.name}
            </Link>
            {a.role ? (
              <span className="text-xs text-muted-foreground/80 shrink-0">
                {a.role}
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>{manifest?.displayName ?? a.adapterKind}</span>
            {model ? (
              <>
                <span className="text-muted-foreground/30">·</span>
                <span className="mono truncate">{model}</span>
              </>
            ) : null}
            <AutonomyChip autonomy={readAutonomy(a.adapterConfig)} />
          </div>
          <div className="mt-2">
            <AdapterStatusLive
              kind={a.adapterKind}
              command={
                typeof a.adapterConfig?.command === "string"
                  ? (a.adapterConfig.command as string)
                  : undefined
              }
            />
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            {t("common.edit")}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            {t("common.delete")}
          </Button>
        </div>
      </div>
    </div>
  );
}
