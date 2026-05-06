// 커밋 토폴로지 SVG. 사이드 패널의 GitTab 과 GitPage 양쪽이 공유.
//
// 각 커밋이 한 row 차지, 부모 sha 따라 레인 연결. 레인 별 색은 LANE_COLORS
// 순환. straight if same lane, bezier if 레인 변경.

import { useMemo } from "react";
import { GitMerge } from "lucide-react";
import type { GitLogEntry } from "../../api/client.js";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";
import { formatTimeAgo } from "../../lib/timeAgo.js";

const LANE_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#a855f7",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
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

export function CommitGraph({
  entries,
  selectedSha,
  onSelect,
  /** 행 우측 — author + time 옆에 추가 정보 (예: hash). */
  extraColumns,
}: {
  entries: GitLogEntry[];
  selectedSha?: string | null;
  onSelect?: (sha: string) => void;
  extraColumns?: boolean;
}) {
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
              const parentIdx = placed.findIndex(
                (p) => p.sha === c.parents[pi],
              );
              if (parentIdx === -1) return null;
              const px = PAD_X + pLane * LANE_W;
              const py = parentIdx * ROW_H + ROW_H / 2;
              const color =
                LANE_COLORS[pLane % LANE_COLORS.length] ?? LANE_COLORS[0]!;
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
              selected={selectedSha === c.sha}
              onClick={onSelect ? () => onSelect(c.sha) : undefined}
              showAuthor={extraColumns}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function CommitRow({
  commit,
  selected,
  onClick,
  showAuthor,
}: {
  commit: PlacedCommit;
  selected: boolean;
  onClick?: () => void;
  showAuthor?: boolean;
}) {
  const { t } = useI18n();
  return (
    <li
      style={{ height: ROW_H }}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 pr-3 transition-colors text-[12px]",
        onClick && "cursor-pointer",
        selected ? "bg-foreground/[0.10]" : onClick && "hover:bg-muted/50",
      )}
    >
      <span className="mono text-muted-foreground/70 shrink-0 text-[11px]">
        {commit.shortSha}
      </span>
      {commit.parents.length > 1 ? (
        <GitMerge className="size-3 text-sky-500 shrink-0" />
      ) : null}
      <span className="truncate flex-1">{commit.subject}</span>
      {commit.refs.length > 0 ? <RefBadges refs={commit.refs} /> : null}
      {showAuthor ? (
        <span className="text-muted-foreground/70 truncate text-[11px] max-w-[10rem] hidden md:inline">
          {commit.authorName}
        </span>
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
