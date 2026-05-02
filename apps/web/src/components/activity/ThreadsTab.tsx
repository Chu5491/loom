// 사이드 패널 — 프로젝트 스레드 목록 + 새 스레드/격리 스레드 트리거.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { Archive, CheckCircle2, GitBranch, Plus } from "lucide-react";
import type { Thread } from "@loom/core";
import { api } from "../../api/client.js";
import { useI18n } from "../../context/I18nContext.js";
import { formatTimeAgo } from "../../lib/timeAgo.js";
import { useAutoAnimate } from "../../lib/useAutoAnimate.js";
import { emit } from "../../lib/loomEvents.js";
import { ListSkeleton, NoProjectState, PanelHeader } from "./shared.js";

export function ThreadsTab() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const threads = useQuery({
    queryKey: ["threads", { projectId }],
    queryFn: () => api.listThreads({ projectId }),
    enabled: !!projectId,
  });
  const list = threads.data?.threads ?? [];
  const listRef = useAutoAnimate<HTMLUListElement>();

  const newThread = () => emit("newThread");
  const newIsolated = useMutation({
    mutationFn: () =>
      api.createThread({
        projectId: projectId!,
        name: t("thread.isolated.defaultName"),
        isolate: true,
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["threads", { projectId }] });
      emit("pickThread", { id: r.thread.id });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : String(err)),
  });

  if (!projectId) {
    return (
      <>
        <PanelHeader title={t("activity.threads")} />
        <NoProjectState message={t("activity.requiresProject")} />
      </>
    );
  }
  return (
    <>
      <PanelHeader
        title={t("activity.threads")}
        action={
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => newIsolated.mutate()}
              title={t("thread.bar.newIsolatedThread")}
              aria-label={t("thread.bar.newIsolatedThread")}
              className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <GitBranch className="size-3" />
            </button>
            <button
              type="button"
              onClick={newThread}
              title={t("thread.bar.newThread")}
              aria-label={t("thread.bar.newThread")}
              className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto subtle-scrollbar py-1">
        {threads.isLoading ? (
          <ListSkeleton rows={4} withAvatar={false} />
        ) : list.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground/70 italic">
            {t("thread.bar.empty")}
          </p>
        ) : (
          <ul ref={listRef} className="space-y-px">
            {list.map((th) => (
              <li key={th.id}>
                <ThreadRow thread={th} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function ThreadRow({ thread }: { thread: Thread }) {
  const { t } = useI18n();
  const pick = () => emit("pickThread", { id: thread.id });
  const StatusIcon =
    thread.status === "done"
      ? CheckCircle2
      : thread.status === "archived"
        ? Archive
        : null;
  return (
    <button
      type="button"
      onClick={pick}
      className="w-full flex items-start gap-2 px-3 py-1.5 text-left hover:bg-muted/50 transition-colors"
      title={thread.name}
    >
      {thread.worktreePath ? (
        <GitBranch className="size-3 shrink-0 mt-0.5 text-sky-600 dark:text-sky-400" />
      ) : StatusIcon ? (
        <StatusIcon className="size-3 shrink-0 mt-0.5 text-muted-foreground" />
      ) : (
        <span className="size-3 shrink-0 mt-1 inline-block rounded-full bg-foreground/30" />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm truncate">{thread.name}</div>
        <div className="text-[10px] text-muted-foreground/70 mono">
          {formatTimeAgo(thread.updatedAt, t)}
        </div>
      </div>
    </button>
  );
}
