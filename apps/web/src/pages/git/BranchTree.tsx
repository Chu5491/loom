// 좌측 브랜치 트리 — Local / Remotes 그룹.
// - 더블클릭 또는 행 hover→checkout
// - 행 hover 시 ⋯ 메뉴: rename / delete (+ delete --force)
// - 그룹 헤더에 + 버튼 → 새 브랜치 (현재 HEAD 에서)

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  GitBranch,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { api, type GitBranchInfo } from "../../api/client.js";
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

interface RemoteGroup {
  remote: string;
  branches: GitBranchInfo[];
}

export function BranchTree({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [openLocal, setOpenLocal] = useState(true);
  const [openRemotes, setOpenRemotes] = useState(true);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);

  const branches = useQuery({
    queryKey: ["gitBranches", projectId],
    queryFn: () => api.getGitBranches(projectId),
    refetchInterval: 30_000,
    retry: false,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["gitStatus", projectId] });
    qc.invalidateQueries({ queryKey: ["gitBranches", projectId] });
    qc.invalidateQueries({ queryKey: ["gitLog", projectId, { all: true }] });
  };

  const checkout = useMutation({
    mutationFn: (branch: string) => api.gitCheckout(projectId, branch),
    onSuccess: (_r, branch) => {
      toast.success(t("git.checkoutDone", { branch }));
      invalidateAll();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const create = useMutation({
    mutationFn: (name: string) =>
      api.gitCreateBranch(projectId, { name, checkout: true }),
    onSuccess: (_r, name) => {
      toast.success(t("git.branchCreated", { name }));
      setCreating(false);
      invalidateAll();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const rename = useMutation({
    mutationFn: (args: { oldName: string; newName: string }) =>
      api.gitRenameBranch(projectId, args.oldName, args.newName),
    onSuccess: (_r, args) => {
      toast.success(t("git.branchRenamed", { name: args.newName }));
      setRenaming(null);
      invalidateAll();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const remove = useMutation({
    mutationFn: (args: { name: string; force?: boolean }) =>
      api.gitDeleteBranch(projectId, args.name, { force: args.force }),
    onSuccess: (_r, args) => {
      toast.success(t("git.branchDeleted", { name: args.name }));
      invalidateAll();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const { local, remotes } = useMemo(() => {
    const list = branches.data?.branches ?? [];
    const local: GitBranchInfo[] = [];
    const groups = new Map<string, GitBranchInfo[]>();
    for (const b of list) {
      if (b.kind === "remote") {
        const slash = b.name.indexOf("/");
        const remote = slash >= 0 ? b.name.slice(0, slash) : "origin";
        const arr = groups.get(remote) ?? [];
        arr.push(b);
        groups.set(remote, arr);
      } else {
        local.push(b);
      }
    }
    const remotes: RemoteGroup[] = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([remote, branches]) => ({ remote, branches }));
    return { local, remotes };
  }, [branches.data?.branches]);

  const handleDelete = async (name: string) => {
    const ok = await confirm({
      title: t("git.deleteBranchTitle"),
      description: t("git.deleteBranchDesc", { name }),
      confirmLabel: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync({ name });
    } catch (err) {
      // 머지 안 된 브랜치는 -d 가 거부 → force 한 번 더 묻기.
      const msg = (err as Error).message;
      if (/not fully merged|-D/.test(msg)) {
        const forceOk = await confirm({
          title: t("git.deleteBranchForceTitle"),
          description: t("git.deleteBranchForceDesc", { name }),
          confirmLabel: t("git.deleteBranchForce"),
          destructive: true,
        });
        if (forceOk) remove.mutate({ name, force: true });
      }
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto subtle-scrollbar">
        <Group
          label={t("git.section.local")}
          count={local.length}
          open={openLocal}
          onToggle={() => setOpenLocal((v) => !v)}
          action={
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setCreating(true);
                setOpenLocal(true);
              }}
              className="inline-flex size-4 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              title={t("git.newBranch")}
              aria-label={t("git.newBranch")}
            >
              <Plus className="size-3" />
            </button>
          }
        >
          {creating ? (
            <NewBranchInput
              onSubmit={(name) => create.mutate(name)}
              onCancel={() => setCreating(false)}
              busy={create.isPending}
            />
          ) : null}
          {local.map((b) =>
            renaming === b.name ? (
              <RenameInput
                key={`local-rn:${b.name}`}
                initial={b.name}
                onSubmit={(newName) =>
                  rename.mutate({ oldName: b.name, newName })
                }
                onCancel={() => setRenaming(null)}
                busy={rename.isPending}
              />
            ) : (
              <BranchRow
                key={`local:${b.name}`}
                branch={b}
                onCheckout={() => checkout.mutate(b.name)}
                onRename={() => setRenaming(b.name)}
                onDelete={() => handleDelete(b.name)}
                disabled={checkout.isPending}
              />
            ),
          )}
        </Group>

        <Group
          label={t("git.section.remotes")}
          count={remotes.reduce((n, g) => n + g.branches.length, 0)}
          open={openRemotes}
          onToggle={() => setOpenRemotes((v) => !v)}
        >
          {remotes.map((g) => (
            <RemoteGroupView
              key={g.remote}
              group={g}
              onCheckout={(name) => checkout.mutate(name)}
              disabled={checkout.isPending}
            />
          ))}
        </Group>
    </div>
  );
}

function Group({
  label,
  count,
  open,
  onToggle,
  action,
  children,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border/40">
      <div className="flex items-center px-2 h-7 group">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-1.5 flex-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight
            className={cn("size-3 transition-transform", open && "rotate-90")}
          />
          <span className="flex-1 text-left">{label}</span>
          <span className="mono text-[10px] text-muted-foreground/70">
            {count}
          </span>
        </button>
        {action ? (
          <span className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {action}
          </span>
        ) : null}
      </div>
      {open ? <div className="pb-1">{children}</div> : null}
    </div>
  );
}

function BranchRow({
  branch,
  onCheckout,
  onRename,
  onDelete,
  disabled,
  remotePrefix,
}: {
  branch: GitBranchInfo;
  onCheckout: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  disabled?: boolean;
  remotePrefix?: string;
}) {
  const { t } = useI18n();
  const display = remotePrefix
    ? branch.name.slice(remotePrefix.length + 1)
    : branch.name;
  const showActions = !!(onRename || onDelete);
  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 pl-7 pr-1 h-7 text-[12px] mono hover:bg-muted/60 transition-colors",
        branch.current && "bg-foreground/[0.06] font-semibold",
      )}
      title={branch.name}
    >
      <GitBranch
        className={cn(
          "size-3 shrink-0",
          branch.current ? "text-emerald-500" : "text-muted-foreground/60",
        )}
      />
      <button
        type="button"
        onDoubleClick={onCheckout}
        disabled={disabled}
        className="truncate flex-1 text-left"
      >
        {display}
      </button>
      {branch.upstream && !branch.current ? (
        <span className="text-[9px] mono text-muted-foreground/60 truncate max-w-[5rem] opacity-0 group-hover:opacity-100">
          ↑{branch.upstream}
        </span>
      ) : null}
      {showActions ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="opacity-0 group-hover:opacity-100 inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted shrink-0"
              aria-label="actions"
            >
              <MoreHorizontal className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[10rem]">
            <DropdownMenuItem onSelect={onCheckout} disabled={branch.current}>
              {t("git.checkout")}
            </DropdownMenuItem>
            {onRename ? (
              <DropdownMenuItem onSelect={onRename}>
                <Pencil className="size-3.5 mr-2" />
                {t("git.rename")}
              </DropdownMenuItem>
            ) : null}
            {onDelete ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={onDelete}
                  disabled={branch.current}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="size-3.5 mr-2" />
                  {t("common.delete")}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

function RemoteGroupView({
  group,
  onCheckout,
  disabled,
}: {
  group: RemoteGroup;
  onCheckout: (name: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 pl-3.5 pr-2 h-6 text-[11px] mono text-muted-foreground/80 hover:text-foreground transition-colors"
      >
        <ChevronRight
          className={cn("size-3 transition-transform", open && "rotate-90")}
        />
        <span className="truncate">{group.remote}</span>
      </button>
      {open
        ? group.branches.map((b) => (
            <BranchRow
              key={`remote:${b.name}`}
              branch={b}
              onCheckout={() => onCheckout(b.name)}
              disabled={disabled}
              remotePrefix={group.remote}
            />
          ))
        : null}
    </div>
  );
}

// ─── inline inputs ────────────────────────────────────────────────────────

function NewBranchInput({
  onSubmit,
  onCancel,
  busy,
}: {
  onSubmit: (name: string) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const submit = () => {
    const v = value.trim();
    if (v) onSubmit(v);
  };
  return (
    <div className="flex items-center gap-1 pl-7 pr-1 py-1">
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder={t("git.newBranchPlaceholder")}
        className="h-6 text-[11px] mono"
        disabled={busy}
      />
      <Button
        size="sm"
        onClick={submit}
        disabled={!value.trim() || busy}
        className="h-6 px-2 text-[11px]"
      >
        {t("common.create")}
      </Button>
    </div>
  );
}

function RenameInput({
  initial,
  onSubmit,
  onCancel,
  busy,
}: {
  initial: string;
  onSubmit: (newName: string) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(initial);
  const submit = () => {
    const v = value.trim();
    if (v && v !== initial) onSubmit(v);
    else onCancel();
  };
  return (
    <div className="flex items-center gap-1 pl-7 pr-1 py-1">
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        className="h-6 text-[11px] mono"
        disabled={busy}
      />
      <Button
        size="sm"
        onClick={submit}
        disabled={!value.trim() || busy}
        className="h-6 px-2 text-[11px]"
      >
        {t("common.save")}
      </Button>
    </div>
  );
}
