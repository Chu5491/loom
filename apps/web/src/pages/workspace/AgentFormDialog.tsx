// AgentFormDialog — 라이브 화면 안에서 에이전트를 만들고 편집하는 모달.
// 기존 /projects/:id/agents 풀 페이지 폼(AgentForm) 을 재사용해 동일한 UX.
//
// LiveView 의 ➕ 추가 / ✏️ 편집 버튼이 이 dialog 를 띄움. 사용자는 라이브
// 화면을 떠나지 않고 모든 작업 수행 → 컨텍스트 유지.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, type UpdateAgentBody } from "../../api/client.js";
import { useConfirm } from "../../components/ConfirmDialog.js";
import { Button } from "../../components/ui/button.js";
import { useI18n } from "../../context/I18nContext.js";
import { AgentForm } from "../agents/AgentForm.js";
import type { FormMode } from "../agents/types.js";

export function AgentFormDialog({
  open,
  state,
  projectId,
  onOpenChange,
}: {
  open: boolean;
  /** create 또는 edit 모드 정보. open=true 일 때 반드시 non-null. */
  state: FormMode | null;
  projectId: string | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const confirm = useConfirm();

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
    enabled: open,
  });
  const adapters = useQuery({
    queryKey: ["adapters"],
    queryFn: api.listAdapters,
    enabled: open,
  });

  const close = () => onOpenChange(false);

  const create = useMutation({
    mutationFn: api.createAgent,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      close();
      toast.success(t("agents.toast.created", { name: r.agent.name }));
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAgentBody }) =>
      api.updateAgent(id, body),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      close();
      toast.success(t("agents.toast.saved", { name: r.agent.name }));
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });
  const remove = useMutation({
    mutationFn: api.deleteAgent,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      close();
      toast.success(t("agents.toast.deleted"));
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  const submitting = create.isPending || update.isPending;

  return (
    <AnimatePresence>
      {open && state ? (
        <>
          <motion.div
            key="agent-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm"
            onClick={close}
          />
          <motion.div
            key="agent-dialog"
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.16 }}
            role="dialog"
            aria-modal="true"
            className="fixed left-1/2 top-[6vh] z-50 w-[min(760px,94vw)] -translate-x-1/2 rounded-lg border bg-popover shadow-2xl outline-none flex flex-col max-h-[88vh]"
          >
            <header className="flex items-center gap-2 px-4 h-11 border-b border-border shrink-0">
              <h2 className="text-sm font-semibold">
                {state.mode === "edit"
                  ? t("agentDialog.editTitle", { name: state.agent.name })
                  : t("agentDialog.createTitle")}
              </h2>
              <button
                type="button"
                onClick={close}
                aria-label={t("common.close")}
                className="ml-auto inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <X className="size-3.5" />
              </button>
            </header>

            <div className="overflow-y-auto p-4">
              <AgentForm
                key={state.mode === "edit" ? state.agent.id : "create"}
                state={state}
                manifests={adapters.data?.adapters ?? []}
                loadingManifests={adapters.isLoading}
                projects={projects.data?.projects ?? []}
                defaultProjectId={projectId}
                onCancel={close}
                submitting={submitting}
                onSubmit={(body) => {
                  if (state.mode === "edit") {
                    update.mutate({ id: state.agent.id, body });
                  } else {
                    create.mutate(body);
                  }
                }}
              />
            </div>

            {/* 편집 모드면 하단에 위험 액션 — 한 번 더 confirm 후 삭제. */}
            {state.mode === "edit" ? (
              <footer className="flex items-center justify-between gap-2 px-4 h-11 border-t border-border bg-muted/30 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  disabled={remove.isPending}
                  onClick={async () => {
                    if (state.mode !== "edit") return;
                    const ok = await confirm({
                      title: t("agents.deleteConfirm", {
                        name: state.agent.name,
                      }),
                      destructive: true,
                    });
                    if (ok) remove.mutate(state.agent.id);
                  }}
                >
                  <Trash2 className="size-3.5 mr-1" />
                  {t("agentDialog.delete")}
                </Button>
                <span className="text-[10px] text-muted-foreground/70 mono">
                  {state.agent.id.slice(0, 8)}
                </span>
              </footer>
            ) : null}
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
