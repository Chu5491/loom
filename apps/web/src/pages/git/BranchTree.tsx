// 좌측 브랜치 트리 — Local / Remotes 그룹. 더블클릭으로 checkout.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, GitBranch } from "lucide-react";
import { toast } from "sonner";
import { api, type GitBranchInfo } from "../../api/client.js";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";

interface RemoteGroup {
  remote: string;
  branches: GitBranchInfo[];
}

export function BranchTree({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [openLocal, setOpenLocal] = useState(true);
  const [openRemotes, setOpenRemotes] = useState(true);

  const branches = useQuery({
    queryKey: ["gitBranches", projectId],
    queryFn: () => api.getGitBranches(projectId),
    refetchInterval: 30_000,
    retry: false,
  });

  const checkout = useMutation({
    mutationFn: (branch: string) => api.gitCheckout(projectId, branch),
    onSuccess: (_r, branch) => {
      toast.success(t("git.checkoutDone", { branch }));
      qc.invalidateQueries({ queryKey: ["gitStatus", projectId] });
      qc.invalidateQueries({ queryKey: ["gitBranches", projectId] });
      qc.invalidateQueries({
        queryKey: ["gitLog", projectId, { all: true }],
      });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  // local 과 remote 분리. remote/origin/foo → group "origin", branch "foo".
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

  return (
    <aside className="w-[220px] shrink-0 border-r border-border bg-card flex flex-col">
      <div className="flex-1 overflow-y-auto subtle-scrollbar">
        <Group
          label={t("git.section.local")}
          count={local.length}
          open={openLocal}
          onToggle={() => setOpenLocal((v) => !v)}
        >
          {local.map((b) => (
            <BranchRow
              key={`local:${b.name}`}
              branch={b}
              onCheckout={() => checkout.mutate(b.name)}
              disabled={checkout.isPending}
            />
          ))}
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
    </aside>
  );
}

function Group({
  label,
  count,
  open,
  onToggle,
  children,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border/40">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-2 h-7 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight
          className={cn("size-3 transition-transform", open && "rotate-90")}
        />
        <span className="flex-1 text-left">{label}</span>
        <span className="mono text-[10px] text-muted-foreground/70">
          {count}
        </span>
      </button>
      {open ? <div className="pb-1">{children}</div> : null}
    </div>
  );
}

function BranchRow({
  branch,
  onCheckout,
  disabled,
  remotePrefix,
}: {
  branch: GitBranchInfo;
  onCheckout: () => void;
  disabled?: boolean;
  /** remote 그룹 내부에선 prefix 빼고 short name 만 보여줌. */
  remotePrefix?: string;
}) {
  const display = remotePrefix
    ? branch.name.slice(remotePrefix.length + 1)
    : branch.name;
  return (
    <button
      type="button"
      onDoubleClick={onCheckout}
      disabled={disabled}
      className={cn(
        "group w-full flex items-center gap-1.5 pl-7 pr-2 h-7 text-[12px] mono hover:bg-muted/60 transition-colors text-left",
        branch.current && "bg-foreground/[0.06] font-semibold",
      )}
      title={branch.name + " · " + (display.length > 20 ? branch.name : "")}
    >
      <GitBranch
        className={cn(
          "size-3 shrink-0",
          branch.current ? "text-emerald-500" : "text-muted-foreground/60",
        )}
      />
      <span className="truncate flex-1">{display}</span>
      {branch.upstream && !branch.current ? (
        <span className="text-[9px] mono text-muted-foreground/60 truncate max-w-[5rem] opacity-0 group-hover:opacity-100">
          ↑{branch.upstream}
        </span>
      ) : null}
    </button>
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
