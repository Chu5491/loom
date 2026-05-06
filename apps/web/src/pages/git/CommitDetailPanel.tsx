// 선택된 커밋의 디테일 — 헤더(메타) + 좌측 changed files + 우측 file diff.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client.js";
import { StatusBadge } from "../../components/git/StatusBadge.js";
import { DiffView } from "../../components/git/DiffView.js";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";
import { basename } from "../../lib/path.js";

export function CommitDetailPanel({
  projectId,
  sha,
}: {
  projectId: string;
  sha: string;
}) {
  const { t } = useI18n();

  const info = useQuery({
    queryKey: ["gitCommit", projectId, sha],
    queryFn: () => api.getCommit(projectId, sha),
    retry: false,
  });

  const [pickedPath, setPickedPath] = useState<string | null>(null);

  // 커밋 바뀌면 첫 파일 자동 선택 — 디테일 영역이 텅 빈 채로 안 시작.
  useEffect(() => {
    const files = info.data?.commit.files ?? [];
    if (files.length > 0) setPickedPath(files[0]!.path);
    else setPickedPath(null);
  }, [info.data?.commit.sha, info.data?.commit.files]);

  if (info.isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }
  if (info.isError) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 text-center text-xs text-destructive">
        {(info.error as Error).message}
      </div>
    );
  }

  const c = info.data?.commit;
  if (!c) return null;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <CommitHeader commit={c} />
      <div className="flex-1 min-h-0 flex">
        {/* 좌측 — changed files */}
        <div className="w-[320px] shrink-0 border-r border-border overflow-y-auto subtle-scrollbar">
          {c.files.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground/70 italic">
              {t("git.commitNoChanges")}
            </p>
          ) : (
            c.files.map((f) => (
              <button
                key={f.path}
                type="button"
                onClick={() => setPickedPath(f.path)}
                className={cn(
                  "group w-full flex items-center gap-1.5 pl-2 pr-2 h-7 text-[11px] mono transition-colors text-left",
                  pickedPath === f.path
                    ? "bg-foreground/[0.08]"
                    : "hover:bg-muted/60",
                )}
                title={f.path}
              >
                <StatusBadge code={f.status} />
                <span className="truncate flex-1">{basename(f.path)}</span>
                <span className="text-muted-foreground/60 truncate text-[10px] max-w-[8rem]">
                  {f.path !== basename(f.path)
                    ? f.path.slice(
                        0,
                        f.path.length - basename(f.path).length - 1,
                      )
                    : ""}
                </span>
              </button>
            ))
          )}
        </div>

        {/* 우측 — file diff */}
        <div className="flex-1 min-w-0 flex flex-col">
          {pickedPath ? (
            <CommitFileDiff
              projectId={projectId}
              sha={sha}
              path={pickedPath}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground/70 italic px-4 text-center">
              {t("git.pickFileForDiff")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CommitHeader({
  commit,
}: {
  commit: NonNullable<
    ReturnType<typeof api.getCommit> extends Promise<{ commit: infer C }>
      ? C
      : never
  >;
}) {
  return (
    <div className="px-4 py-3 border-b border-border bg-muted/20 shrink-0">
      <div className="flex items-baseline gap-2">
        <span className="mono text-[11px] text-muted-foreground/80">
          {commit.shortSha}
        </span>
        <h2 className="text-sm font-semibold truncate flex-1">
          {commit.subject}
        </h2>
      </div>
      {commit.body.trim() ? (
        <pre className="mt-2 text-[12px] mono whitespace-pre-wrap text-muted-foreground/90 leading-relaxed">
          {commit.body.trim()}
        </pre>
      ) : null}
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground/80 mono">
        <span>
          {commit.authorName}
          {commit.authorEmail ? ` <${commit.authorEmail}>` : ""}
        </span>
        <span>·</span>
        <span>{new Date(commit.authoredAt).toLocaleString()}</span>
        {commit.parents.length > 0 ? (
          <>
            <span>·</span>
            <span>
              {commit.parents.map((p) => p.slice(0, 7)).join(" + ")}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}

function CommitFileDiff({
  projectId,
  sha,
  path,
}: {
  projectId: string;
  sha: string;
  path: string;
}) {
  const { t } = useI18n();
  const diff = useQuery({
    queryKey: ["gitCommitDiff", projectId, sha, path],
    queryFn: () => api.getCommitFileDiff(projectId, sha, path),
    retry: false,
  });

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-2 h-8 px-3 border-b border-border/50 bg-muted/30 shrink-0 mono text-[11px]">
        <span className="font-semibold truncate flex-1">{path}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {diff.isLoading ? (
          <p className="px-3 py-4 text-xs text-muted-foreground italic">
            {t("common.loading")}
          </p>
        ) : diff.isError ? (
          <p className="px-3 py-4 text-xs text-destructive">
            {(diff.error as Error).message}
          </p>
        ) : (
          <DiffView text={diff.data?.diff ?? ""} />
        )}
      </div>
    </div>
  );
}
