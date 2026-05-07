// run 의 변경 파일을 PR 리뷰 풍으로 보여주는 컴포넌트.
//
// 각 파일이 collapsible 카드로 — 헤더(상태 아이콘 + 경로 + +N -M) + 본문(unified
// diff). 본문은 lazy: 펼쳐질 때 처음 fetch.
//
// 이전엔 ReviewPage 가 자기 안에 가지고 있던 로직 — RunDetailPage 와 통합되면서
// 공유 컴포넌트로 추출. ChangedFiles (chat message 의 컴팩트 카드) 와는 다른
// 결: 여기는 풀 페이지에 어울리는 "리뷰" 모드.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  FileEdit,
  FilePlus,
  FileX,
  Replace,
} from "lucide-react";
import type { RunChange } from "@loom/core";
import { api } from "../api/client.js";
import { DiffView } from "./git/DiffView.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";
import { emit } from "../lib/loomEvents.js";

export function RunChangesBrowser({
  runId,
  /** 종료된 run 이라야 fetch — 진행 중엔 diff 가 매 순간 변하니까. */
  enabled = true,
}: {
  runId: string;
  enabled?: boolean;
}) {
  const { t } = useI18n();
  const changes = useQuery({
    queryKey: ["run", runId, "changes"],
    queryFn: () => api.getRunChanges(runId),
    enabled,
    staleTime: 60_000,
  });

  if (!enabled || changes.isLoading) return null;
  const list = changes.data?.changes ?? [];
  if (list.length === 0) return null;

  const totals = list.reduce(
    (acc, c) => ({
      add: acc.add + c.additions,
      del: acc.del + c.deletions,
    }),
    { add: 0, del: 0 },
  );

  return (
    <section className="rounded-lg border border-border bg-card overflow-hidden">
      <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/60 bg-muted/20">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          {t("changes.title")}
          <span className="text-[11px] text-muted-foreground/70 mono">
            {list.length}
          </span>
        </h2>
        <span className="text-[11px] mono">
          <span className="text-success">+{totals.add}</span>
          <span className="ml-2 text-rose-600 dark:text-rose-400">
            −{totals.del}
          </span>
        </span>
      </header>
      <ul className="divide-y divide-border/40">
        {list.map((c) => (
          <li key={`${c.status}:${c.path}`}>
            <ChangeBlock runId={runId} change={c} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ChangeBlock({
  runId,
  change,
}: {
  runId: string;
  change: RunChange;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const patch = useQuery({
    queryKey: ["run", runId, "patch", change.path],
    queryFn: () => api.getRunPatch(runId, change.path),
    enabled: open,
    staleTime: 60_000,
  });

  const openInViewer = () => emit("openFile", { path: change.path });

  return (
    <div className="overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/20 group">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-left flex-1 min-w-0"
        >
          {open ? (
            <ChevronDown className="size-3 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="size-3 text-muted-foreground shrink-0" />
          )}
          <StatusIcon status={change.status} />
          <span className="mono text-xs truncate">
            {change.fromPath ? (
              <>
                <span className="text-muted-foreground">{change.fromPath}</span>
                <span className="text-muted-foreground/60"> → </span>
                {change.path}
              </>
            ) : (
              change.path
            )}
          </span>
        </button>
        <span className="text-success mono text-xs shrink-0">
          +{change.additions}
        </span>
        <span className="text-rose-600 dark:text-rose-400 mono text-xs shrink-0">
          −{change.deletions}
        </span>
        <button
          type="button"
          onClick={openInViewer}
          title={t("changes.openInViewer")}
          className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        >
          <ArrowUpRight className="size-3" />
        </button>
      </div>
      {open ? (
        <div className="border-t border-border/40 max-h-[60vh] overflow-auto">
          {patch.isLoading ? (
            <p className="px-3 py-4 text-xs text-muted-foreground italic">
              {t("common.loading")}
            </p>
          ) : patch.isError ? (
            <p className="px-3 py-4 text-xs text-destructive">
              {(patch.error as Error)?.message ?? "error"}
            </p>
          ) : (
            <DiffView text={patch.data ?? ""} />
          )}
        </div>
      ) : null}
    </div>
  );
}

function StatusIcon({ status }: { status: RunChange["status"] }) {
  const cls = "size-3 shrink-0";
  switch (status) {
    case "added":
      return <FilePlus className={cn(cls, "text-success")} />;
    case "deleted":
      return <FileX className={cn(cls, "text-rose-600 dark:text-rose-400")} />;
    case "renamed":
      return <Replace className={cn(cls, "text-sky-600 dark:text-sky-400")} />;
    case "modified":
    default:
      return <FileEdit className={cn(cls, "text-warning")} />;
  }
}
