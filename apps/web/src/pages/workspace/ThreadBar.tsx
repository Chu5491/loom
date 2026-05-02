// 채팅 영역 위쪽 스레드 컨트롤 바.
// 스레드 스위처 + 컨텍스트 첨부 알약 + 누적 비용 + focus mode 토글.

import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import NumberFlow from "@number-flow/react";
import { Drawer } from "vaul";
import {
  Archive,
  ArchiveRestore,
  Check,
  CheckCircle2,
  ChevronDown,
  Expand,
  GitBranch,
  MessagesSquare,
  Minimize2,
  Network,
  Paperclip,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { AdapterManifest, Agent, Thread } from "@loom/core";
import { api } from "../../api/client.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu.js";
// 큰 청크(@xyflow/react)는 드로어가 처음 열릴 때만 fetch.
const HandoffGraph = lazy(() =>
  import("../../components/HandoffGraph.js").then((m) => ({
    default: m.HandoffGraph,
  })),
);
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";
import { formatTimeAgo } from "../../lib/timeAgo.js";
import { emit } from "../../lib/loomEvents.js";
import { compactBundleSize } from "./formatters.js";

export function ThreadBar({
  projectId,
  threads,
  activeThread,
  activeThreadCost,
  fullModal,
  onToggleFullModal,
  onOpenContext,
  onPickThread,
  onNewThread,
  onNewIsolatedThread,
}: {
  projectId: string;
  threads: Thread[];
  activeThread: Thread | null;
  /** 이 스레드의 run 비용 합계. 비용 보고가 하나도 없으면 null. */
  activeThreadCost: number | null;
  fullModal?: boolean;
  onToggleFullModal?: () => void;
  onOpenContext: () => void;
  onPickThread: (id: string) => void;
  onNewThread: () => void;
  onNewIsolatedThread: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const rename = useMutation({
    mutationFn: (input: { id: string; name: string }) =>
      api.updateThread(input.id, { name: input.name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["threads", { projectId }] });
    },
  });

  const setStatus = useMutation({
    mutationFn: (input: { id: string; status: Thread["status"] }) =>
      api.updateThread(input.id, { status: input.status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["threads", { projectId }] });
    },
  });

  const removeThread = useMutation({
    mutationFn: (id: string) => api.deleteThread(id),
    onSuccess: (_data, deletedId) => {
      // 삭제된 thread가 활성이었으면 다음으로 자동 전환 — 가장 최근 thread,
      // 없으면 null(새 thread). emit 으로 부모(WorkspacePage)에 위임.
      if (activeThread && activeThread.id === deletedId) {
        const next = threads.find((t) => t.id !== deletedId);
        if (next) onPickThread(next.id);
        else onNewThread();
      }
      qc.invalidateQueries({ queryKey: ["threads", { projectId }] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : String(err)),
  });

  // ⌘⇧A 토글 아카이브. 입력 중에는 무시.
  useEffect(() => {
    if (!activeThread) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "a"
      ) {
        e.preventDefault();
        setStatus.mutate({
          id: activeThread.id,
          status:
            activeThread.status === "archived" ? "active" : "archived",
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeThread, setStatus]);

  const startEdit = () => {
    if (!activeThread) return;
    setDraftName(activeThread.name);
    setEditing(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };
  const commitEdit = () => {
    if (!activeThread) {
      setEditing(false);
      return;
    }
    const next = draftName.trim();
    if (next && next !== activeThread.name) {
      rename.mutate({ id: activeThread.id, name: next });
    }
    setEditing(false);
  };
  const cancelEdit = () => setEditing(false);

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border shrink-0 bg-card">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-2 h-7 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title={t("thread.bar.switch")}
          >
            {activeThread?.worktreePath ? (
              <GitBranch className="size-3.5 text-sky-600 dark:text-sky-400" />
            ) : (
              <MessagesSquare className="size-3.5" />
            )}
            <span>
              {activeThread
                ? t("thread.bar.threadsCount", { n: threads.length })
                : t("thread.bar.newConversation")}
            </span>
            <ChevronDown className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[18rem] max-w-[24rem]">
          <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("thread.bar.threadsCount", { n: threads.length })}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {threads.length === 0 ? (
            <div className="px-2 py-2 text-xs text-muted-foreground">
              {t("thread.bar.empty")}
            </div>
          ) : (
            threads.map((th) => (
              <DropdownMenuItem
                key={th.id}
                onSelect={() => onPickThread(th.id)}
                className="gap-2"
              >
                <span className="flex-1 truncate text-sm">{th.name}</span>
                {th.id === activeThread?.id ? (
                  <Check className="size-3 shrink-0 text-foreground/70" />
                ) : (
                  <span className="text-[10px] text-muted-foreground/60 mono shrink-0">
                    {formatTimeAgo(th.updatedAt, t)}
                  </span>
                )}
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onNewThread} className="gap-2 text-sm">
            <Plus className="size-3.5 text-muted-foreground" />
            {t("thread.bar.newThread")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={onNewIsolatedThread}
            className="gap-2 text-sm"
          >
            <GitBranch className="size-3.5 text-muted-foreground" />
            <span className="flex-1">{t("thread.bar.newIsolatedThread")}</span>
            <span className="text-[10px] text-muted-foreground/70">
              {t("thread.bar.isolatedTag")}
            </span>
          </DropdownMenuItem>
          {activeThread ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => activeThread && startEdit()}
                className="gap-2 text-sm"
              >
                <span className="size-3.5 inline-flex items-center justify-center text-muted-foreground">
                  ✎
                </span>
                {t("thread.bar.rename")}
              </DropdownMenuItem>
              {activeThread.status !== "done" ? (
                <DropdownMenuItem
                  onSelect={() =>
                    setStatus.mutate({
                      id: activeThread.id,
                      status: "done",
                    })
                  }
                  className="gap-2 text-sm"
                >
                  <CheckCircle2 className="size-3.5 text-muted-foreground" />
                  {t("thread.bar.markDone")}
                </DropdownMenuItem>
              ) : null}
              {activeThread.status !== "archived" ? (
                <DropdownMenuItem
                  onSelect={() =>
                    setStatus.mutate({
                      id: activeThread.id,
                      status: "archived",
                    })
                  }
                  className="gap-2 text-sm"
                >
                  <Archive className="size-3.5 text-muted-foreground" />
                  {t("thread.bar.archive")}
                  <span className="ml-auto text-[10px] text-muted-foreground/70 mono">
                    ⇧⌘A
                  </span>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onSelect={() =>
                    setStatus.mutate({
                      id: activeThread.id,
                      status: "active",
                    })
                  }
                  className="gap-2 text-sm"
                >
                  <ArchiveRestore className="size-3.5 text-muted-foreground" />
                  {t("thread.bar.unarchive")}
                  <span className="ml-auto text-[10px] text-muted-foreground/70 mono">
                    ⇧⌘A
                  </span>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  if (!activeThread) return;
                  const ok = window.confirm(
                    t("thread.bar.deleteConfirm", {
                      name: activeThread.name,
                    }),
                  );
                  if (ok) removeThread.mutate(activeThread.id);
                }}
                className="gap-2 text-sm text-destructive focus:text-destructive"
              >
                <Trash2 className="size-3.5" />
                {t("thread.bar.delete")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 이름 편집은 스위처 자리에서 인라인. 한 줄 유지. */}
      {editing && activeThread ? (
        <input
          ref={inputRef}
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.nativeEvent.isComposing &&
              e.nativeEvent.keyCode !== 229
            ) {
              e.preventDefault();
              commitEdit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelEdit();
            }
          }}
          placeholder={t("thread.bar.rename")}
          className="flex-1 min-w-0 bg-transparent border-0 px-2 py-0 text-sm focus:outline-none focus:ring-0"
        />
      ) : (
        <div className="flex-1" />
      )}

      {activeThread ? (
        <button
          type="button"
          onClick={onOpenContext}
          title={t("thread.bar.editContext")}
          aria-label={t("thread.bar.editContext")}
          className={cn(
            "inline-flex items-center gap-1 px-1.5 h-7 rounded text-[11px] transition-colors shrink-0",
            activeThread.contextBundle
              ? "text-sky-700 dark:text-sky-400 bg-sky-500/10 hover:bg-sky-500/20"
              : "text-muted-foreground hover:text-foreground hover:bg-muted",
          )}
        >
          <Paperclip className="size-3" />
          {activeThread.contextBundle ? (
            <span className="mono">
              {compactBundleSize(activeThread.contextBundle)}
            </span>
          ) : null}
        </button>
      ) : null}

      {activeThreadCost !== null ? (
        <span
          className="text-[11px] text-muted-foreground/80 mono shrink-0 px-1 inline-flex items-baseline"
          title={t("thread.bar.totalCost", {
            value: `$${activeThreadCost.toFixed(4)}`,
          })}
        >
          <NumberFlow
            value={activeThreadCost}
            format={
              activeThreadCost < 0.01
                ? { minimumFractionDigits: 4, maximumFractionDigits: 4 }
                : activeThreadCost < 10
                  ? { minimumFractionDigits: 3, maximumFractionDigits: 3 }
                  : { minimumFractionDigits: 2, maximumFractionDigits: 2 }
            }
            prefix="$"
          />
        </span>
      ) : null}

      {activeThread ? <ThreadGraphButton thread={activeThread} /> : null}

      {onToggleFullModal ? (
        <button
          type="button"
          onClick={onToggleFullModal}
          className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          title={
            fullModal
              ? t("workspace.chat.exitFullModal")
              : t("workspace.chat.enterFullModal")
          }
          aria-label={
            fullModal
              ? t("workspace.chat.exitFullModal")
              : t("workspace.chat.enterFullModal")
          }
        >
          {fullModal ? (
            <Minimize2 className="size-3.5" />
          ) : (
            <Expand className="size-3.5" />
          )}
        </button>
      ) : null}
    </div>
  );
}

// 활성 thread의 hand-off 그래프 — 우측 하단 작은 버튼이 vaul 드로어를 열고
// 그 안에서 react-flow 노드 그래프를 풀폭으로 보여줌. 다른 thread로 전환해도
// 드로어를 닫는 게 자연스러워서 매번 닫고 다시 열도록 함.
function ThreadGraphButton({ thread }: { thread: Thread }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const runs = useQuery({
    queryKey: ["runs", { threadId: thread.id }],
    queryFn: () => api.listRuns({ limit: 100 }),
    enabled: open,
  });
  const agents = useQuery({
    queryKey: ["agents", { projectId: thread.projectId }],
    queryFn: () => api.listAgents({ projectId: thread.projectId }),
    enabled: open,
  });
  const adapters = useQuery({
    queryKey: ["adapters"],
    queryFn: api.listAdapters,
    enabled: open,
  });

  const threadRuns = (runs.data?.runs ?? []).filter(
    (r) => r.threadId === thread.id,
  );
  const agentList: Agent[] = agents.data?.agents ?? [];
  const manifests: AdapterManifest[] = adapters.data?.adapters ?? [];

  return (
    <Drawer.Root
      open={open}
      onOpenChange={setOpen}
      direction="bottom"
    >
      <Drawer.Trigger asChild>
        <button
          type="button"
          className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          title={t("thread.bar.graph")}
          aria-label={t("thread.bar.graph")}
        >
          <Network className="size-3.5" />
        </button>
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-foreground/30" />
        <Drawer.Content
          aria-label={t("thread.bar.graph")}
          className="fixed bottom-0 left-0 right-0 z-50 h-[80vh] flex flex-col rounded-t-xl border-t bg-background shadow-2xl outline-none"
        >
          <Drawer.Title className="sr-only">
            {t("thread.bar.graph")}
          </Drawer.Title>
          <header className="flex items-center gap-2 px-4 py-3 border-b shrink-0">
            <Network className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold truncate">
              {t("thread.bar.graph")}
            </h2>
            <span className="text-[11px] text-muted-foreground/70 truncate">
              {thread.name}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="ml-auto inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label={t("context.drawer.close")}
            >
              <X className="size-4" />
            </button>
          </header>
          <div className="flex-1 min-h-0">
            {threadRuns.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground italic">
                {t("thread.graph.empty")}
              </div>
            ) : (
              <Suspense
                fallback={
                  <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                    {t("common.loading")}
                  </div>
                }
              >
                <HandoffGraph
                  runs={threadRuns}
                  agents={agentList}
                  manifests={manifests}
                  onJump={(runId) => {
                    setOpen(false);
                    emit("jumpToRun", { runId });
                  }}
                />
              </Suspense>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
