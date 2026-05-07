// 좌측 사이드바 하단의 stash 섹션. BranchTree 아래에 collapsible 로 붙음.
//
// 기본 동작: 워킹트리에 변경이 있을 때 "Stash all" 버튼이 활성. 항목 hover 시
// pop / apply / drop 이 떠서 즉시 처리.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  PackagePlus,
  PackageOpen,
  Plus,
  Trash2,
  MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { api, type GitStashEntry } from "../../api/client.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu.js";
import { useConfirm } from "../../components/ConfirmDialog.js";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";
import { formatTimeAgo } from "../../lib/timeAgo.js";

export function StashPanel({
  projectId,
  hasChanges,
}: {
  projectId: string;
  /** 워킹트리에 staged + unstaged 변경이 있나 — Stash 가능 여부 게이트. */
  hasChanges: boolean;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [open, setOpen] = useState(true);
  const [creating, setCreating] = useState(false);

  const list = useQuery({
    queryKey: ["gitStash", projectId],
    queryFn: () => api.gitListStash(projectId),
    refetchInterval: 30_000,
    retry: false,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["gitStash", projectId] });
    qc.invalidateQueries({ queryKey: ["gitStatus", projectId] });
  };

  const save = useMutation({
    mutationFn: (msg: string) =>
      api.gitSaveStash(projectId, {
        message: msg,
        includeUntracked: true,
      }),
    onSuccess: () => {
      toast.success(t("git.stash.saved"));
      setCreating(false);
      invalidateAll();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const pop = useMutation({
    mutationFn: (idx: number) => api.gitPopStash(projectId, idx),
    onSuccess: () => {
      toast.success(t("git.stash.popped"));
      invalidateAll();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const apply = useMutation({
    mutationFn: (idx: number) => api.gitApplyStash(projectId, idx),
    onSuccess: () => {
      toast.success(t("git.stash.applied"));
      invalidateAll();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const drop = useMutation({
    mutationFn: (idx: number) => api.gitDropStash(projectId, idx),
    onSuccess: () => {
      toast.success(t("git.stash.dropped"));
      invalidateAll();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const handleDrop = async (entry: GitStashEntry) => {
    const ok = await confirm({
      title: t("git.stash.dropTitle"),
      description: t("git.stash.dropDesc", { name: entry.message }),
      confirmLabel: t("common.delete"),
      destructive: true,
    });
    if (ok) drop.mutate(entry.index);
  };

  const entries = list.data?.entries ?? [];

  return (
    <div className="border-t border-border/40 flex flex-col">
      <div className="flex items-center px-2 h-7 group">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 flex-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight
            className={cn("size-3 transition-transform", open && "rotate-90")}
          />
          <span className="flex-1 text-left">{t("git.section.stash")}</span>
          <span className="mono text-[10px] text-muted-foreground/70">
            {entries.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            setCreating(true);
            setOpen(true);
          }}
          disabled={!hasChanges}
          title={
            hasChanges
              ? t("git.stash.save")
              : t("git.stash.noChangesToStash")
          }
          aria-label={t("git.stash.save")}
          className="ml-1 inline-flex size-4 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-30 disabled:hover:text-muted-foreground disabled:hover:bg-transparent"
        >
          <Plus className="size-3" />
        </button>
      </div>
      {open ? (
        <div className="pb-1">
          {creating ? (
            <SaveStashInput
              onSubmit={(msg) => save.mutate(msg)}
              onCancel={() => setCreating(false)}
              busy={save.isPending}
            />
          ) : null}
          {entries.length === 0 && !creating ? (
            <p className="px-3 py-2 text-[11px] text-muted-foreground/70 italic">
              {t("git.stash.empty")}
            </p>
          ) : (
            entries.map((s) => (
              <StashRow
                key={s.index}
                entry={s}
                onPop={() => pop.mutate(s.index)}
                onApply={() => apply.mutate(s.index)}
                onDrop={() => handleDrop(s)}
                disabled={
                  pop.isPending || apply.isPending || drop.isPending
                }
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function StashRow({
  entry,
  onPop,
  onApply,
  onDrop,
  disabled,
}: {
  entry: GitStashEntry;
  onPop: () => void;
  onApply: () => void;
  onDrop: () => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  // "WIP on main: abc1234 …" 에서 사용자 메시지만 깔끔히 보여주기.
  const cleaned =
    entry.message
      .replace(/^(?:WIP on|On)\s+[^:]+:\s*[a-f0-9]{4,}\s*/i, "")
      .trim() || entry.message;
  return (
    <div
      className="group flex items-center gap-1 pl-3.5 pr-1 py-1 hover:bg-muted/60 transition-colors"
      title={`stash@{${entry.index}} · ${entry.message}`}
    >
      <PackagePlus className="size-3 text-muted-foreground/60 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] truncate">{cleaned}</div>
        <div className="text-[9px] mono text-muted-foreground/60 flex items-center gap-1.5">
          <span>{entry.branch ?? "—"}</span>
          <span>·</span>
          <span>{formatTimeAgo(entry.createdAt, t)}</span>
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="opacity-0 group-hover:opacity-100 inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted shrink-0"
            aria-label="actions"
          >
            <MoreHorizontal className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[10rem]">
          <DropdownMenuItem onSelect={onPop}>
            <PackageOpen className="size-3.5 mr-2" />
            {t("git.stash.pop")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onApply}>
            {t("git.stash.apply")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={onDrop}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="size-3.5 mr-2" />
            {t("git.stash.drop")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function SaveStashInput({
  onSubmit,
  onCancel,
  busy,
}: {
  onSubmit: (msg: string) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  return (
    <div className="flex items-center gap-1 px-2 py-1">
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit(value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder={t("git.stash.messagePlaceholder")}
        className="h-6 text-[11px]"
        disabled={busy}
      />
      <Button
        size="sm"
        onClick={() => onSubmit(value)}
        disabled={busy}
        className="h-6 px-2 text-[11px]"
      >
        {t("git.stash.save")}
      </Button>
    </div>
  );
}
