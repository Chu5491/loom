// 워킹 트리 staging — 좌측 변경 파일 + 우측 diff + 하단 커밋 메시지.
//
// 컴팩트 사이드 패널(GitTab) 의 status 모드와 데이터/뮤테이션은 동일.
// 풀 페이지에선 가로폭이 넉넉해 우측에 diff 를 띄움.

import { lazy, Suspense, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Columns2, GitCommit, Minus, Plus, Rows2 } from "lucide-react";
import { toast } from "sonner";
import { api, type GitWorkingChange } from "../../api/client.js";
import { Button } from "../../components/ui/button.js";
import { Textarea } from "../../components/ui/textarea.js";
import { StatusBadge } from "../../components/git/StatusBadge.js";
import { DiffView } from "../../components/git/DiffView.js";
import { HunkDiffView } from "../../components/git/HunkDiffView.js";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";
import { basename } from "../../lib/path.js";

const MonacoDiff = lazy(() =>
  import("../../components/git/MonacoDiff.js").then((m) => ({
    default: m.MonacoDiff,
  })),
);

type DiffMode = "inline" | "split";

interface FileSelection {
  path: string;
  /** unstaged / untracked 면 false, staged 면 true. diff 페치 시 cached 플래그. */
  staged: boolean;
  /** untracked 만 별도 — diff 가 아니라 head-vs-file 형태가 필요. */
  untracked?: boolean;
}

export function WorkingTreePanel({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [message, setMessage] = useState("");
  const [picked, setPicked] = useState<FileSelection | null>(null);

  const status = useQuery({
    queryKey: ["gitStatus", projectId],
    queryFn: () => api.getGitStatus(projectId),
    refetchInterval: 5_000,
    retry: false,
  });

  const stage = useMutation({
    mutationFn: (paths: string[]) => api.gitStage(projectId, paths),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gitStatus", projectId] }),
    onError: (err) => toast.error((err as Error).message),
  });
  const unstage = useMutation({
    mutationFn: (paths: string[]) => api.gitUnstage(projectId, paths),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gitStatus", projectId] }),
    onError: (err) => toast.error((err as Error).message),
  });
  const commit = useMutation({
    mutationFn: (msg: string) => api.gitCommit(projectId, msg),
    onSuccess: () => {
      setMessage("");
      toast.success(t("git.commitDone"));
      qc.invalidateQueries({ queryKey: ["gitStatus", projectId] });
      qc.invalidateQueries({ queryKey: ["gitLog", projectId, { all: true }] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const s = status.data?.status ?? null;

  // 선택된 파일이 다음 fetch 후에 사라졌으면(스테이지/언스테이지로 카테고리 이동)
  // 자동으로 새 위치로 따라가게.
  const adjusted = useMemo(() => {
    if (!picked || !s) return picked;
    const inStaged = s.staged.find((c) => c.path === picked.path);
    const inUnstaged = s.unstaged.find((c) => c.path === picked.path);
    const inUntracked = s.untracked.includes(picked.path);
    if (picked.staged && inStaged) return picked;
    if (!picked.staged && !picked.untracked && inUnstaged) return picked;
    if (picked.untracked && inUntracked) return picked;
    if (inStaged) return { path: picked.path, staged: true };
    if (inUnstaged) return { path: picked.path, staged: false };
    if (inUntracked)
      return { path: picked.path, staged: false, untracked: true };
    return null;
  }, [picked, s]);

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
      return (
        <div className="flex-1 flex items-center justify-center px-4 text-center">
          <p className="text-xs text-muted-foreground/70 italic">
            {t("git.notRepo")}
          </p>
        </div>
      );
    }
    return (
      <div className="flex-1 flex items-center justify-center px-4 text-center text-xs text-destructive">
        {msg}
      </div>
    );
  }
  if (!s) return null;

  const stagedCount = s.staged.length;

  return (
    <div className="flex-1 min-h-0 flex">
      {/* 좌측 — staged / unstaged / untracked 그룹 */}
      <div className="w-[320px] shrink-0 border-r border-border flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto subtle-scrollbar">
          {s.clean ? (
            <p className="px-3 py-4 text-xs text-muted-foreground/70 italic">
              {t("git.cleanTree")}
            </p>
          ) : (
            <>
              {s.staged.length > 0 ? (
                <FileGroup
                  label={t("git.section.staged")}
                  count={s.staged.length}
                  onAllAction={() =>
                    unstage.mutate(s.staged.map((c) => c.path))
                  }
                  allLabel={t("git.unstageAll")}
                >
                  {s.staged.map((c) => (
                    <FileRow
                      key={`staged:${c.path}`}
                      change={c}
                      staged
                      selected={
                        adjusted?.path === c.path && adjusted.staged === true
                      }
                      onSelect={() =>
                        setPicked({ path: c.path, staged: true })
                      }
                      onAction={() => unstage.mutate([c.path])}
                    />
                  ))}
                </FileGroup>
              ) : null}
              {s.unstaged.length > 0 ? (
                <FileGroup
                  label={t("git.section.unstaged")}
                  count={s.unstaged.length}
                  onAllAction={() =>
                    stage.mutate(s.unstaged.map((c) => c.path))
                  }
                  allLabel={t("git.stageAll")}
                >
                  {s.unstaged.map((c) => (
                    <FileRow
                      key={`unstaged:${c.path}`}
                      change={c}
                      selected={
                        adjusted?.path === c.path &&
                        adjusted.staged === false &&
                        !adjusted.untracked
                      }
                      onSelect={() =>
                        setPicked({ path: c.path, staged: false })
                      }
                      onAction={() => stage.mutate([c.path])}
                    />
                  ))}
                </FileGroup>
              ) : null}
              {s.untracked.length > 0 ? (
                <FileGroup
                  label={t("git.section.untracked")}
                  count={s.untracked.length}
                  onAllAction={() => stage.mutate(s.untracked)}
                  allLabel={t("git.stageAll")}
                >
                  {s.untracked.map((p) => (
                    <FileRow
                      key={`untracked:${p}`}
                      change={{ path: p, status: "?" }}
                      untracked
                      selected={
                        adjusted?.path === p && adjusted.untracked === true
                      }
                      onSelect={() =>
                        setPicked({ path: p, staged: false, untracked: true })
                      }
                      onAction={() => stage.mutate([p])}
                    />
                  ))}
                </FileGroup>
              ) : null}
              {s.conflicted.length > 0 ? (
                <FileGroup label={t("git.section.conflicts")} count={s.conflicted.length}>
                  {s.conflicted.map((p) => (
                    <FileRow
                      key={`conflict:${p}`}
                      change={{ path: p, status: "U" }}
                      conflicted
                      selected={false}
                    />
                  ))}
                </FileGroup>
              ) : null}
            </>
          )}
        </div>

        {/* 커밋 메시지 + Commit 버튼 */}
        <div className="border-t border-border p-2 shrink-0 space-y-1.5 bg-card">
          <Textarea
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("git.commitPlaceholder")}
            disabled={stagedCount === 0}
            className="text-[12px] mono resize-none"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground/70 mono">
              {stagedCount > 0
                ? t("git.commitReady", { count: stagedCount })
                : t("git.commitNothing")}
            </span>
            <Button
              size="sm"
              onClick={() => commit.mutate(message.trim())}
              disabled={
                stagedCount === 0 || !message.trim() || commit.isPending
              }
            >
              <GitCommit className="size-3.5 mr-1" />
              {t("git.commit")}
            </Button>
          </div>
        </div>
      </div>

      {/* 우측 — 선택 파일 diff */}
      <div className="flex-1 min-w-0 flex flex-col">
        {adjusted ? (
          <FileDiffView projectId={projectId} selection={adjusted} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground/70 italic px-4 text-center">
            {t("git.pickFileForDiff")}
          </div>
        )}
      </div>
    </div>
  );
}

function FileGroup({
  label,
  count,
  onAllAction,
  allLabel,
  children,
}: {
  label: string;
  count: number;
  onAllAction?: () => void;
  allLabel?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-border/40">
      <div className="flex items-center pl-2 pr-2 h-7 text-[10px] uppercase tracking-wider text-muted-foreground select-none">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 flex-1 hover:text-foreground transition-colors"
        >
          <ChevronRight
            className={cn("size-3 transition-transform", open && "rotate-90")}
          />
          <span>{label}</span>
          <span className="mono text-[10px] text-muted-foreground/70">{count}</span>
        </button>
        {onAllAction && allLabel ? (
          <button
            type="button"
            onClick={onAllAction}
            className="text-[10px] mono text-muted-foreground hover:text-foreground transition-colors"
          >
            {allLabel}
          </button>
        ) : null}
      </div>
      {open ? <div>{children}</div> : null}
    </div>
  );
}

function FileRow({
  change,
  staged,
  untracked,
  conflicted,
  selected,
  onSelect,
  onAction,
}: {
  change: Pick<GitWorkingChange, "path" | "status" | "fromPath">;
  staged?: boolean;
  untracked?: boolean;
  conflicted?: boolean;
  selected: boolean;
  onSelect?: () => void;
  onAction?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      onClick={onSelect}
      className={cn(
        "group flex items-center gap-1.5 pl-7 pr-2 h-7 text-[11px] mono transition-colors",
        onSelect && "cursor-pointer",
        selected
          ? "bg-foreground/[0.08]"
          : onSelect && "hover:bg-muted/60",
      )}
      title={change.path}
    >
      <StatusBadge code={change.status} untracked={untracked} />
      <span className="truncate flex-1">{basename(change.path)}</span>
      <span className="text-muted-foreground/60 truncate text-[10px] max-w-[8rem]">
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
          {staged ? <Minus className="size-3" /> : <Plus className="size-3" />}
        </button>
      ) : null}
    </div>
  );
}

function FileDiffView({
  projectId,
  selection,
}: {
  projectId: string;
  selection: FileSelection;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [mode, setMode] = useState<DiffMode>("inline");

  const diff = useQuery({
    queryKey: [
      "gitDiff",
      projectId,
      selection.path,
      selection.staged,
      selection.untracked,
    ],
    queryFn: () =>
      api.getGitDiff(projectId, selection.path, {
        staged: selection.staged,
        untracked: selection.untracked,
      }),
    retry: false,
  });

  const sides = useQuery({
    queryKey: [
      "gitSides",
      projectId,
      selection.path,
      selection.staged,
      selection.untracked,
    ],
    queryFn: () =>
      api.getGitSides(projectId, selection.path, {
        staged: selection.staged,
        untracked: selection.untracked,
      }),
    enabled: mode === "split",
    retry: false,
  });

  const applyHunk = useMutation({
    mutationFn: (input: { patch: string; cached: true; reverse: boolean }) =>
      api.gitApplyPatch(projectId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gitStatus", projectId] });
      qc.invalidateQueries({
        queryKey: ["gitDiff", projectId, selection.path],
      });
      qc.invalidateQueries({
        queryKey: ["gitSides", projectId, selection.path],
      });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-2 h-8 px-3 border-b border-border/50 bg-muted/30 shrink-0 mono text-[11px]">
        <span className="font-semibold truncate flex-1">{selection.path}</span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
          {selection.untracked
            ? t("git.untracked")
            : selection.staged
              ? t("git.staged")
              : t("git.unstaged")}
        </span>
        <div className="flex items-center rounded border border-border/60 overflow-hidden">
          <button
            type="button"
            onClick={() => setMode("inline")}
            title={t("git.diffMode.inline")}
            className={cn(
              "inline-flex items-center justify-center size-6 transition-colors",
              mode === "inline"
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/60",
            )}
          >
            <Rows2 className="size-3" />
          </button>
          <button
            type="button"
            onClick={() => setMode("split")}
            title={t("git.diffMode.split")}
            className={cn(
              "inline-flex items-center justify-center size-6 transition-colors",
              mode === "split"
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/60",
            )}
          >
            <Columns2 className="size-3" />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {mode === "split" ? (
          sides.isLoading ? (
            <p className="px-3 py-4 text-xs text-muted-foreground italic">
              {t("common.loading")}
            </p>
          ) : sides.isError ? (
            <p className="px-3 py-4 text-xs text-destructive">
              {(sides.error as Error).message}
            </p>
          ) : (
            <Suspense
              fallback={
                <p className="px-3 py-4 text-xs text-muted-foreground italic">
                  {t("common.loading")}
                </p>
              }
            >
              <MonacoDiff
                original={sides.data?.before ?? ""}
                modified={sides.data?.after ?? ""}
                path={selection.path}
              />
            </Suspense>
          )
        ) : diff.isLoading ? (
          <p className="px-3 py-4 text-xs text-muted-foreground italic">
            {t("common.loading")}
          </p>
        ) : diff.isError ? (
          <p className="px-3 py-4 text-xs text-destructive">
            {(diff.error as Error).message}
          </p>
        ) : selection.untracked ? (
          <DiffView text={diff.data?.diff ?? ""} />
        ) : (
          <HunkDiffView
            text={diff.data?.diff ?? ""}
            staged={selection.staged}
            disableHunkActions={applyHunk.isPending}
            onApplyHunk={(input) => applyHunk.mutate(input)}
          />
        )}
      </div>
    </div>
  );
}
