// VSCode 터미널의 우측 세션 리스트와 같은 컨셉의 스레드 사이드바.
// 채팅 dock 안 좌측에 도킹 — 클릭으로 스레드 전환, 행마다 "..." 메뉴로
// 이름변경/아카이브/세션 리셋/삭제. 이전엔 ThreadBar의 select dropdown
// 이었는데, 스레드가 늘어나면 dropdown은 답답하다는 피드백.

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  GitBranch,
  MessagesSquare,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { Thread } from "@loom/core";
import { api } from "../../api/client.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu.js";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";
import { threadBranchName, shortenBranch } from "../../lib/git-utils.js";
import { formatTimeAgo } from "../../lib/timeAgo.js";

export function ThreadList({
  projectId,
  threads,
  activeThread,
  workingThreadIds,
  compact = false,
  onPick,
  onNewThread,
  onNewIsolatedThread,
}: {
  projectId: string;
  threads: Thread[];
  activeThread: Thread | null;
  /** thread.id 중 현재 누군가 응답 중인 것들 — 라이브 닷 표시. */
  workingThreadIds: Set<string>;
  /** dock가 right placement일 때 가로폭 절약 — 아이콘 + working 닷만 보임. */
  compact?: boolean;
  onPick: (id: string) => void;
  onNewThread: () => void;
  onNewIsolatedThread: () => void;
}) {
  const { t } = useI18n();

  // 활성/done은 위, archived는 아래로 분리. 같은 그룹은 updatedAt desc.
  const sorted = [...threads].sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  const live = sorted.filter((th) => th.status !== "archived");
  const archived = sorted.filter((th) => th.status === "archived");

  return (
    <aside
      className={cn(
        "shrink-0 flex flex-col border-r border-border bg-card/40",
        compact ? "w-[44px]" : "w-[180px]",
      )}
    >
      <header
        className={cn(
          "flex items-center h-7 border-b border-border/70 shrink-0",
          compact ? "px-0.5 gap-0.5 justify-center" : "gap-1 px-2",
        )}
      >
        {compact ? null : (
          <>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              {t("thread.list.title")}
            </span>
            <span className="text-[10px] mono text-muted-foreground/60">
              {threads.length}
            </span>
            {live.filter((th) => th.worktreePath).length > 0 ? (
              <span className="text-[9px] mono text-sky-600 dark:text-sky-400/80">
                {t("thread.list.activeBranches", { n: live.filter((th) => th.worktreePath).length })}
              </span>
            ) : null}
          </>
        )}
        <div className={cn("flex items-center gap-0.5", !compact && "ml-auto")}>
          <button
            type="button"
            onClick={onNewThread}
            title={t("thread.bar.newThread")}
            aria-label={t("thread.bar.newThread")}
            className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Plus className="size-3.5" />
          </button>
          {compact ? null : (
            <button
              type="button"
              onClick={onNewIsolatedThread}
              title={t("thread.bar.newIsolatedThread")}
              aria-label={t("thread.bar.newIsolatedThread")}
              className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <GitBranch className="size-3.5" />
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        {threads.length === 0 ? (
          <div
            className={cn(
              "text-[11px] text-muted-foreground/70 italic",
              compact ? "px-1 py-2 text-center" : "px-2 py-2",
            )}
          >
            {compact ? "—" : t("thread.bar.empty")}
          </div>
        ) : (
          <>
            {live.map((th) => (
              <ThreadRow
                key={th.id}
                projectId={projectId}
                thread={th}
                active={activeThread?.id === th.id}
                working={workingThreadIds.has(th.id)}
                compact={compact}
                onPick={() => onPick(th.id)}
                onAfterDelete={() => {
                  if (activeThread?.id === th.id) {
                    const next = live.find((x) => x.id !== th.id);
                    if (next) onPick(next.id);
                    else onNewThread();
                  }
                }}
              />
            ))}
            {archived.length > 0 && !compact ? (
              <ArchivedSection projectId={projectId} threads={archived} activeId={activeThread?.id ?? null} onPick={onPick} />
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}

function ArchivedSection({
  projectId,
  threads,
  activeId,
  onPick,
}: {
  projectId: string;
  threads: Thread[];
  activeId: string | null;
  onPick: (id: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1 px-2 h-5 text-[10px] uppercase tracking-wider text-muted-foreground/70 hover:text-foreground transition-colors"
      >
        <span>{t("thread.list.archived")}</span>
        <span className="mono">{threads.length}</span>
      </button>
      {open
        ? threads.map((th) => (
            <ThreadRow
              key={th.id}
              projectId={projectId}
              thread={th}
              active={activeId === th.id}
              working={false}
              dim
              onPick={() => onPick(th.id)}
            />
          ))
        : null}
    </div>
  );
}

function ThreadRow({
  projectId,
  thread,
  active,
  working,
  dim,
  compact = false,
  onPick,
  onAfterDelete,
}: {
  projectId: string;
  thread: Thread;
  active: boolean;
  working: boolean;
  dim?: boolean;
  /** 가로폭 절약 — 아이콘 + 라이브 닷만, 이름/시간 숨김. hover 툴팁으로 보존. */
  compact?: boolean;
  onPick: () => void;
  onAfterDelete?: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(thread.name);

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing]);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["threads", { projectId }] });

  const rename = useMutation({
    mutationFn: (name: string) => api.updateThread(thread.id, { name }),
    onSuccess: invalidate,
  });
  const setStatus = useMutation({
    mutationFn: (status: Thread["status"]) =>
      api.updateThread(thread.id, { status }),
    onSuccess: invalidate,
  });
  const resetSession = useMutation({
    mutationFn: () => api.resetThreadSession(thread.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["runs"] });
      toast.success(t("thread.bar.resetSession.done"));
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : String(err)),
  });
  const removeThread = useMutation({
    mutationFn: () => api.deleteThread(thread.id),
    onSuccess: () => {
      onAfterDelete?.();
      invalidate();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : String(err)),
  });

  const commitRename = () => {
    const next = draft.trim();
    if (next && next !== thread.name) rename.mutate(next);
    setEditing(false);
  };

  // compact 모드는 일반 모드보다 짧게(아이콘만) — 이름/시간 라벨은 title 속성으로
  // 툴팁 노출. 인라인 편집은 compact일 땐 비활성 (자리가 없음).
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !editing && onPick()}
      onKeyDown={(e) => {
        if (editing) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick();
        }
      }}
      title={compact ? thread.name : undefined}
      className={cn(
        "group relative flex items-center cursor-pointer transition-colors",
        compact
          ? "justify-center px-1 py-1.5"
          : "gap-1.5 px-2 py-1",
        active
          ? "bg-foreground/[0.07] text-foreground"
          : "text-foreground/80 hover:bg-muted/50",
        dim && "opacity-60",
      )}
    >
      {active ? (
        <span
          aria-hidden
          className="absolute left-0 top-1 bottom-1 w-[2px] rounded-r-full bg-foreground"
        />
      ) : null}

      <span className="relative shrink-0">
        {thread.worktreePath ? (
          <GitBranch className="size-3.5 text-sky-600 dark:text-sky-400" />
        ) : (
          <MessagesSquare className="size-3.5 text-muted-foreground/70" />
        )}
        {compact && working ? (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-emerald-500 animate-pulse"
            title={t("participants.status.working")}
          />
        ) : null}
      </span>

      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.nativeEvent.isComposing &&
              e.nativeEvent.keyCode !== 229
            ) {
              e.preventDefault();
              commitRename();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 bg-transparent border-0 px-0 py-0 text-[12px] focus:outline-none focus:ring-0"
        />
      ) : compact ? null : (
        <div className="flex-1 min-w-0">
          <span className="block truncate text-[12px]">
            {thread.name}
          </span>
          {(() => {
            const branch = threadBranchName(thread);
            return branch ? (
              <span className="block truncate text-[10px] text-muted-foreground/50 mono leading-tight">
                {shortenBranch(branch)}
              </span>
            ) : null;
          })()}
        </div>
      )}

      {!compact && working ? (
        <span
          aria-hidden
          className="size-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0"
          title={t("participants.status.working")}
        />
      ) : !compact && !editing ? (
        <span className="text-[10px] text-muted-foreground/50 mono shrink-0 group-hover:hidden">
          {formatTimeAgo(thread.updatedAt, t)}
        </span>
      ) : null}

      {/* hover 시 노출되는 "..." 메뉴 — compact 모드에선 자리가 없어서 생략.
          이름변경/아카이브/삭제는 thread를 펼친 모드(bottom)에서 사용. */}
      {!editing && !compact ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex size-4 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100 transition-opacity"
              aria-label={t("thread.list.more")}
            >
              <MoreHorizontal className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenuItem
              onSelect={() => {
                setDraft(thread.name);
                setEditing(true);
              }}
              className="gap-2 text-sm"
            >
              <span className="size-3.5 inline-flex items-center justify-center text-muted-foreground">
                ✎
              </span>
              {t("thread.bar.rename")}
            </DropdownMenuItem>
            {thread.status !== "done" ? (
              <DropdownMenuItem
                onSelect={() => setStatus.mutate("done")}
                className="gap-2 text-sm"
              >
                <CheckCircle2 className="size-3.5 text-muted-foreground" />
                {t("thread.bar.markDone")}
              </DropdownMenuItem>
            ) : null}
            {thread.status !== "archived" ? (
              <DropdownMenuItem
                onSelect={() => setStatus.mutate("archived")}
                className="gap-2 text-sm"
              >
                <Archive className="size-3.5 text-muted-foreground" />
                {t("thread.bar.archive")}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onSelect={() => setStatus.mutate("active")}
                className="gap-2 text-sm"
              >
                <ArchiveRestore className="size-3.5 text-muted-foreground" />
                {t("thread.bar.unarchive")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => resetSession.mutate()}
              className="gap-2 text-sm"
            >
              <RefreshCw className="size-3.5 text-muted-foreground" />
              {t("thread.bar.resetSession")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                const ok = window.confirm(
                  t("thread.bar.deleteConfirm", { name: thread.name }),
                );
                if (ok) removeThread.mutate();
              }}
              className="gap-2 text-sm text-destructive focus:text-destructive"
            >
              <Trash2 className="size-3.5" />
              {t("thread.bar.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
