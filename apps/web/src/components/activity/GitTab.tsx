// Git 활동 패널.
// 두 모드: Status(스테이지/언스테이지/커밋) | Graph(커밋 토폴로지 SVG).
// 둘 다 같은 프로젝트의 cwd에 대해 서버 git 라우트를 호출. clean 트리거나
// non-git repo면 안내 카피만 표시.

import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ChevronRight,
  GitCommit,
  GitMerge,
  Plus,
  Minus,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type GitLogEntry,
  type GitStatus,
  type GitWorkingChange,
} from "../../api/client.js";
import { Button } from "../ui/button.js";
import { Textarea } from "../ui/textarea.js";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";
import { basename } from "../../lib/path.js";
import { emit } from "../../lib/loomEvents.js";
import { formatTimeAgo } from "../../lib/timeAgo.js";
import { NoProjectState, PanelHeader } from "./shared.js";

type Mode = "status" | "graph";

export function GitTab() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();
  const [mode, setMode] = useState<Mode>("status");

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
      <PanelHeader
        title={t("activity.git")}
        action={
          <div className="flex items-center rounded-md border border-border/70 p-0.5 text-[10px] mono uppercase tracking-wider">
            <ModeButton
              active={mode === "status"}
              label={t("git.mode.status")}
              onClick={() => setMode("status")}
            />
            <ModeButton
              active={mode === "graph"}
              label={t("git.mode.graph")}
              onClick={() => setMode("graph")}
            />
          </div>
        }
      />
      {mode === "status" ? (
        <StatusView projectId={projectId} />
      ) : (
        <GraphView projectId={projectId} />
      )}
    </div>
  );
}

function ModeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2 h-5 rounded transition-colors",
        active
          ? "bg-foreground/[0.08] text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
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

// ────────────────────────────────────────────────────────────────────────────
// Graph — SVG로 커밋 토폴로지 그리기.
// 각 커밋은 한 행을 차지하고, 부모 SHA를 따라 레인이 연결됨.

function GraphView({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const log = useQuery({
    queryKey: ["gitLog", projectId, { all: true }],
    queryFn: () => api.getGitLog(projectId, { limit: 200, all: true }),
    refetchInterval: 30_000,
    retry: false,
  });

  if (log.isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }
  if (log.isError) {
    const msg = (log.error as Error).message;
    if (msg.includes("not_a_git_repo")) {
      return <EmptyHint message={t("git.notRepo")} />;
    }
    return (
      <div className="flex-1 flex items-center justify-center px-4 text-center text-xs text-destructive">
        {msg}
      </div>
    );
  }
  const entries = log.data?.entries ?? [];
  if (entries.length === 0) {
    return <EmptyHint message={t("git.emptyHistory")} />;
  }

  return <GitGraph entries={entries} />;
}

// 레인 컬러 — agentColor의 일부를 재활용해도 되지만 그래프 가독성 우선.
const LANE_COLORS = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // rose
  "#a855f7", // violet
  "#06b6d4", // cyan
  "#ec4899", // pink
  "#84cc16", // lime
];

const ROW_H = 28;
const LANE_W = 14;
const PAD_X = 12;

interface PlacedCommit extends GitLogEntry {
  lane: number;
  parentLanes: number[];
}

function placeOnLanes(commits: GitLogEntry[]): {
  placed: PlacedCommit[];
  laneCount: number;
} {
  // commits는 reverse-chronological 순. lanes[i]는 그 레인이 다음에
  // 기다리는 자식 sha. 자식이 매칭되면 그 레인이 그 자식의 레인이 되고,
  // 자식이 부모를 발표하면 부모를 그 레인 또는 새 레인에 등록.
  const lanes: (string | null)[] = [];
  const placed: PlacedCommit[] = [];

  for (const c of commits) {
    let myLane = lanes.indexOf(c.sha);
    if (myLane === -1) {
      myLane = lanes.findIndex((s) => s === null);
      if (myLane === -1) {
        myLane = lanes.length;
        lanes.push(null);
      }
    }
    // 내 레인 비움 (부모 등록에서 다시 차지할 수 있음).
    lanes[myLane] = null;

    const parentLanes: number[] = [];
    for (let i = 0; i < c.parents.length; i++) {
      const p = c.parents[i]!;
      let pLane = lanes.indexOf(p);
      if (pLane === -1) {
        if (i === 0 && lanes[myLane] === null) {
          pLane = myLane;
          lanes[myLane] = p;
        } else {
          pLane = lanes.findIndex((s) => s === null);
          if (pLane === -1) {
            pLane = lanes.length;
            lanes.push(p);
          } else {
            lanes[pLane] = p;
          }
        }
      }
      parentLanes.push(pLane);
    }
    placed.push({ ...c, lane: myLane, parentLanes });
  }

  return {
    placed,
    laneCount: Math.max(1, ...placed.map((c) => c.lane + 1)),
  };
}

function GitGraph({ entries }: { entries: GitLogEntry[] }) {
  const [active, setActive] = useState<string | null>(null);
  const { placed, laneCount } = useMemo(() => placeOnLanes(entries), [entries]);
  const graphWidth = PAD_X + laneCount * LANE_W;
  const totalH = placed.length * ROW_H;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto subtle-scrollbar">
      <div className="relative">
        <svg
          width={graphWidth}
          height={totalH}
          className="absolute left-0 top-0 pointer-events-none"
        >
          {placed.map((c, i) => {
            const cx = PAD_X + c.lane * LANE_W;
            const cy = i * ROW_H + ROW_H / 2;
            return c.parentLanes.map((pLane, pi) => {
              // 부모를 row 인덱스에서 찾아 좌표 계산.
              const parentIdx = placed.findIndex((p) => p.sha === c.parents[pi]);
              if (parentIdx === -1) return null;
              const px = PAD_X + pLane * LANE_W;
              const py = parentIdx * ROW_H + ROW_H / 2;
              const color =
                LANE_COLORS[pLane % LANE_COLORS.length] ?? LANE_COLORS[0]!;
              // straight if same lane, else bezier curve.
              if (pLane === c.lane) {
                return (
                  <line
                    key={`${c.sha}:${pi}`}
                    x1={cx}
                    y1={cy}
                    x2={px}
                    y2={py}
                    stroke={color}
                    strokeWidth={2}
                  />
                );
              }
              const midY = cy + (py - cy) * 0.5;
              return (
                <path
                  key={`${c.sha}:${pi}`}
                  d={`M${cx} ${cy} C ${cx} ${midY}, ${px} ${midY}, ${px} ${py}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                />
              );
            });
          })}
          {placed.map((c, i) => {
            const cx = PAD_X + c.lane * LANE_W;
            const cy = i * ROW_H + ROW_H / 2;
            const color =
              LANE_COLORS[c.lane % LANE_COLORS.length] ?? LANE_COLORS[0]!;
            return (
              <circle
                key={c.sha}
                cx={cx}
                cy={cy}
                r={4}
                fill={c.parents.length > 1 ? "var(--background)" : color}
                stroke={color}
                strokeWidth={2}
              />
            );
          })}
        </svg>
        <ul style={{ paddingLeft: graphWidth }}>
          {placed.map((c) => (
            <CommitRow
              key={c.sha}
              commit={c}
              active={active === c.sha}
              onClick={() => setActive(active === c.sha ? null : c.sha)}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function CommitRow({
  commit,
  active,
  onClick,
}: {
  commit: PlacedCommit;
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  return (
    <li
      style={{ height: ROW_H }}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 pr-3 cursor-pointer transition-colors text-[11px]",
        active ? "bg-muted/70" : "hover:bg-muted/40",
      )}
    >
      <span className="mono text-muted-foreground/70 shrink-0">
        {commit.shortSha}
      </span>
      {commit.parents.length > 1 ? (
        <GitMerge className="size-3 text-sky-500 shrink-0" />
      ) : null}
      <span className="truncate flex-1">{commit.subject}</span>
      {commit.refs.length > 0 ? (
        <RefBadges refs={commit.refs} />
      ) : null}
      <span className="text-muted-foreground/60 mono text-[10px] shrink-0">
        {formatTimeAgo(commit.authoredAt, t)}
      </span>
    </li>
  );
}

function RefBadges({ refs }: { refs: string[] }) {
  return (
    <span className="flex items-center gap-1 shrink-0">
      {refs.slice(0, 3).map((r) => {
        const isHead = r.startsWith("HEAD");
        return (
          <span
            key={r}
            className={cn(
              "inline-flex items-center px-1 h-4 rounded text-[9px] mono uppercase tracking-wide",
              isHead
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : "bg-muted text-muted-foreground",
            )}
          >
            {r.replace(/^HEAD -> /, "")}
          </span>
        );
      })}
    </span>
  );
}

