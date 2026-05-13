// 채팅 영역 위쪽 컨트롤 바 — 활성 thread 정보(이름/참여자/작업중)와 보조
// 액션(컨텍스트 첨부 / 누적 비용 / 세션 리셋 / hand-off 그래프 / 풀모달).
// 스레드 목록 자체는 좌측 ThreadList 사이드바가 담당 — 이전 dropdown 스위처는 제거.

import { Suspense, lazy, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import NumberFlow from "@number-flow/react";
import { Drawer } from "vaul";
import {
  Copy,
  GitBranch,
  MessagesSquare,
  Network,
  Paperclip,
  RefreshCw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { AdapterManifest, Agent, Thread } from "@loom/core";
import { api } from "../../api/client.js";
import { AgentInitialBadge } from "../../components/AgentInitialBadge.js";
import { threadBranchName, shortenBranch, copyToClipboard } from "../../lib/git-utils.js";
// 큰 청크(@xyflow/react)는 드로어가 처음 열릴 때만 fetch.
const HandoffGraph = lazy(() =>
  import("../../components/HandoffGraph.js").then((m) => ({
    default: m.HandoffGraph,
  })),
);
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";
import { emit } from "../../lib/loomEvents.js";
import { compactBundleSize } from "./formatters.js";

export function ThreadBar({
  activeThread,
  activeThreadCost,
  participants,
  workingIds,
  touchingIds,
  onOpenContext,
}: {
  activeThread: Thread | null;
  /** 이 스레드의 run 비용 합계. 비용 보고가 하나도 없으면 null. */
  activeThreadCost: number | null;
  /** 이 스레드에서 한 번이라도 발화한 에이전트 — 참여자 stack용. */
  participants: Agent[];
  /** 응답을 만들고 있는 (running) 에이전트들. */
  workingIds: Set<string>;
  /** 실제로 파일을 만지고 있는 에이전트들. live dot 표시용. */
  touchingIds: Set<string>;
  onOpenContext: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();

  const setStatus = useMutation({
    mutationFn: (input: { id: string; status: Thread["status"] }) =>
      api.updateThread(input.id, { status: input.status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["threads"] });
    },
  });

  const resetSession = useMutation({
    mutationFn: (id: string) => api.resetThreadSession(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["runs"] });
      toast.success(t("thread.bar.resetSession.done"));
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : String(err)),
  });

  // ⌘⇧A 토글 아카이브. 입력 중에는 무시. (이름 편집 등은 ThreadList 안에 있음)
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

  const workingCount = workingIds.size;

  return (
    <div className="flex items-center gap-1 px-3 py-1 border-b border-border shrink-0 bg-card">
      {/* 활성 thread 라벨 — 사이드바와 동일한 아이콘 + 이름. dropdown 없음. */}
      <div className="flex items-center gap-1.5 min-w-0 shrink">
        {activeThread?.worktreePath ? (
          <GitBranch className="size-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
        ) : (
          <MessagesSquare className="size-3.5 text-muted-foreground shrink-0" />
        )}
        <span className="text-[12px] font-medium text-foreground truncate">
          {activeThread ? activeThread.name : t("thread.bar.newConversation")}
        </span>
        {activeThread ? (() => {
          const branch = threadBranchName(activeThread);
          return branch ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void copyToClipboard(branch).then(() =>
                  toast.success(t("thread.branch.copied")),
                );
              }}
              title={t("thread.branch.copy")}
              className="inline-flex items-center gap-1 px-1.5 h-5 rounded bg-sky-500/10 text-[10px] mono text-sky-700 dark:text-sky-400 hover:bg-sky-500/20 transition-colors shrink-0"
            >
              {shortenBranch(branch)}
              <Copy className="size-2.5" />
            </button>
          ) : null;
        })() : null}
      </div>

      {/* 참여자 stack — 누가 이 thread에서 발화했는가. live dot은 touching에 한해. */}
      {participants.length > 0 ? (
        <div className="flex -space-x-1.5 shrink-0 ml-1">
          {participants.slice(0, 4).map((a) => (
            <span
              key={a.id}
              className="ring-2 ring-card rounded-full"
              title={`@${a.name}`}
            >
              <AgentInitialBadge
                agent={a}
                size="xs"
                live={touchingIds.has(a.id)}
              />
            </span>
          ))}
          {participants.length > 4 ? (
            <span
              className="size-5 rounded-full ring-2 ring-card bg-muted text-[9px] font-semibold mono inline-flex items-center justify-center text-muted-foreground"
              title={participants
                .slice(4)
                .map((a) => `@${a.name}`)
                .join(", ")}
            >
              +{participants.length - 4}
            </span>
          ) : null}
        </div>
      ) : null}

      {workingCount > 0 ? (
        <span
          className="inline-flex items-center gap-1 px-1.5 h-5 rounded-full text-[10px] mono text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 shrink-0"
          title={t("participants.status.working")}
        >
          <span
            aria-hidden
            className="size-1.5 rounded-full bg-emerald-500 animate-pulse"
          />
          {t("thread.bar.workingCount", { n: workingCount })}
        </span>
      ) : null}

      <div className="flex-1" />

      {activeThread ? (
        <button
          type="button"
          onClick={onOpenContext}
          title={t("thread.bar.editContext")}
          aria-label={t("thread.bar.editContext")}
          className={cn(
            "inline-flex items-center gap-1 px-1.5 h-6 rounded text-[11px] transition-colors shrink-0",
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

      {activeThread ? (
        <button
          type="button"
          onClick={() => resetSession.mutate(activeThread.id)}
          disabled={resetSession.isPending}
          title={t("thread.bar.resetSession")}
          aria-label={t("thread.bar.resetSession")}
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0 disabled:opacity-50"
        >
          <RefreshCw
            className={cn(
              "size-3.5",
              resetSession.isPending && "animate-spin",
            )}
          />
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
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
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
