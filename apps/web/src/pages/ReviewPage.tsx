// Review 풀 페이지 — *선택된* 리뷰 한 건의 디테일만.
//
// 리스트는 사이드 ActivityPanel 의 ReviewTab 이 담당. 페이지 자체는 컨텐츠
// 영역을 통째로 한 리뷰 상세에 쓰고, 선택은 URL `?runId=` 으로 주고받음.
// 이전엔 페이지 안에 자기 사이드바를 또 두어서 rail + activity panel + 자기
// 사이드바의 3단 nav 가 메인 컨텐츠를 압박하던 걸 정리.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  FileEdit,
  FilePlus,
  FileX,
  MessageSquareReply,
  Replace,
} from "lucide-react";
import type { RunChange } from "@loom/core";
import { api } from "../api/client.js";
import { AgentAvatar } from "../components/chat/index.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { useI18n } from "../context/I18nContext.js";
import { agentColorOf, classesFor } from "../components/agentColor.js";
import { cn } from "../lib/utils.js";
import { formatTimeAgo } from "../lib/timeAgo.js";
import { emit } from "../lib/loomEvents.js";

export function ReviewPage() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const runId = searchParams.get("runId");

  if (!projectId) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t("activity.requiresProject")}
      </div>
    );
  }

  if (!runId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-2">
        <h2 className="text-lg font-semibold tracking-tight">
          {t("review.title")}
        </h2>
        <p className="text-sm text-muted-foreground/80 max-w-md">
          {t("review.pickFromSidebar")}
        </p>
      </div>
    );
  }

  return <SelectedReview projectId={projectId} runId={runId} />;
}

function SelectedReview({
  projectId,
  runId,
}: {
  projectId: string;
  runId: string;
}) {
  const { t } = useI18n();

  const run = useQuery({
    queryKey: ["run", runId],
    queryFn: () => api.getRun(runId),
    staleTime: 60_000,
  });
  const changes = useQuery({
    queryKey: ["run", runId, "changes"],
    queryFn: () => api.getRunChanges(runId),
    staleTime: 60_000,
  });
  const agents = useQuery({
    queryKey: ["agents", { projectId }],
    queryFn: () => api.listAgents({ projectId }),
  });
  const adapters = useQuery({
    queryKey: ["adapters"],
    queryFn: api.listAdapters,
  });

  if (run.isLoading || changes.isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }
  if (run.isError || !run.data) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-destructive">
        {(run.error as Error)?.message ?? t("review.empty")}
      </div>
    );
  }

  const r = run.data.run;
  const changeList = changes.data?.changes ?? [];
  const agent = (agents.data?.agents ?? []).find((a) => a.id === r.agentId);
  const manifest = agent
    ? (adapters.data?.adapters ?? []).find((m) => m.kind === agent.adapterKind)
    : undefined;
  const cls = agent ? classesFor(agentColorOf(agent)) : null;
  const totals = changeList.reduce(
    (acc, c) => ({ add: acc.add + c.additions, del: acc.del + c.deletions }),
    { add: 0, del: 0 },
  );

  const discuss = () => emit("jumpToRun", { runId: r.id });
  const openFirst = () => {
    const first = changeList[0];
    if (first) emit("openFile", { path: first.path });
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="px-6 py-4 border-b border-border shrink-0 max-w-5xl w-full mx-auto">
        <div className="flex items-start gap-3">
          {agent ? (
            <AgentAvatar agent={agent} manifest={manifest} />
          ) : (
            <span className="size-9 rounded-full bg-muted" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span
                className={cn(
                  "text-sm font-semibold",
                  cls?.text ?? "text-foreground",
                )}
              >
                @{agent?.name ?? "unknown"}
              </span>
              <span className="text-xs text-muted-foreground/70 mono">
                {formatTimeAgo(r.createdAt, t)}
              </span>
              <Badge variant="success" className="h-4 px-1.5 text-[9px]">
                {r.status}
              </Badge>
              <span className="text-[11px] text-muted-foreground mono ml-auto">
                {t(
                  changeList.length === 1
                    ? "review.fileCount.one"
                    : "review.fileCount.many",
                  { count: changeList.length },
                )}
                {" · "}
                <span className="text-success ml-1">+{totals.add}</span>
                <span className="text-rose-600 dark:text-rose-400 ml-1">
                  −{totals.del}
                </span>
              </span>
            </div>
            <p className="mt-1 text-sm text-foreground/90 break-words">
              {r.prompt}
            </p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={discuss} className="gap-1.5">
            <MessageSquareReply className="size-3.5" />
            {t("review.discuss")}
          </Button>
          <Button variant="ghost" size="sm" onClick={openFirst} className="gap-1.5">
            <ArrowUpRight className="size-3.5" />
            {t("review.openFirst")}
          </Button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto subtle-scrollbar p-6 max-w-5xl w-full mx-auto">
        {changeList.length === 0 ? (
          <p className="text-sm text-muted-foreground italic text-center py-8">
            {t("review.noChanges")}
          </p>
        ) : (
          <ul className="space-y-3">
            {changeList.map((c) => (
              <li key={`${c.status}:${c.path}`}>
                <ChangeBlock runId={r.id} change={c} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ChangeBlock({ runId, change }: { runId: string; change: RunChange }) {
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
    <div className="rounded-md border border-border/60 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/30">
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
          className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        >
          <ArrowUpRight className="size-3" />
        </button>
      </div>
      {open ? (
        <div className="p-2">
          {patch.isLoading ? (
            <p className="px-2 py-1 text-xs text-muted-foreground italic">…</p>
          ) : patch.isError ? (
            <p className="px-2 py-1 text-xs text-destructive">
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

function DiffView({ text }: { text: string }) {
  const { t } = useI18n();
  const hunkStart = text.indexOf("\n@@");
  const body = hunkStart >= 0 ? text.slice(hunkStart + 1) : "";
  if (!body.trim()) {
    return (
      <p className="px-2 py-1 text-xs text-muted-foreground italic">
        {t("review.noTextDiff")}
      </p>
    );
  }
  const lines = body.split("\n");
  return (
    <pre className="overflow-x-auto rounded border border-border/60 bg-background mono text-[11px] leading-relaxed">
      <code className="block">
        {lines.map((line, i) => {
          if (!line) return <span key={i} className="block">&nbsp;</span>;
          const ch = line[0];
          let className = "block px-2 py-px";
          if (ch === "+") {
            className += " bg-emerald-500/10 text-success";
          } else if (ch === "-") {
            className += " bg-rose-500/10 text-rose-700 dark:text-rose-300";
          } else if (ch === "@") {
            className += " bg-sky-500/10 text-sky-700 dark:text-sky-300";
          } else {
            className += " text-muted-foreground";
          }
          return (
            <span key={i} className={className}>
              {line || " "}
            </span>
          );
        })}
      </code>
    </pre>
  );
}
