// Git 활동 패널 — 사이드 컴팩트 staging.
//
// 그래프 / 커밋 디테일 / 브랜치 트리 같은 풀 워크플로우는 GitPage(메인 화면)
// 가 담당. 사이드 패널은 워킹 트리 변경 + 메시지 작성 + Commit 같은 빠른
// 동작에 집중 — 코드 짜다가 잠깐 staging 만 손보고 싶을 때 메인 화면 안 떠나도
// 되게.

import { useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import {
  ChevronRight,
  GitCommit,
  Plus,
  Minus,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type GitStatus,
  type GitWorkingChange,
} from "../../api/client.js";
import { Button } from "../ui/button.js";
import { Textarea } from "../ui/textarea.js";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";
import { basename } from "../../lib/path.js";
import { emit } from "../../lib/loomEvents.js";
import { NoProjectState, PanelHeader } from "./shared.js";

export function GitTab() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();

  if (!projectId) {
    return (
      <>
        <PanelHeader title={t("activity.git")} />
        <NoProjectState message={t("git.noProject")} />
      </>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PanelHeader title={t("activity.git")} />
      <StatusView projectId={projectId} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Status

function StatusView({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [message, setMessage] = useState("");

  const status = useQuery({
    queryKey: ["gitStatus", projectId],
    queryFn: () => api.getGitStatus(projectId),
    refetchInterval: 5_000,
    retry: false,
  });

  const stage = useMutation({
    mutationFn: (paths: string[]) => api.gitStage(projectId, paths),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["gitStatus", projectId] }),
    onError: (err) => toast.error((err as Error).message),
  });
  const unstage = useMutation({
    mutationFn: (paths: string[]) => api.gitUnstage(projectId, paths),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["gitStatus", projectId] }),
    onError: (err) => toast.error((err as Error).message),
  });
  const commit = useMutation({
    mutationFn: (msg: string) => api.gitCommit(projectId, msg),
    onSuccess: () => {
      setMessage("");
      toast.success(t("git.commitDone"));
      qc.invalidateQueries({ queryKey: ["gitStatus", projectId] });
      qc.invalidateQueries({ queryKey: ["gitLog", projectId] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  if (status.isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }
  if (status.isError) {
    const msg = (status.error as Error).message;
    if (msg.includes("not_a_git_repo")) {
      return <EmptyHint message={t("git.notRepo")} />;
    }
    return (
      <div className="flex-1 flex items-center justify-center px-4 text-center text-xs text-destructive">
        {msg}
      </div>
    );
  }

  const s = status.data!.status;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <BranchHeader status={s} />
      <div className="flex-1 min-h-0 overflow-y-auto subtle-scrollbar">
        {s.clean ? (
          <EmptyHint message={t("git.cleanTree")} />
        ) : (
          <>
            {s.staged.length > 0 ? (
              <Group label={t("git.section.staged")}>
                {s.staged.map((c) => (
                  <FileRow
                    key={`staged:${c.path}`}
                    change={c}
                    staged
                    onAction={() => unstage.mutate([c.path])}
                  />
                ))}
              </Group>
            ) : null}
            {s.unstaged.length > 0 ? (
              <Group label={t("git.section.unstaged")}>
                {s.unstaged.map((c) => (
                  <FileRow
                    key={`unstaged:${c.path}`}
                    change={c}
                    onAction={() => stage.mutate([c.path])}
                  />
                ))}
              </Group>
            ) : null}
            {s.untracked.length > 0 ? (
              <Group label={t("git.section.untracked")}>
                {s.untracked.map((p) => (
                  <FileRow
                    key={`untracked:${p}`}
                    change={{ path: p, status: "?" }}
                    untracked
                    onAction={() => stage.mutate([p])}
                  />
                ))}
              </Group>
            ) : null}
            {s.conflicted.length > 0 ? (
              <Group label={t("git.section.conflicts")}>
                {s.conflicted.map((p) => (
                  <FileRow
                    key={`conflict:${p}`}
                    change={{ path: p, status: "U" }}
                    conflicted
                  />
                ))}
              </Group>
            ) : null}
          </>
        )}
      </div>
      <div className="border-t border-border p-2 shrink-0 space-y-1.5">
        <Textarea
          rows={2}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t("git.commitPlaceholder")}
          disabled={s.staged.length === 0}
          className="text-[12px] mono resize-none"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground/70 mono">
            {s.staged.length > 0
              ? t("git.commitReady", { count: s.staged.length })
              : t("git.commitNothing")}
          </span>
          <Button
            size="sm"
            onClick={() => commit.mutate(message.trim())}
            disabled={
              s.staged.length === 0 ||
              !message.trim() ||
              commit.isPending
            }
          >
            <GitCommit className="size-3.5 mr-1" />
            {t("git.commit")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function BranchHeader({ status }: { status: GitStatus }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["gitStatus"] });
    qc.invalidateQueries({ queryKey: ["gitLog"] });
  };
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60 shrink-0">
      <span className="inline-flex items-center gap-1.5 mono text-[12px] truncate">
        <span className="text-muted-foreground">⎇</span>
        <span className="font-semibold truncate">
          {status.branch ?? status.head ?? t("git.detached")}
        </span>
      </span>
      {status.ahead !== null && (status.ahead > 0 || status.behind! > 0) ? (
        <span className="inline-flex items-center gap-1 text-[10px] mono text-muted-foreground">
          {status.ahead > 0 ? <span>↑{status.ahead}</span> : null}
          {status.behind! > 0 ? <span>↓{status.behind}</span> : null}
        </span>
      ) : null}
      <button
        type="button"
        onClick={refresh}
        className="ml-auto inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        title={t("common.refresh")}
        aria-label={t("common.refresh")}
      >
        <RefreshCw className="size-3.5" />
      </button>
    </div>
  );
}

function Group({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-border/40">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1.5 px-3 h-7 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight
          className={cn(
            "size-3 transition-transform",
            open && "rotate-90",
          )}
        />
        <span>{label}</span>
      </button>
      {open ? <div>{children}</div> : null}
    </div>
  );
}

function FileRow({
  change,
  staged,
  untracked,
  conflicted,
  onAction,
}: {
  change: Pick<GitWorkingChange, "path" | "status" | "fromPath">;
  staged?: boolean;
  untracked?: boolean;
  conflicted?: boolean;
  onAction?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="group flex items-center gap-1.5 pl-7 pr-2 h-7 text-[11px] mono hover:bg-muted/60 transition-colors cursor-pointer"
      onClick={() => emit("openFile", { path: change.path })}
      title={change.path}
    >
      <StatusBadge code={change.status} untracked={untracked} />
      <span className="truncate flex-1">{basename(change.path)}</span>
      <span className="text-muted-foreground/60 truncate text-[10px]">
        {change.path !== basename(change.path)
          ? change.path.slice(0, change.path.length - basename(change.path).length - 1)
          : ""}
      </span>
      {!conflicted && onAction ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAction();
          }}
          className="opacity-0 group-hover:opacity-100 inline-flex size-5 items-center justify-center rounded hover:bg-foreground/10 transition-opacity shrink-0"
          title={staged ? t("git.unstage") : t("git.stage")}
          aria-label={staged ? t("git.unstage") : t("git.stage")}
        >
          {staged ? (
            <Minus className="size-3" />
          ) : (
            <Plus className="size-3" />
          )}
        </button>
      ) : null}
    </div>
  );
}

function StatusBadge({
  code,
  untracked,
}: {
  code: string;
  untracked?: boolean;
}) {
  // 색은 git 관습 — A/?: 초록, M: 노랑, D: 빨강, R/C: 파랑.
  const color = untracked
    ? "text-emerald-600 dark:text-emerald-400"
    : code === "A"
      ? "text-emerald-600 dark:text-emerald-400"
      : code === "M"
        ? "text-amber-600 dark:text-amber-400"
        : code === "D"
          ? "text-rose-600 dark:text-rose-400"
          : code === "R" || code === "C"
            ? "text-sky-600 dark:text-sky-400"
            : code === "U"
              ? "text-rose-700 dark:text-rose-300 font-bold"
              : "text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex size-4 items-center justify-center mono text-[10px] shrink-0",
        color,
      )}
    >
      {untracked ? "U" : code}
    </span>
  );
}

function EmptyHint({ message }: { message: string }) {
  return (
    <div className="flex-1 flex items-center justify-center px-4 text-center">
      <p className="text-xs text-muted-foreground/70 italic">{message}</p>
    </div>
  );
}

