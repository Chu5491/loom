// 풀 페이지 git 관리 — SourceTree 풍 3-pane 레이아웃.
//
//   ┌──────────┬──────────────────────────────────────────────┐
//   │ toolbar (branch + ahead/behind + fetch/pull/push)       │
//   ├──────────┬──────────────────────────────────────────────┤
//   │ branches │ commit graph (top half)                      │
//   │ (220px)  ├──────────────────────────────────────────────┤
//   │          │ working tree | selected commit (bottom half) │
//   │          │   files list | diff view                     │
//   └──────────┴──────────────────────────────────────────────┘
//
// 사이드 패널의 GitTab 은 그대로 유지 (컴팩트 staging). 이 페이지는 풀 너비
// 깃 워크플로우 — 브랜치/원격/그래프/커밋 디테일까지 한 화면에서.

import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  GitBranch,
  GitPullRequest,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "../api/client.js";
import { Button } from "../components/ui/button.js";
import { CommitGraph } from "../components/git/CommitGraph.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";
import { WorkingTreePanel } from "./git/WorkingTreePanel.js";
import { CommitDetailPanel } from "./git/CommitDetailPanel.js";
import { CreatePrDialog } from "./git/CreatePrDialog.js";

export function GitPage() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();

  // 그래프에서 클릭한 커밋. null 이면 "Working tree" 모드 (기본).
  const [selectedSha, setSelectedSha] = useState<string | null>(null);

  // 그래프 fetch — sidebar 의 GitTab 도 같은 queryKey 라 결과 공유.
  const log = useQuery({
    queryKey: ["gitLog", projectId, { all: true }],
    queryFn: () => api.getGitLog(projectId!, { limit: 200, all: true }),
    enabled: !!projectId,
    refetchInterval: 30_000,
    retry: false,
  });

  if (!projectId) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t("git.noProject")}
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-background">
      <Toolbar projectId={projectId} />
      {/* 단일 사이드바 룰 — BranchTree + Stash 는 ActivityPanel 의 GitTab 으로
          이전. GitPage 메인 = 그래프 + 선택 디테일/워킹트리. 풀 width 사용. */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* 상단 — 커밋 그래프. 절반 높이. */}
        <div className="flex-1 min-h-0 border-b border-border flex flex-col">
          <SectionHeader label={t("git.section.history")} />
          <GraphArea
            entries={log.data?.entries ?? []}
            isLoading={log.isLoading}
            error={log.error as Error | null}
            selectedSha={selectedSha}
            onSelect={(sha) =>
              setSelectedSha((curr) => (curr === sha ? null : sha))
            }
          />
        </div>
        {/* 하단 — 선택 커밋 디테일 또는 워킹 트리 staging. */}
        <div className="flex-1 min-h-0 flex flex-col">
          <SectionHeader
            label={
              selectedSha
                ? t("git.section.commitChanges")
                : t("git.section.workingTree")
            }
          />
          {/* 같은 커밋을 다시 클릭하면 deselect — 그래프의 토글 동작이
              explicit "back" 버튼을 redundant 하게 만듬. */}
          {selectedSha ? (
            <CommitDetailPanel projectId={projectId} sha={selectedSha} />
          ) : (
            <WorkingTreePanel projectId={projectId} />
          )}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center h-8 px-3 border-b border-border/50 bg-muted/30 shrink-0 select-none">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function GraphArea({
  entries,
  isLoading,
  error,
  selectedSha,
  onSelect,
}: {
  entries: ReturnType<
    typeof api.getGitLog
  > extends Promise<{ entries: infer E }>
    ? E
    : never;
  isLoading: boolean;
  error: Error | null;
  selectedSha: string | null;
  onSelect: (sha: string) => void;
}) {
  const { t } = useI18n();
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }
  if (error) {
    const msg = error.message;
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
  if (entries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 text-center">
        <p className="text-xs text-muted-foreground/70 italic">
          {t("git.emptyHistory")}
        </p>
      </div>
    );
  }
  return (
    <CommitGraph
      entries={entries}
      selectedSha={selectedSha}
      onSelect={onSelect}
      extraColumns
    />
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Toolbar — 브랜치 + ahead/behind + fetch/pull/push + refresh

function Toolbar({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [prOpen, setPrOpen] = useState(false);

  const status = useQuery({
    queryKey: ["gitStatus", projectId],
    queryFn: () => api.getGitStatus(projectId),
    refetchInterval: 5_000,
    retry: false,
  });

  // gh 설치 여부는 한 번만 — installed=false 면 PR 버튼 숨김. probe 가 가벼워서 함께 돌려도 됨.
  const ghProbe = useQuery({
    queryKey: ["ghProbe", projectId],
    queryFn: () => api.gitProbeGh(projectId),
    staleTime: 5 * 60_000,
    retry: false,
  });

  // remote ops 의 결과는 toast 로 — stderr 가 진행 메시지(있으면) 라 사용자가
  // 확인할 수 있게 직접 보여줌.
  const fetchOp = useMutation({
    mutationFn: () => api.gitFetch(projectId, { prune: true }),
    onSuccess: (r) => {
      toast.success(r.output?.trim() || t("git.fetchDone"));
      invalidateAll(qc, projectId);
    },
    onError: (err) => toast.error((err as Error).message),
  });
  const pullOp = useMutation({
    mutationFn: () => api.gitPull(projectId, {}),
    onSuccess: (r) => {
      toast.success(r.output?.trim() || t("git.pullDone"));
      invalidateAll(qc, projectId);
    },
    onError: (err) => toast.error((err as Error).message),
  });
  const pushOp = useMutation({
    mutationFn: () => api.gitPush(projectId, {}),
    onSuccess: (r) => {
      toast.success(r.output?.trim() || t("git.pushDone"));
      invalidateAll(qc, projectId);
    },
    // upstream 없는 브랜치 push 실패 시 사용자에게 setUpstream 옵션 안내 — UI
    // 토글로 빼는 건 다음 단계. 지금은 메시지로.
    onError: (err) => toast.error((err as Error).message),
  });

  const s = status.data?.status ?? null;
  const branch = s?.branch ?? s?.head ?? t("git.detached");
  const ahead = s?.ahead ?? 0;
  const behind = s?.behind ?? 0;

  const busy = fetchOp.isPending || pullOp.isPending || pushOp.isPending;

  return (
    <div className="flex items-center gap-2 h-12 px-3 border-b border-border bg-card shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <GitBranch className="size-4 text-muted-foreground shrink-0" />
        <span className="mono text-sm font-semibold truncate">{branch}</span>
        {(ahead > 0 || behind > 0) ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] mono text-muted-foreground shrink-0">
            {behind > 0 ? (
              <span className="inline-flex items-center gap-0.5">
                <ArrowDownToLine className="size-3" />
                {behind}
              </span>
            ) : null}
            {ahead > 0 ? (
              <span className="inline-flex items-center gap-0.5">
                <ArrowUpFromLine className="size-3" />
                {ahead}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        {ghProbe.data?.installed ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => setPrOpen(true)}
              disabled={busy}
              title={ghProbe.data.version}
            >
              <GitPullRequest className="size-3.5" />
              {t("git.pr.button")}
            </Button>
            <CreatePrDialog
              open={prOpen}
              onOpenChange={setPrOpen}
              projectId={projectId}
              currentBranch={s?.branch ?? null}
            />
            <span className="mx-1 h-5 w-px bg-border/60" aria-hidden />
          </>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => fetchOp.mutate()}
          disabled={busy}
        >
          <RefreshCw
            className={cn("size-3.5", fetchOp.isPending && "animate-spin")}
          />
          {t("git.fetch")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => pullOp.mutate()}
          disabled={busy}
        >
          <ArrowDownToLine
            className={cn("size-3.5", pullOp.isPending && "animate-pulse")}
          />
          {t("git.pull")}
          {behind > 0 ? (
            <span className="text-[10px] mono text-muted-foreground">
              {behind}
            </span>
          ) : null}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => pushOp.mutate()}
          disabled={busy}
        >
          <ArrowUpFromLine
            className={cn("size-3.5", pushOp.isPending && "animate-pulse")}
          />
          {t("git.push")}
          {ahead > 0 ? (
            <span className="text-[10px] mono text-muted-foreground">
              {ahead}
            </span>
          ) : null}
        </Button>
      </div>
    </div>
  );
}

function invalidateAll(
  qc: ReturnType<typeof useQueryClient>,
  projectId: string,
): void {
  qc.invalidateQueries({ queryKey: ["gitStatus", projectId] });
  qc.invalidateQueries({ queryKey: ["gitLog", projectId, { all: true }] });
  qc.invalidateQueries({ queryKey: ["gitBranches", projectId] });
}
