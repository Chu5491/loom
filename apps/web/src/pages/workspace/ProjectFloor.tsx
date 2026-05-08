// ProjectFloor — 픽셀 사무실 + 프로젝트 트리.
//
// 일반적인 사무실 풍경 (창·커피·화분) 대신 *진짜 프로젝트의 폴더/파일*이 방과
// 책상. 캐릭터는 자기가 지금 만지고 있는 파일의 책상까지 걸어가서 앉는다.
// idle 상태면 자기 home 방 안의 다른 책상들을 둘러보는 wander.
//
// 결과적으로 "사무실의 캐릭터 매력" + "프로젝트 구조 한 눈" 둘 다 담음.
//
// 좌표계: 16:9 floor를 percentage 로. (x, y) ∈ [0, 100].

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { FolderOpen, RefreshCw } from "lucide-react";
import type {
  ActiveToolsForAgent,
  ActiveTouch,
  Agent,
  TreeEntry,
} from "@loom/core";
import { api } from "../../api/client.js";
import { agentColorOf, classesFor } from "../../components/agentColor.js";
import { AgentInitialBadge } from "../../components/AgentInitialBadge.js";
import { useI18n } from "../../context/I18nContext.js";
import { basename } from "../../lib/path.js";
import { cn } from "../../lib/utils.js";
import { PixelCharacter } from "./PixelCharacter.js";
import { SpeechBubble } from "./SpeechBubble.js";

// ──────────────────────────────────────────────────────────────────────────
// 색 / 헬퍼
// ──────────────────────────────────────────────────────────────────────────

const SHIRT_BY_COLOR: Record<string, string> = {
  red: "oklch(0.62 0.18 25)",
  orange: "oklch(0.65 0.15 50)",
  amber: "oklch(0.70 0.16 80)",
  yellow: "oklch(0.78 0.14 95)",
  lime: "oklch(0.70 0.18 130)",
  green: "oklch(0.60 0.16 150)",
  emerald: "oklch(0.60 0.14 160)",
  teal: "oklch(0.60 0.10 195)",
  cyan: "oklch(0.65 0.10 210)",
  sky: "oklch(0.62 0.13 230)",
  blue: "oklch(0.55 0.18 260)",
  indigo: "oklch(0.50 0.18 280)",
  violet: "oklch(0.55 0.20 295)",
  purple: "oklch(0.55 0.20 310)",
  fuchsia: "oklch(0.60 0.22 325)",
  pink: "oklch(0.65 0.18 350)",
  rose: "oklch(0.62 0.18 10)",
  slate: "oklch(0.50 0.04 250)",
};

function shirtColorOf(agent: Agent): string {
  return SHIRT_BY_COLOR[agentColorOf(agent)] ?? "oklch(0.55 0.13 35)";
}

function hashSeed(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ──────────────────────────────────────────────────────────────────────────
// 레이아웃 — 트리 → 방 + 책상
// ──────────────────────────────────────────────────────────────────────────

type Desk = {
  path: string;
  label: string;
  /** 책상 중심 — character가 working 시 도착할 좌표. */
  x: number;
  y: number;
  roomIdx: number;
  touched: boolean;
  lastAgentId?: string;
};

type Room = {
  kind: "folder" | "root";
  path: string;
  label: string;
  /** top-left of room box, % units. */
  x: number;
  y: number;
  w: number;
  h: number;
  desks: Desk[];
  touchedCount: number;
};

type Floor = {
  rooms: Room[];
  deskByPath: Map<string, Desk>;
  /** 책상 0개 = 빈 프로젝트. 빈 floor 메시지 표시용. */
  totalDesks: number;
};

const FLOOR_PAD = 2.5;
const ROOM_GAP = 2;
const ROOM_HEADER_H = 5; // % of room height
const ROOM_INNER_PAD = 1.2;
const DESK_GAP = 0.7;
const MAX_ROOMS = 9;
const MAX_DESKS_PER_ROOM = 12;

function buildFloor(
  rootEntries: TreeEntry[],
  folderEntries: Map<string, TreeEntry[]>,
  touched: Map<string, string>,
): Floor {
  const touchedUnder = (prefix: string): number => {
    if (prefix === "") {
      let n = 0;
      for (const path of touched.keys()) if (!path.includes("/")) n++;
      return n;
    }
    const p = prefix + "/";
    let n = 0;
    for (const path of touched.keys()) if (path.startsWith(p)) n++;
    return n;
  };

  // 활동 많은 폴더가 위/왼쪽 — touched count 동률이면 alphabetical.
  const folders = rootEntries
    .filter((e) => e.kind === "directory")
    .sort((a, b) => {
      const ta = touchedUnder(a.path);
      const tb = touchedUnder(b.path);
      if (ta !== tb) return tb - ta;
      return a.name.localeCompare(b.name);
    })
    .slice(0, MAX_ROOMS - 1); // 1칸 root files 용 예약

  const rootFiles = rootEntries
    .filter((e) => e.kind === "file")
    .sort((a, b) => {
      const ta = touched.has(a.path) ? 1 : 0;
      const tb = touched.has(b.path) ? 1 : 0;
      if (ta !== tb) return tb - ta;
      return a.name.localeCompare(b.name);
    });

  const totalRooms = folders.length + (rootFiles.length > 0 ? 1 : 0);
  if (totalRooms === 0) {
    return { rooms: [], deskByPath: new Map(), totalDesks: 0 };
  }

  // grid: 1~2 → 그대로, 3~4 → 2col, 5~6 → 3col, 7~9 → 3col 3row.
  const cols =
    totalRooms <= 2 ? totalRooms : totalRooms <= 4 ? 2 : 3;
  const rows = Math.ceil(totalRooms / cols);
  const cellW = (100 - FLOOR_PAD * 2 - ROOM_GAP * (cols - 1)) / cols;
  const cellH = (100 - FLOOR_PAD * 2 - ROOM_GAP * (rows - 1)) / rows;

  const placeRoom = (
    kind: Room["kind"],
    path: string,
    label: string,
    files: TreeEntry[],
    idx: number,
  ): Room => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = FLOOR_PAD + col * (cellW + ROOM_GAP);
    const y = FLOOR_PAD + row * (cellH + ROOM_GAP);

    const sorted = files
      .filter((e) => e.kind === "file")
      .sort((a, b) => {
        const ta = touched.has(a.path) ? 1 : 0;
        const tb = touched.has(b.path) ? 1 : 0;
        if (ta !== tb) return tb - ta;
        return a.name.localeCompare(b.name);
      })
      .slice(0, MAX_DESKS_PER_ROOM);

    const n = sorted.length;
    const innerCols = n === 0 ? 1 : n <= 2 ? n : n <= 4 ? 2 : n <= 9 ? 3 : 4;
    const innerRows = n === 0 ? 1 : Math.ceil(n / innerCols);

    const headerAbs = (cellH * ROOM_HEADER_H) / 100;
    const innerX0 = x + ROOM_INNER_PAD;
    const innerY0 = y + headerAbs + ROOM_INNER_PAD;
    const innerW = cellW - ROOM_INNER_PAD * 2;
    const innerH = cellH - headerAbs - ROOM_INNER_PAD * 2;

    const deskW = (innerW - DESK_GAP * (innerCols - 1)) / innerCols;
    const deskH = (innerH - DESK_GAP * (innerRows - 1)) / innerRows;

    const desks: Desk[] = sorted.map((f, i) => {
      const c = i % innerCols;
      const r = Math.floor(i / innerCols);
      return {
        path: f.path,
        label: f.name,
        x: innerX0 + c * (deskW + DESK_GAP) + deskW / 2,
        y: innerY0 + r * (deskH + DESK_GAP) + deskH / 2,
        roomIdx: idx,
        touched: touched.has(f.path),
        lastAgentId: touched.get(f.path),
      };
    });

    return {
      kind,
      path,
      label,
      x,
      y,
      w: cellW,
      h: cellH,
      desks,
      touchedCount:
        kind === "root"
          ? sorted.filter((f) => touched.has(f.path)).length
          : touchedUnder(path),
    };
  };

  const rooms: Room[] = [];
  let idx = 0;
  for (const folder of folders) {
    const entries = folderEntries.get(folder.path) ?? [];
    rooms.push(placeRoom("folder", folder.path, folder.name, entries, idx));
    idx++;
  }
  if (rootFiles.length > 0) {
    rooms.push(placeRoom("root", "", "/", rootFiles, idx));
  }

  const deskByPath = new Map<string, Desk>();
  let totalDesks = 0;
  for (const room of rooms) {
    for (const desk of room.desks) {
      deskByPath.set(desk.path, desk);
      totalDesks++;
    }
  }
  return { rooms, deskByPath, totalDesks };
}

// ──────────────────────────────────────────────────────────────────────────
// 데이터 훅
// ──────────────────────────────────────────────────────────────────────────

function useFloorLayout(
  projectId: string,
  touched: Map<string, string>,
): { floor: Floor; isLoading: boolean; refresh: () => void } {
  const qc = useQueryClient();

  const root = useQuery({
    queryKey: ["projectFloor-root", projectId],
    queryFn: () => api.getProjectTree(projectId),
    staleTime: 5_000,
  });
  const rootEntries = root.data?.entries ?? [];
  const topFolders = useMemo(
    () => rootEntries.filter((e) => e.kind === "directory"),
    [rootEntries],
  );

  const childQueries = useQueries({
    queries: topFolders.map((folder) => ({
      queryKey: ["projectFloor-dir", projectId, folder.path],
      queryFn: () => api.getProjectTree(projectId, folder.path),
      staleTime: 5_000,
    })),
  });

  // dataUpdatedAt 모음으로 invalidate 시 재계산 트리거 — childQueries 자체는
  // 매 렌더 새 배열이라 deps에 못 넣음.
  const childrenStamp = childQueries
    .map((q) => q.dataUpdatedAt)
    .join(",");

  const folderEntries = useMemo(() => {
    const m = new Map<string, TreeEntry[]>();
    for (let i = 0; i < topFolders.length; i++) {
      m.set(topFolders[i]!.path, childQueries[i]?.data?.entries ?? []);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topFolders, childrenStamp]);

  const floor = useMemo(
    () => buildFloor(rootEntries, folderEntries, touched),
    [rootEntries, folderEntries, touched],
  );

  return {
    floor,
    isLoading:
      root.isLoading || childQueries.some((q) => q.isLoading),
    refresh: () => {
      qc.invalidateQueries({ queryKey: ["projectFloor-root", projectId] });
      qc.invalidateQueries({ queryKey: ["projectFloor-dir", projectId] });
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ──────────────────────────────────────────────────────────────────────────

export function ProjectFloor({
  projectId,
  projectName,
  agents,
  workingIds,
  touchingIds,
  activeTouches,
  activeTools,
  onPickFile,
  onPickAgent,
}: {
  projectId: string;
  projectName: string;
  agents: Agent[];
  workingIds: Set<string>;
  touchingIds: Set<string>;
  activeTouches: ActiveTouch[];
  activeTools: ActiveToolsForAgent[];
  onPickFile: (path: string) => void;
  onPickAgent: (id: string) => void;
}) {
  const { t } = useI18n();

  // 누적 터치 — 책상 dot + 활동 많은 폴더 정렬용.
  const touched = useQuery({
    queryKey: ["projectTouched", projectId],
    queryFn: () => api.getProjectTouched(projectId),
    refetchInterval: 30_000,
  });
  const touchedMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const tp of touched.data?.paths ?? []) m.set(tp.path, tp.lastAgentId);
    return m;
  }, [touched.data]);

  const { floor, isLoading, refresh } = useFloorLayout(projectId, touchedMap);

  // 에이전트 → 자기가 만지고 있는 파일 책상 (있으면).
  const targetDeskByAgent = useMemo(() => {
    const m = new Map<string, Desk>();
    for (const tch of activeTouches) {
      if (m.has(tch.agentId)) continue;
      for (const p of tch.paths) {
        const desk = floor.deskByPath.get(p);
        if (desk) {
          m.set(tch.agentId, desk);
          break;
        }
      }
    }
    return m;
  }, [activeTouches, floor]);

  // 에이전트의 home 책상 — 가장 최근 자기가 만진 파일 책상. 없으면 deterministic
  // (agent.id 해시로 desks 하나 픽). 빈 프로젝트면 undefined.
  const homeDeskByAgent = useMemo(() => {
    const allDesks = [...floor.deskByPath.values()];
    const m = new Map<string, Desk>();
    if (allDesks.length === 0) return m;

    // 에이전트별 자기 누적 터치 파일들 (lastAgentId 매칭)
    const ownTouches = new Map<string, Desk[]>();
    for (const desk of allDesks) {
      if (desk.lastAgentId) {
        if (!ownTouches.has(desk.lastAgentId))
          ownTouches.set(desk.lastAgentId, []);
        ownTouches.get(desk.lastAgentId)!.push(desk);
      }
    }
    for (const a of agents) {
      const owned = ownTouches.get(a.id);
      if (owned && owned.length > 0) {
        // deterministic pick — agent 중복 시 같은 책상 잡지 않게 hash 로.
        const seed = hashSeed(a.id);
        m.set(a.id, owned[seed % owned.length]!);
      } else {
        const seed = hashSeed(a.id);
        m.set(a.id, allDesks[seed % allDesks.length]!);
      }
    }
    return m;
  }, [agents, floor]);

  // 활동 칩 — "@A · foo.ts"
  const liveChips = useMemo(() => {
    type Chip = { agent: Agent; filePath: string | null; toolName: string | null };
    const chips: Chip[] = [];
    const seen = new Set<string>();
    for (const tch of activeTouches) {
      const a = agents.find((x) => x.id === tch.agentId);
      if (!a || seen.has(a.id)) continue;
      seen.add(a.id);
      const tool = activeTools.find((x) => x.agentId === a.id);
      const latest = tool?.recent[tool.recent.length - 1];
      chips.push({
        agent: a,
        filePath: tch.paths[0] ?? null,
        toolName: latest?.name ?? null,
      });
    }
    for (const a of agents) {
      if (seen.has(a.id) || !workingIds.has(a.id)) continue;
      seen.add(a.id);
      chips.push({ agent: a, filePath: null, toolName: null });
    }
    return chips;
  }, [activeTouches, activeTools, agents, workingIds]);

  if (floor.totalDesks === 0 && !isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground italic">
        <FolderOpen className="size-6 opacity-40" />
        {t("floor.empty")}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <FloorHeader
        projectName={projectName}
        liveChips={liveChips}
        touchingIds={touchingIds}
        onPickAgent={onPickAgent}
        onPickFile={onPickFile}
        onRefresh={refresh}
        refreshing={touched.isFetching || isLoading}
      />

      <div className="flex-1 min-h-0 flex items-center justify-center p-3 overflow-hidden">
        <div className="relative w-full h-full max-h-[680px] aspect-[16/9] mx-auto rounded-md overflow-hidden bg-card shadow-[inset_0_0_0_2px_color-mix(in_oklch,var(--foreground)_8%,transparent)]">
          {/* 방들 */}
          {floor.rooms.map((room, i) => (
            <RoomBox key={`${room.kind}:${room.path || "-"}:${i}`} room={room} />
          ))}

          {/* 책상들 — 모든 방의 책상을 평면으로 그리고 클릭 받음. */}
          {floor.rooms.flatMap((room) =>
            room.desks.map((desk) => (
              <DeskTile
                key={desk.path}
                desk={desk}
                lastAgent={
                  desk.lastAgentId
                    ? agents.find((a) => a.id === desk.lastAgentId)
                    : undefined
                }
                onPick={onPickFile}
              />
            )),
          )}

          {/* 캐릭터들 */}
          {agents.map((agent) => {
            const home = homeDeskByAgent.get(agent.id);
            if (!home) return null;
            const targetDesk = targetDeskByAgent.get(agent.id) ?? null;
            // 같은 방 책상들 — wander 풀.
            const homeRoomDesks =
              floor.rooms[home.roomIdx]?.desks ?? [];
            return (
              <AgentChar
                key={agent.id}
                agent={agent}
                homeDesk={home}
                targetDesk={targetDesk}
                roomDesks={homeRoomDesks}
                allDesks={[...floor.deskByPath.values()]}
                working={workingIds.has(agent.id)}
                touching={touchingIds.has(agent.id)}
                activeTool={
                  activeTools.find((x) => x.agentId === agent.id) ?? null
                }
                onPick={() => onPickAgent(agent.id)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 헤더 (라이브 ribbon + refresh)
// ──────────────────────────────────────────────────────────────────────────

function FloorHeader({
  projectName,
  liveChips,
  touchingIds,
  onPickAgent,
  onPickFile,
  onRefresh,
  refreshing,
}: {
  projectName: string;
  liveChips: Array<{ agent: Agent; filePath: string | null; toolName: string | null }>;
  touchingIds: Set<string>;
  onPickAgent: (id: string) => void;
  onPickFile: (path: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { t } = useI18n();
  return (
    <header className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-border bg-muted/20">
      <div className="flex items-center gap-2 min-w-0 shrink-0">
        <span className="text-sm font-semibold truncate" title={projectName}>
          🏢 {projectName}
        </span>
      </div>
      <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto subtle-scrollbar">
        {liveChips.length === 0 ? (
          <span className="text-[11px] text-muted-foreground/60 italic shrink-0">
            {t("map.idle")}
          </span>
        ) : (
          liveChips.map((c) => (
            <LiveChip
              key={c.agent.id}
              agent={c.agent}
              filePath={c.filePath}
              toolName={c.toolName}
              touching={touchingIds.has(c.agent.id)}
              onClick={() => onPickAgent(c.agent.id)}
              onPickFile={onPickFile}
            />
          ))
        )}
      </div>
      <button
        type="button"
        onClick={onRefresh}
        title={t("map.refresh")}
        aria-label={t("map.refresh")}
        className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
      >
        <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
      </button>
    </header>
  );
}

function LiveChip({
  agent,
  filePath,
  toolName,
  touching,
  onClick,
  onPickFile,
}: {
  agent: Agent;
  filePath: string | null;
  toolName: string | null;
  touching: boolean;
  onClick: () => void;
  onPickFile: (path: string) => void;
}) {
  const cls = classesFor(agentColorOf(agent));
  return (
    <button
      type="button"
      onClick={onClick}
      title={`@${agent.name}${filePath ? " · " + filePath : ""}${toolName ? " · " + toolName : ""}`}
      className={cn(
        "group inline-flex items-center gap-1.5 h-6 px-1.5 rounded-full border text-[11px] transition-colors shrink-0",
        cls.bgSoft,
        cls.border,
        "hover:bg-foreground/5",
      )}
    >
      <AgentInitialBadge agent={agent} live={touching} size="xs" />
      <span className={cn("font-medium truncate max-w-[8rem]", cls.text)}>
        @{agent.name}
      </span>
      {filePath ? (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onPickFile(filePath);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              onPickFile(filePath);
            }
          }}
          className="text-muted-foreground/80 mono truncate max-w-[10rem] hover:text-foreground hover:underline cursor-pointer"
        >
          {basename(filePath)}
        </span>
      ) : toolName ? (
        <span className="text-muted-foreground/70 mono truncate max-w-[10rem]">
          {toolName}
        </span>
      ) : null}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 방 / 책상 시각화
// ──────────────────────────────────────────────────────────────────────────

function RoomBox({ room }: { room: Room }) {
  return (
    <div
      className="absolute pointer-events-none rounded-md border border-border/60 bg-foreground/[0.015]"
      style={{
        left: `${room.x}%`,
        top: `${room.y}%`,
        width: `${room.w}%`,
        height: `${room.h}%`,
      }}
    >
      <div className="flex items-center gap-1 px-1.5 h-[18px] mt-0.5 text-[10px] mono text-muted-foreground/80 truncate">
        <span className="opacity-60">{room.kind === "root" ? "·" : "▸"}</span>
        <span className="truncate" title={room.path || "/"}>
          {room.label}
        </span>
        {room.touchedCount > 0 ? (
          <span
            aria-hidden
            className="ml-auto inline-flex min-w-[1rem] items-center justify-center rounded-full bg-sky-500/15 px-1 text-[8.5px] font-semibold text-sky-700 dark:text-sky-400"
          >
            {room.touchedCount > 9 ? "9+" : room.touchedCount}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function DeskTile({
  desk,
  lastAgent,
  onPick,
}: {
  desk: Desk;
  lastAgent?: Agent;
  onPick: (path: string) => void;
}) {
  const cls = lastAgent ? classesFor(agentColorOf(lastAgent)) : null;
  return (
    <button
      type="button"
      onClick={() => onPick(desk.path)}
      title={desk.path}
      className={cn(
        "absolute group rounded-sm border border-border/50 bg-card hover:border-foreground/40 hover:bg-muted/60 transition-colors flex items-center justify-center px-1",
        // 클릭 영역: 책상 중심 기준 작은 박스. 너무 작으면 클릭 어려우니 7%×7% 정도.
      )}
      style={{
        left: `${desk.x}%`,
        top: `${desk.y}%`,
        width: "8%",
        height: "9%",
        transform: "translate(-50%, -50%)",
      }}
    >
      <span className="text-[8.5px] mono text-muted-foreground/80 truncate group-hover:text-foreground">
        {desk.label}
      </span>
      {desk.touched && cls ? (
        <span
          aria-hidden
          className={cn(
            "absolute top-0.5 right-0.5 size-1.5 rounded-full",
            cls.dot,
          )}
        />
      ) : null}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 캐릭터 — wander/linger/working 상태머신.
// OfficeFloor 의 로직에서 파생, DESTINATIONS = 같은 방 책상들.
// ──────────────────────────────────────────────────────────────────────────

type CharState = "idle" | "wander" | "linger" | "going" | "working" | "leaving";

const IDLE_ACTIONS = ["🙆", "🥱", "💭", "📱", "🎵", "👀"] as const;

function AgentChar({
  agent,
  homeDesk,
  targetDesk,
  roomDesks,
  allDesks,
  working,
  touching,
  activeTool,
  onPick,
}: {
  agent: Agent;
  homeDesk: Desk;
  /** 지금 만지고 있는 파일 책상. working 동안 이 자리로 이동. null 이면 home 에 앉음. */
  targetDesk: Desk | null;
  /** 같은 home 방 안 책상들 — idle wander 의 자연스런 풀. */
  roomDesks: Desk[];
  /** 전체 책상 — 가끔 다른 방으로 마실 다녀올 때. */
  allDesks: Desk[];
  working: boolean;
  touching: boolean;
  activeTool: ActiveToolsForAgent | null;
  onPick: () => void;
}) {
  const personality = useMemo(() => {
    const seed = hashSeed(agent.id);
    return {
      speedMul: 0.8 + ((seed % 100) / 100) * 0.5,
      waitMul: 0.7 + (((seed >> 8) % 100) / 100) * 0.6,
    };
  }, [agent.id]);

  // working 시 효과적 책상 — 만지는 파일이 있으면 그쪽, 없으면 home.
  const effectiveDesk = targetDesk ?? homeDesk;

  const initial = useMemo(() => {
    if (working) {
      return {
        pos: { x: effectiveDesk.x, y: effectiveDesk.y },
        state: "working" as CharState,
      };
    }
    // idle 시작 — home 책상 옆 살짝 떨어진 spot.
    const seed = hashSeed(agent.id);
    const ox = ((seed >> 4) % 6) - 3;
    const oy = ((seed >> 8) % 4) - 2;
    return {
      pos: {
        x: clamp(homeDesk.x + ox, 4, 96),
        y: clamp(homeDesk.y + oy, 8, 92),
      },
      state: "idle" as CharState,
    };
    // homeDesk 좌표가 트리 재계산으로 자주 바뀌면 캐릭터가 텔레포트됨 — 마운트
    // 시 1회만 사용. 후속 변경은 useEffect 들이 처리.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  const [pos, setPos] = useState(initial.pos);
  const [target, setTarget] = useState(initial.pos);
  const [state, setState] = useState<CharState>(initial.state);
  const [destDesk, setDestDesk] = useState<Desk | null>(null);
  const [iconIdx, setIconIdx] = useState(0);
  const [idleAction, setIdleAction] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);

  const lastWorkingRef = useRef(working);
  const lastTargetPathRef = useRef<string | null>(targetDesk?.path ?? null);

  // working 토글 → 즉시 인터럽트.
  useEffect(() => {
    const wasWorking = lastWorkingRef.current;
    lastWorkingRef.current = working;
    if (working && !wasWorking) {
      setTarget({ x: effectiveDesk.x, y: effectiveDesk.y });
      setDestDesk(null);
      setState("going");
    } else if (!working && wasWorking) {
      // 떠날 땐 같은 방 안 한 발짝.
      const seed = hashSeed(agent.id) ^ Date.now();
      const ox = ((seed >> 4) % 8) - 4;
      const oy = ((seed >> 8) % 6) - 3;
      setTarget({
        x: clamp(homeDesk.x + ox, 4, 96),
        y: clamp(homeDesk.y + oy, 8, 92),
      });
      setDestDesk(null);
      setState("leaving");
    }
  }, [working, agent.id, effectiveDesk.x, effectiveDesk.y, homeDesk.x, homeDesk.y]);

  // working 중 targetDesk 변경 → 새 책상으로 슬라이드. state 는 "going" 으로
  // 잠깐 바뀌어 walking 자세, 도착 시 working 으로 복귀.
  useEffect(() => {
    if (!working) return;
    const newPath = targetDesk?.path ?? null;
    if (newPath === lastTargetPathRef.current) return;
    lastTargetPathRef.current = newPath;
    setTarget({ x: effectiveDesk.x, y: effectiveDesk.y });
    setState("going");
  }, [targetDesk, working, effectiveDesk.x, effectiveDesk.y]);

  // 위치 보간.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setPos((cur) => {
        const dx = target.x - cur.x;
        const dy = target.y - cur.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 0.4) {
          if (state === "going") setState("working");
          else if (state === "leaving") setState("idle");
          else if (state === "wander") setState("linger");
          return cur;
        }
        const baseSpeed =
          state === "working"
            ? 0
            : state === "going"
              ? 0.2
              : state === "linger"
                ? 0
                : 0.11;
        const speed = baseSpeed * personality.speedMul;
        const step = Math.min(dist, speed);
        return {
          x: cur.x + (dx / dist) * step,
          y: cur.y + (dy / dist) * step,
        };
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, state, personality.speedMul]);

  // idle → 같은 방 다른 책상으로 wander. 가끔 (15%) 다른 방으로 마실.
  useEffect(() => {
    if (state !== "idle") return;
    const wait = (2500 + Math.random() * 4000) * personality.waitMul;
    const id = window.setTimeout(() => {
      const pool = Math.random() < 0.15 ? allDesks : roomDesks;
      if (pool.length === 0) return;
      const dest = pool[Math.floor(Math.random() * pool.length)]!;
      const jx = (Math.random() - 0.5) * 4;
      const jy = (Math.random() - 0.5) * 3;
      setTarget({
        x: clamp(dest.x + jx, 4, 96),
        y: clamp(dest.y + jy, 8, 92),
      });
      setDestDesk(dest);
      setState("wander");
    }, wait);
    return () => window.clearTimeout(id);
  }, [state, personality.waitMul, roomDesks, allDesks]);

  // idle 중 micro-action.
  useEffect(() => {
    if (state !== "idle") {
      setIdleAction(null);
      return;
    }
    const onset = 600 + Math.random() * 1500;
    const onsetId = window.setTimeout(() => {
      if (Math.random() < 0.3) {
        const action =
          IDLE_ACTIONS[Math.floor(Math.random() * IDLE_ACTIONS.length)]!;
        setIdleAction(action);
        const offsetId = window.setTimeout(
          () => setIdleAction(null),
          1500 + Math.random() * 1000,
        );
        return () => window.clearTimeout(offsetId);
      }
    }, onset);
    return () => window.clearTimeout(onsetId);
  }, [state]);

  // linger 진입 시 destDesk 의 라벨 일부 글자 회전 (이모지 없으니 책상명 일부).
  useEffect(() => {
    if (state !== "linger" || !destDesk) return;
    setIconIdx(0);
    const id = window.setInterval(() => {
      setIconIdx((i) => i + 1);
    }, 1800 + Math.random() * 800);
    return () => window.clearInterval(id);
  }, [state, destDesk]);

  // linger → idle.
  useEffect(() => {
    if (state !== "linger") return;
    const wait = (2500 + Math.random() * 3000) * personality.waitMul;
    const id = window.setTimeout(() => {
      setState("idle");
      setDestDesk(null);
    }, wait);
    return () => window.clearTimeout(id);
  }, [state, personality.waitMul]);

  // 머리 위 표시.
  const bubble = useMemo<string | null>(() => {
    if (state === "working") {
      if (targetDesk) return `✎ ${targetDesk.label}`;
      const latest = activeTool?.recent[activeTool.recent.length - 1];
      if (latest) {
        if (latest.name.startsWith("mcp__")) {
          const server = latest.name.split("__")[1] ?? "mcp";
          return `🔌 ${server}`;
        }
        return latest.name;
      }
      return "…";
    }
    if (state === "going") return "→";
    if (state === "leaving") return "✓";
    if (state === "linger" && destDesk) {
      // basename 첫 6글자 + 점점이 = "linger 중 뭐 보고있다" 느낌.
      const tags = ["📂", "👀", "💭", "✨"];
      return tags[iconIdx % tags.length] ?? "💭";
    }
    if (state === "idle" && idleAction) return idleAction;
    return null;
  }, [state, targetDesk, activeTool, destDesk, iconIdx, idleAction]);

  const isMoving =
    state === "going" || state === "leaving" || state === "wander";
  const movingLeft = target.x < pos.x;
  const pose = state === "working" ? "sit" : isMoving ? "walking" : "stand";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick();
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="absolute pixel-character-wrap cursor-pointer outline-none"
      style={{
        left: `${pos.x}%`,
        top: `${pos.y}%`,
        transform: "translate(-50%, -100%)",
        zIndex: state === "working" ? 1 : hovered ? 20 : 5,
      }}
      title={`@${agent.name}`}
      aria-label={agent.name}
    >
      <SpeechBubble text={bubble} />
      <PixelCharacter
        shirtColor={shirtColorOf(agent)}
        pose={pose}
        flipX={movingLeft}
        scale={2}
      />
      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-0.5 text-[9px] mono text-muted-foreground/80 whitespace-nowrap pointer-events-none flex items-center gap-0.5">
        {touching ? (
          <span
            aria-hidden
            className="size-1 rounded-full bg-emerald-500 animate-pulse"
          />
        ) : null}
        @{agent.name}
      </div>
    </div>
  );
}
