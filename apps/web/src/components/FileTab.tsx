import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowRight,
  Clock,
  ExternalLink,
  File,
  FileText,
  GitCommit,
  History,
  RotateCcw,
  SplitSquareHorizontal,
  WrapText,
} from "lucide-react";
import type { AdapterManifest, Agent, FileHistoryEntry } from "@loom/core";
import { api } from "../api/client.js";
import { AdapterIcon } from "./AdapterIcon.js";
import { AgentInitialBadge } from "./AgentInitialBadge.js";
import { MonacoDiff } from "./MonacoDiff.js";
import { MonacoView, type AgentPresence } from "./MonacoView.js";
import { Badge } from "./ui/badge.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";
import { formatTimeAgo } from "../lib/timeAgo.js";
import { agentColorFor, classesFor } from "./agentColor.js";

/**
 * Center-pane content shown when a file tab is active in the workspace.
 *
 * Two viewing modes for the same file:
 *
 *   - "current": the file as it lives on disk right now.
 *   - "diff @ run": the unified diff that one specific run produced for
 *     this path. Selected by clicking a row in the history rail.
 *
 * The history rail also offers a per-row "→ chat" button that bubbles up
 * via `onJumpToRun`, so the user can either *inspect the change* (stay
 * in the file context) or *visit the conversation* (switch to chat).
 * Two distinct gestures for two distinct intents.
 */
export function FileTab({
  projectId,
  path,
  presences,
  agents,
  onJumpToRun,
  adapterByKind,
  compact = false,
}: {
  projectId: string;
  path: string;
  /** 이 파일에 떠있는 모든 에이전트 presence — Monaco가 라인 데코+라벨로 표시.
   *  presences[0]가 가장 최근(primary) 활동. 비어있으면 데코 없음. */
  presences?: AgentPresence[];
  agents?: Agent[];
  onJumpToRun: (runId: string) => void;
  /** Map of adapter kind → manifest, used to render correct brand icon
   *  in the history rail. Passed in (not fetched) since the parent
   *  already has the list. */
  adapterByKind: Record<string, AdapterManifest>;
  /** 우측 dock 등 좁은 폭일 때 minimap 등 부가 UI 끔. */
  compact?: boolean;
}) {
  // Reset to "current" whenever the active file changes — staying on a
  // diff view across path changes would be confusing.
  type ViewMode = { kind: "current" } | { kind: "diff"; runId: string };
  const [view, setView] = useState<ViewMode>({ kind: "current" });
  const [wrap, setWrap] = useState(false);

  // Switching files: reset view. We key on `path` via a render-time
  // check rather than a useEffect to avoid a flash of "wrong" diff.
  const [lastPath, setLastPath] = useState(path);
  if (lastPath !== path) {
    setLastPath(path);
    if (view.kind !== "current") setView({ kind: "current" });
  }

  const primary = presences?.[0];
  const primaryAgent = primary
    ? agents?.find((a) => a.id === primary.agentId)
    : undefined;

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      {primaryAgent && primary ? (
        <EditingNowBanner agent={primaryAgent} line={primary.line} />
      ) : null}
      <ContentPane
        projectId={projectId}
        path={path}
        view={view}
        wrap={wrap}
        compact={compact}
        presences={presences}
        onToggleWrap={() => setWrap((v) => !v)}
        onResetView={() => setView({ kind: "current" })}
        onSelectDiff={(runId) => setView({ kind: "diff", runId })}
        onJumpToRun={onJumpToRun}
        activeRunId={view.kind === "diff" ? view.runId : null}
        adapterByKind={adapterByKind}
      />
    </div>
  );
}

/** Sticky "@agent is editing this right now" banner pinned to the top
 *  of the file viewer. When the server could pin the edit to a line
 *  (claude-code's old_string matched), we show ":42" so the user knows
 *  exactly *where* in the file the change is landing. */
function EditingNowBanner({ agent, line }: { agent: Agent; line?: number }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/40 shrink-0">
      <AgentInitialBadge agent={agent} live size="sm" />
      <span className="text-xs">
        <span className="font-semibold">@{agent.name}</span>
        <span className="text-muted-foreground ml-1.5">{t("editing.is")}</span>
        {line ? (
          <span className="ml-1 mono text-foreground/80">
            {t("editing.line")} <span className="font-semibold">{line}</span>
          </span>
        ) : (
          <span className="text-muted-foreground ml-1">{t("editing.now")}</span>
        )}
      </span>
      <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-success mono">
        <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
        {t("editing.live")}
      </span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Content pane — renders one of two modes
// ────────────────────────────────────────────────────────────────────────────

function ContentPane({
  projectId,
  path,
  view,
  wrap,
  compact,
  presences,
  onToggleWrap,
  onResetView,
  onSelectDiff,
  onJumpToRun,
  activeRunId,
  adapterByKind,
}: {
  projectId: string;
  path: string;
  view: { kind: "current" } | { kind: "diff"; runId: string };
  wrap: boolean;
  compact: boolean;
  presences?: AgentPresence[];
  onToggleWrap: () => void;
  onResetView: () => void;
  onSelectDiff: (runId: string) => void;
  onJumpToRun: (runId: string) => void;
  activeRunId: string | null;
  adapterByKind: Record<string, AdapterManifest>;
}) {
  return (
    <section className="flex-1 min-w-0 min-h-0 flex flex-col">
      <PaneHeader
        projectId={projectId}
        path={path}
        view={view}
        wrap={wrap}
        onToggleWrap={onToggleWrap}
        onResetView={onResetView}
        onSelectDiff={onSelectDiff}
        onJumpToRun={onJumpToRun}
        activeRunId={activeRunId}
        adapterByKind={adapterByKind}
      />
      {/* current 모드는 Monaco가 자체 스크롤(미니맵·가로/세로 스크롤바 포함)
       *  하므로 부모는 relative로 자리만 잡아준다. diff 모드는 평문 렌더라
       *  부모 컨테이너 overflow-auto가 필요. */}
      {/* current 와 diff 둘 다 Monaco 기반 → 부모는 relative + 자식이 absolute inset-0.
          Monaco 가 본인 스크롤/리사이즈 처리. */}
      <div className="flex-1 min-h-0 min-w-0 relative">
        {view.kind === "current" ? (
          <CurrentContent
            projectId={projectId}
            path={path}
            wrap={wrap}
            compact={compact}
            presences={presences}
          />
        ) : (
          <DiffContent path={path} runId={view.runId} wrap={wrap} />
        )}
      </div>
    </section>
  );
}

function PaneHeader({
  projectId,
  path,
  view,
  wrap,
  onToggleWrap,
  onResetView,
  onSelectDiff,
  onJumpToRun,
  activeRunId,
  adapterByKind,
}: {
  projectId: string;
  path: string;
  view: { kind: "current" } | { kind: "diff"; runId: string };
  wrap: boolean;
  onToggleWrap: () => void;
  onResetView: () => void;
  onSelectDiff: (runId: string) => void;
  onJumpToRun: (runId: string) => void;
  activeRunId: string | null;
  adapterByKind: Record<string, AdapterManifest>;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between px-5 py-2 border-b shrink-0 bg-muted/20">
      <div className="min-w-0 flex items-center gap-2">
        {view.kind === "diff" ? (
          <GitCommit className="size-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
        ) : (
          <FileText className="size-3.5 text-muted-foreground shrink-0" />
        )}
        <span className="text-sm mono truncate" title={path}>
          {path}
        </span>
        {view.kind === "diff" ? (
          <Badge variant="info" className="h-4 px-1.5 text-[9px] shrink-0">
            {t("files.viewer.diffMode")}
          </Badge>
        ) : null}
      </div>
      {/* 헤더 액션 — 공간 절약 위해 icon-only. hover 시 title 로 라벨 노출. */}
      <div className="flex items-center gap-0.5 shrink-0">
        <OpenInEditorButton projectId={projectId} path={path} />
        <button
          type="button"
          onClick={onToggleWrap}
          title={wrap ? t("files.viewer.wrapOff") : t("files.viewer.wrapOn")}
          aria-label={wrap ? t("files.viewer.wrapOff") : t("files.viewer.wrapOn")}
          aria-pressed={wrap}
          className={cn(
            "inline-flex size-6 items-center justify-center rounded transition-colors",
            wrap
              ? "bg-foreground/5 text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted",
          )}
        >
          <WrapText className="size-3.5" />
        </button>
        {/* Diff 빠른 토글 — 변경 이력 있는 파일이면 한 클릭에 최신 diff 로.
            View=diff 면 같은 버튼이 "현재 보기" 로 토글. 히스토리 popover 와
            중복이지만 1-click 진입이라 발견성 ↑. */}
        <DiffToggle
          projectId={projectId}
          path={path}
          view={view}
          onSelectDiff={onSelectDiff}
          onResetView={onResetView}
        />
        <FileHistoryPopover
          projectId={projectId}
          path={path}
          activeRunId={activeRunId}
          onSelectDiff={onSelectDiff}
          onJumpToRun={onJumpToRun}
          adapterByKind={adapterByKind}
        />
      </div>
    </div>
  );
}

function DiffToggle({
  projectId,
  path,
  view,
  onSelectDiff,
  onResetView,
}: {
  projectId: string;
  path: string;
  view: { kind: "current" } | { kind: "diff"; runId: string };
  onSelectDiff: (runId: string) => void;
  onResetView: () => void;
}) {
  const { t } = useI18n();
  // 히스토리 popover 와 같은 query key — 캐시 공유.
  const q = useQuery({
    queryKey: ["fileHistory", projectId, path],
    queryFn: () => api.getProjectFileHistory(projectId, path),
    staleTime: 30_000,
  });
  const entries = q.data?.entries ?? [];
  const latest = entries[0];
  const isDiffMode = view.kind === "diff";

  // 변경 이력 없고 diff 모드도 아니면 버튼 자체 숨김.
  if (!latest && !isDiffMode) return null;

  return (
    <button
      type="button"
      onClick={() => {
        if (isDiffMode) onResetView();
        else if (latest) onSelectDiff(latest.runId);
      }}
      title={
        isDiffMode
          ? t("files.viewer.showCurrent")
          : t("files.viewer.showLatestDiff")
      }
      aria-label={
        isDiffMode
          ? t("files.viewer.showCurrent")
          : t("files.viewer.showLatestDiff")
      }
      aria-pressed={isDiffMode}
      className={cn(
        "inline-flex size-6 items-center justify-center rounded transition-colors",
        isDiffMode
          ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
          : "text-muted-foreground hover:text-foreground hover:bg-muted",
      )}
    >
      {isDiffMode ? (
        <RotateCcw className="size-3.5" />
      ) : (
        <SplitSquareHorizontal className="size-3.5" />
      )}
    </button>
  );
}

function CurrentContent({
  projectId,
  path,
  compact,
  wrap,
  presences,
}: {
  projectId: string;
  path: string;
  wrap: boolean;
  compact: boolean;
  presences?: AgentPresence[];
}) {
  const { t } = useI18n();
  const hasActive = !!presences?.length;
  const file = useQuery({
    queryKey: ["projectFile", projectId, path],
    queryFn: () => api.getProjectFile(projectId, path),
    staleTime: 30_000,
    // 에이전트가 만지고 있는 동안 1.5초 폴링 — 화면이 라이브 편집에 맞춰 갱신.
    refetchInterval: hasActive ? 1500 : false,
  });
  // 부모가 relative라서 자식은 absolute inset-0으로 영역을 꽉 채운다.
  // Monaco가 본인 스크롤·미니맵을 가지므로 컨테이너에 overflow-auto는 X.
  if (file.isLoading) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }
  if (file.isError) {
    return (
      <div className="absolute inset-0 flex items-center justify-center px-5">
        <FileError error={(file.error as Error).message} />
      </div>
    );
  }
  if (file.data?.file.text === null) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground gap-2">
        <File className="size-4" />
        {t("files.viewer.binary")}
      </div>
    );
  }
  return (
    <div className="absolute inset-0">
      <MonacoView
        text={file.data?.file.text ?? ""}
        path={path}
        wrap={wrap}
        presences={presences}
        compact={compact}
      />
    </div>
  );
}

function DiffContent({
  path,
  runId,
  wrap,
}: {
  path: string;
  runId: string;
  wrap: boolean;
}) {
  const { t } = useI18n();
  // before/after 양쪽 *전체* 텍스트 — Monaco DiffEditor 가 split-view 로 그림.
  // 옛 unified-diff 텍스트 렌더는 폐기 (한 컬럼 +/-/@ 줄로 보기 어려웠음).
  const sides = useQuery({
    queryKey: ["run", runId, "sides", path],
    queryFn: () => api.getRunSides(runId, path),
    staleTime: 60_000,
  });
  if (sides.isLoading) {
    return (
      <div className="px-5 py-4 text-sm text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }
  if (sides.isError) {
    return (
      <div className="px-5 py-4 text-sm text-destructive">
        {(sides.error as Error).message}
      </div>
    );
  }
  const before = sides.data?.before ?? "";
  const after = sides.data?.after ?? "";
  if (before === after) {
    return (
      <p className="px-5 py-4 text-sm text-muted-foreground italic">
        {t("files.viewer.noTextDiff")}
      </p>
    );
  }
  return (
    <div className="absolute inset-0">
      <MonacoDiff before={before} after={after} path={path} wrap={wrap} />
    </div>
  );
}

function FileError({ error }: { error: string }) {
  const { t } = useI18n();
  const message = error.includes("too_large")
    ? t("files.viewer.tooLarge")
    : error.includes("not_found")
      ? t("files.viewer.notFound")
      : error;
  return <div className="px-5 py-4 text-sm text-destructive">{message}</div>;
}

// ────────────────────────────────────────────────────────────────────────────
// History popover (button on the file pane header)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Replaces the old always-visible right-side history rail. Now lives
 * behind a `📜` button on the file pane header — most of the time
 * the user just wants to read the file, so the runs that touched it
 * shouldn't eat 30% of the horizontal real estate. One click brings
 * the same content forward when needed.
 */
function FileHistoryPopover({
  projectId,
  path,
  activeRunId,
  onSelectDiff,
  onJumpToRun,
  adapterByKind,
}: {
  projectId: string;
  path: string;
  activeRunId: string | null;
  onSelectDiff: (runId: string) => void;
  onJumpToRun: (runId: string) => void;
  adapterByKind: Record<string, AdapterManifest>;
}) {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ["fileHistory", projectId, path],
    queryFn: () => api.getProjectFileHistory(projectId, path),
    staleTime: 30_000,
  });
  const entries = q.data?.entries ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative inline-flex size-6 items-center justify-center rounded transition-colors",
            entries.length > 0
              ? "text-foreground hover:bg-muted"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
          title={
            entries.length > 0
              ? `${t("files.history.title")} · ${entries.length}`
              : t("files.history.title")
          }
          aria-label={t("files.history.title")}
        >
          <History className="size-3.5" />
          {entries.length > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 inline-flex min-w-[14px] h-[14px] items-center justify-center rounded-full bg-foreground text-background text-[9px] font-semibold mono px-1">
              {entries.length > 9 ? "9+" : entries.length}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-80 max-h-[60vh] overflow-y-auto subtle-scrollbar p-0"
      >
        <div className="flex items-center gap-1.5 px-3 py-2 border-b sticky top-0 bg-popover">
          <Clock className="size-3 text-muted-foreground" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("files.history.title")}
          </span>
        </div>
        {q.isLoading ? (
          <p className="px-3 py-4 text-xs text-muted-foreground italic">…</p>
        ) : entries.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground/70 italic">
            {t("files.history.empty")}
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {entries.map((e) => (
              <HistoryRow
                key={e.runId}
                entry={e}
                isActive={activeRunId === e.runId}
                onSelectDiff={() => onSelectDiff(e.runId)}
                onJumpToRun={() => onJumpToRun(e.runId)}
                adapterByKind={adapterByKind}
              />
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HistoryRow({
  entry,
  isActive,
  onSelectDiff,
  onJumpToRun,
  adapterByKind,
}: {
  entry: FileHistoryEntry;
  isActive: boolean;
  onSelectDiff: () => void;
  onJumpToRun: () => void;
  adapterByKind: Record<string, AdapterManifest>;
}) {
  const { t } = useI18n();
  const cls = classesFor(agentColorFor(entry.agentId));
  const manifest = entry.adapterKind
    ? adapterByKind[entry.adapterKind]
    : undefined;
  return (
    <li
      className={cn(
        "group relative",
        isActive && "bg-sky-500/10",
      )}
    >
      <button
        type="button"
        onClick={onSelectDiff}
        className={cn(
          "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors",
          isActive ? "" : "hover:bg-muted/40",
        )}
        title={t("files.history.viewDiff")}
      >
        {manifest ? (
          <AdapterIcon manifest={manifest} size={20} />
        ) : (
          <span className="size-5 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cn("text-xs font-medium truncate", cls.text)}>
              @{entry.agentName ?? entry.agentId.slice(0, 6)}
            </span>
            <Badge
              variant={statusVariant(entry.status)}
              className="h-3.5 px-1 text-[9px]"
            >
              {entry.status}
            </Badge>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] mono">
            <span className="text-success">
              +{entry.additions}
            </span>
            <span className="text-rose-600 dark:text-rose-400">
              −{entry.deletions}
            </span>
            <span className="text-muted-foreground/60 ml-auto">
              {formatTimeAgo(entry.createdAt, t)}
            </span>
          </div>
        </div>
      </button>
      {/* Secondary action — jump to the chat message for this run.
       *  Hidden until row hover so the primary "view diff" action stays
       *  the obvious one. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onJumpToRun();
        }}
        title={t("files.history.jumpToChat")}
        aria-label={t("files.history.jumpToChat")}
        className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex size-6 items-center justify-center rounded-md bg-background border opacity-0 group-hover:opacity-100 hover:bg-muted text-muted-foreground hover:text-foreground transition-opacity"
      >
        <ArrowRight className="size-3" />
      </button>
    </li>
  );
}

function statusVariant(
  s: FileHistoryEntry["status"],
): "info" | "success" | "destructive" | "warning" | "secondary" {
  switch (s) {
    case "added":
      return "success";
    case "deleted":
      return "destructive";
    case "renamed":
      return "warning";
    case "modified":
    default:
      return "info";
  }
}

// 파일을 사용자의 외부 IDE에서 열기. 프로젝트의 preferred_editor를 사용 —
// 미설정이면 서버가 vscode로 fallback. CLI를 못 찾으면 toast로 어떤 후보를
// 시도했는지 알려줘서 사용자가 PATH 설정 / CLI 설치를 판단할 수 있게.
function OpenInEditorButton({
  projectId,
  path,
}: {
  projectId: string;
  path: string;
}) {
  const { t } = useI18n();
  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.getProject(projectId),
  });
  const preferred = project.data?.project.preferredEditor ?? null;
  const editorName = preferred
    ? preferred.charAt(0).toUpperCase() + preferred.slice(1)
    : "VS Code";

  const open = useMutation({
    mutationFn: () => api.openInEditor(projectId, { path }),
    onSuccess: (r) =>
      toast.success(t("files.viewer.openedIn", { editor: r.editor })),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : String(err)),
  });

  return (
    <button
      type="button"
      onClick={() => open.mutate()}
      disabled={open.isPending}
      title={t("files.viewer.openIn", { editor: editorName })}
      aria-label={t("files.viewer.openIn", { editor: editorName })}
      className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
    >
      <ExternalLink className="size-3.5" />
    </button>
  );
}

