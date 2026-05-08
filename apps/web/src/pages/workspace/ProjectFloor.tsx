// ProjectFloor — Pixel Office Take 2.
//
// 첫 시도(파일 트리를 그리드 사무실로)는 정체성 흐릿. 추상 그리드 + 픽셀
// 캐릭터가 따로 놀았음. 이 버전은 *진짜 사무실*: 공간이 정보다.
//
//   - 각 에이전트 = 자기 책상 (이름표 + 모니터 + 캐릭터)
//   - 모니터 화면 = 지금 만지는 파일명. 클릭하면 에디터로 이동
//   - 게시판 (벽에 걸림) = 최근 thread 목록. 클릭하면 그 thread 활성화
//   - 캐릭터는 자기 책상에 출근 / 일끝나면 동료 책상 마실 / 창가에서 한숨
//   - 파일 트리는 *별도 메뉴* (사이드바). 사무실에 우겨넣지 않음
//
// 즉 사무실 = "어디에 누가 있는가" 가 아니라 "누구가 무엇을 하는가" 의 시각화.
// 멀티에이전트 라는 loom 의 본질이 한 화면에 다 보임.

import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownRight, RefreshCw } from "lucide-react";
import type {
  ActiveToolsForAgent,
  ActiveTouch,
  Agent,
  Thread,
} from "@loom/core";
import { agentColorOf, classesFor } from "../../components/agentColor.js";
import { useI18n } from "../../context/I18nContext.js";
import { basename } from "../../lib/path.js";
import { cn } from "../../lib/utils.js";
import {
  OfficeBookshelf,
  OfficeCoffee,
  OfficePlant,
  OfficeWindow,
} from "./OfficeDecor.js";
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
// 좌석 배치 — 책상 위치를 에이전트 인원에 맞춰 계산.
// 1~4명: 한 줄, 5~8명: 두 줄. 더 많으면 두 줄에 압축.
// 좌표는 floor (% 단위) 기준.
// ──────────────────────────────────────────────────────────────────────────

const DESK_ROW_FRONT_Y = 82;
const DESK_ROW_BACK_Y = 60;
const SIT_OFFSET_Y = -8; // 캐릭터 sit pose 시 책상 위쪽으로 살짝.

function deskSlot(index: number, total: number): { x: number; y: number } {
  const cols = total <= 4 ? Math.max(total, 1) : Math.ceil(total / 2);
  const row = total <= 4 ? 0 : Math.floor(index / cols);
  const col = index % cols;
  const xStart = 10;
  const xEnd = 90;
  const span = xEnd - xStart;
  const x = xStart + ((col + 0.5) / cols) * span;
  const y = row === 0 && total > 4 ? DESK_ROW_BACK_Y : DESK_ROW_FRONT_Y;
  return { x, y };
}

// 산책 spot — 데코 앞 / 정수기 / 게시판 앞. 책상 위치와 안 겹치게.
type WanderKind = "window" | "coffee" | "books" | "plant" | "board" | "cooler";
type WanderSpot = {
  kind: WanderKind;
  x: number;
  y: number;
  bubbles: ReadonlyArray<string>;
};
const WANDER_SPOTS: ReadonlyArray<WanderSpot> = [
  { kind: "window", x: 12, y: 38, bubbles: ["🌤", "💭", "🐦"] },
  { kind: "coffee", x: 88, y: 38, bubbles: ["☕", "🥐", "😌"] },
  { kind: "books", x: 50, y: 38, bubbles: ["📚", "💡", "✏️"] },
  { kind: "plant", x: 28, y: 50, bubbles: ["🪴", "💧", "🌱"] },
  { kind: "cooler", x: 72, y: 50, bubbles: ["💧", "🥤", "💬"] },
];

// ──────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ──────────────────────────────────────────────────────────────────────────

export function ProjectFloor({
  projectName,
  agents,
  workingIds,
  touchingIds,
  activeTouches,
  activeTools,
  threadList,
  workingThreadIds,
  activeThreadId,
  onPickFile,
  onPickAgent,
  onPickThread,
  onRefresh,
  refreshing,
}: {
  projectName: string;
  agents: Agent[];
  workingIds: Set<string>;
  touchingIds: Set<string>;
  activeTouches: ActiveTouch[];
  activeTools: ActiveToolsForAgent[];
  threadList: Thread[];
  workingThreadIds: Set<string>;
  activeThreadId: string | null;
  onPickFile: (path: string) => void;
  onPickAgent: (id: string) => void;
  onPickThread: (id: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const { t } = useI18n();

  // 에이전트 → 자기가 만지는 첫 파일 (모니터에 표시).
  const fileByAgent = useMemo(() => {
    const m = new Map<string, string>();
    for (const tch of activeTouches) {
      const first = tch.paths[0];
      if (first && !m.has(tch.agentId)) m.set(tch.agentId, first);
    }
    return m;
  }, [activeTouches]);

  // 책상 위치 (인덱스/총인원 기준).
  const deskByAgent = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    agents.forEach((a, i) => m.set(a.id, deskSlot(i, agents.length)));
    return m;
  }, [agents]);

  if (agents.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground italic">
        {t("office.empty")}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <FloorHeader
        projectName={projectName}
        onRefresh={onRefresh}
        refreshing={refreshing}
      />

      <div className="flex-1 min-h-0 flex items-center justify-center p-3 overflow-hidden">
        <div className="relative w-full h-full max-h-[680px] aspect-[16/9] mx-auto rounded-md overflow-hidden office-room shadow-[inset_0_0_0_2px_color-mix(in_oklch,var(--foreground)_8%,transparent),inset_0_0_0_4px_var(--card)]">
          {/* 벽 (상단 28%) + 카펫 (하단). 기존 office 톤 그대로. */}
          <div className="absolute inset-x-0 top-0 h-[28%] office-wall" />
          <div
            className="absolute inset-x-0 office-skirt"
            style={{ top: "27.5%", height: "1%" }}
          />
          <div className="absolute inset-x-0 bottom-0 top-[28%] office-carpet" />

          {/* 벽 데코 — 창문, 책장, 화분. 정수기. */}
          <div
            className="absolute pointer-events-none"
            style={{ left: "5%", top: "3%" }}
          >
            <OfficeWindow />
          </div>
          <div
            className="absolute pointer-events-none"
            style={{ right: "5%", top: "1%" }}
          >
            <OfficeBookshelf />
          </div>
          <div
            className="absolute pointer-events-none"
            style={{ left: "1%", bottom: "1%" }}
          >
            <OfficePlant />
          </div>
          <div
            className="absolute pointer-events-none"
            style={{ right: "1%", bottom: "1%" }}
          >
            <OfficePlant />
          </div>
          <div
            className="absolute pointer-events-none"
            style={{ left: "44%", top: "5%", transform: "translateX(-50%)" }}
          >
            <OfficeCoffee />
          </div>

          {/* 게시판 — 벽 가운데 걸림. thread 목록 + 클릭 활성화. */}
          <BulletinBoard
            threadList={threadList}
            workingThreadIds={workingThreadIds}
            activeThreadId={activeThreadId}
            onPickThread={onPickThread}
          />

          {/* 책상 + 모니터 — 에이전트별. */}
          {agents.map((agent, i) => {
            const slot = deskSlot(i, agents.length);
            const file = fileByAgent.get(agent.id) ?? null;
            return (
              <AgentDesk
                key={`desk-${agent.id}`}
                agent={agent}
                x={slot.x}
                y={slot.y}
                working={workingIds.has(agent.id)}
                touching={touchingIds.has(agent.id)}
                file={file}
                onPickFile={onPickFile}
              />
            );
          })}

          {/* 캐릭터 — 책상 위에 sit / floor 위에 wander. */}
          {agents.map((agent) => {
            const home = deskByAgent.get(agent.id);
            if (!home) return null;
            return (
              <AgentChar
                key={agent.id}
                agent={agent}
                homeX={home.x}
                homeY={home.y}
                working={workingIds.has(agent.id)}
                touching={touchingIds.has(agent.id)}
                file={fileByAgent.get(agent.id) ?? null}
                activeTool={
                  activeTools.find((x) => x.agentId === agent.id) ?? null
                }
                deskByAgent={deskByAgent}
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
// 헤더
// ──────────────────────────────────────────────────────────────────────────

function FloorHeader({
  projectName,
  onRefresh,
  refreshing,
}: {
  projectName: string;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const { t } = useI18n();
  return (
    <header className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-border bg-muted/20">
      <span className="text-sm font-semibold truncate" title={projectName}>
        🏢 {projectName} <span className="text-muted-foreground/70 font-normal">— office</span>
      </span>
      {onRefresh ? (
        <button
          type="button"
          onClick={onRefresh}
          title={t("map.refresh")}
          aria-label={t("map.refresh")}
          className="ml-auto inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        >
          <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
        </button>
      ) : null}
    </header>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 게시판 — 벽에 걸린 thread 목록.
// ──────────────────────────────────────────────────────────────────────────

function BulletinBoard({
  threadList,
  workingThreadIds,
  activeThreadId,
  onPickThread,
}: {
  threadList: Thread[];
  workingThreadIds: Set<string>;
  activeThreadId: string | null;
  onPickThread: (id: string) => void;
}) {
  const { t } = useI18n();
  // 최근 활성 thread 4개. working > active > recent updated.
  const top = useMemo(() => {
    const sorted = [...threadList].sort((a, b) => {
      const wa = workingThreadIds.has(a.id) ? 1 : 0;
      const wb = workingThreadIds.has(b.id) ? 1 : 0;
      if (wa !== wb) return wb - wa;
      return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
    });
    return sorted.slice(0, 4);
  }, [threadList, workingThreadIds]);

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: "30%",
        top: "3%",
        width: "40%",
      }}
    >
      <div className="pointer-events-auto rounded-sm border-2 border-amber-700/40 bg-amber-50/95 dark:bg-amber-950/30 dark:border-amber-700/60 p-1.5 shadow-md">
        <div className="flex items-center gap-1 mb-1 text-[9px] font-semibold uppercase tracking-wider text-amber-800/70 dark:text-amber-200/70">
          📋 {t("office.board.title")}
        </div>
        {top.length === 0 ? (
          <div className="text-[9px] italic text-amber-800/50 dark:text-amber-200/50 px-1 py-0.5">
            {t("office.board.empty")}
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {top.map((th) => {
              const working = workingThreadIds.has(th.id);
              const active = th.id === activeThreadId;
              return (
                <li key={th.id}>
                  <button
                    type="button"
                    onClick={() => onPickThread(th.id)}
                    title={th.name ?? t("thread.untitled")}
                    className={cn(
                      "w-full flex items-center gap-1 px-1 py-0.5 rounded text-[10px] transition-colors text-left",
                      active
                        ? "bg-amber-200/80 dark:bg-amber-800/40 text-amber-900 dark:text-amber-100 font-medium"
                        : "hover:bg-amber-100 dark:hover:bg-amber-900/30 text-amber-900/80 dark:text-amber-100/80",
                    )}
                  >
                    {working ? (
                      <span
                        aria-hidden
                        className="size-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0"
                      />
                    ) : (
                      <CornerDownRight className="size-2.5 opacity-50 shrink-0" />
                    )}
                    <span className="truncate">
                      {th.name ?? t("thread.untitled")}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 책상 — 데스크 + 모니터 + 이름표. (캐릭터는 별도 레이어)
// ──────────────────────────────────────────────────────────────────────────

function AgentDesk({
  agent,
  x,
  y,
  working,
  touching,
  file,
  onPickFile,
}: {
  agent: Agent;
  x: number;
  y: number;
  working: boolean;
  touching: boolean;
  file: string | null;
  onPickFile: (path: string) => void;
}) {
  const cls = classesFor(agentColorOf(agent));
  return (
    <div
      className="absolute flex flex-col items-center gap-0.5"
      style={{
        left: `${x}%`,
        top: `${y}%`,
        transform: "translate(-50%, -50%)",
        width: "13%",
      }}
    >
      {/* 모니터 — 작은 CRT 스크린. 클릭 시 그 파일 에디터로. */}
      <button
        type="button"
        disabled={!file}
        onClick={() => file && onPickFile(file)}
        title={file ?? agent.name}
        className={cn(
          "relative w-full max-w-[110px] rounded-sm border border-zinc-700/80 bg-zinc-900 px-1 py-0.5 mono shadow-sm transition-colors",
          file ? "hover:border-foreground cursor-pointer" : "cursor-default",
          working
            ? "ring-1 ring-emerald-500/70 ring-offset-1 ring-offset-card"
            : "",
        )}
        style={{ minHeight: "16px" }}
      >
        <span
          className={cn(
            "block text-[8.5px] truncate leading-tight",
            file
              ? "text-emerald-400"
              : working
                ? "text-emerald-400/70"
                : "text-zinc-500",
          )}
        >
          {file ? basename(file) : working ? "$ thinking…" : "$ idle"}
        </span>
        {touching ? (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-emerald-400 animate-pulse"
          />
        ) : null}
      </button>

      {/* 책상 천판 — 픽셀 책상 대신 단순한 막대로. 캐릭터 시각이 메인이라 책상은
          오버하지 않는 게 깔끔. */}
      <div
        className={cn(
          "w-full rounded-sm shadow-sm",
          "bg-amber-900/70 dark:bg-amber-950",
          working && cls.ring,
          working ? "ring-2 ring-offset-1 ring-offset-card" : "",
        )}
        style={{ height: "5px" }}
      />

      {/* 이름표 — 책상 앞면 살짝 아래. */}
      <span
        className={cn(
          "text-[9px] mono px-1 rounded-sm",
          cls.bgSoft,
          cls.text,
        )}
        title={agent.name}
        style={{ marginTop: "-1px" }}
      >
        @{agent.name}
      </span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 캐릭터 — wander/linger/working 상태머신.
// 자기 책상이 home, idle 산책지는 데코 spot + 다른 동료 책상.
// ──────────────────────────────────────────────────────────────────────────

type CharState = "idle" | "wander" | "linger" | "going" | "working" | "leaving";

const IDLE_ACTIONS = ["🙆", "🥱", "💭", "📱", "🎵", "👀"] as const;

function AgentChar({
  agent,
  homeX,
  homeY,
  working,
  touching,
  file,
  activeTool,
  deskByAgent,
  onPick,
}: {
  agent: Agent;
  homeX: number;
  homeY: number;
  working: boolean;
  touching: boolean;
  file: string | null;
  activeTool: ActiveToolsForAgent | null;
  deskByAgent: Map<string, { x: number; y: number }>;
  onPick: () => void;
}) {
  const personality = useMemo(() => {
    const seed = hashSeed(agent.id);
    return {
      speedMul: 0.8 + ((seed % 100) / 100) * 0.5,
      waitMul: 0.7 + (((seed >> 8) % 100) / 100) * 0.6,
    };
  }, [agent.id]);

  const sitPos = useMemo(
    () => ({ x: homeX, y: homeY + SIT_OFFSET_Y }),
    [homeX, homeY],
  );

  const initial = useMemo(() => {
    if (working) {
      return { pos: sitPos, state: "working" as CharState };
    }
    const seed = hashSeed(agent.id);
    const ox = ((seed >> 4) % 6) - 3;
    return {
      pos: { x: clamp(homeX + ox, 6, 94), y: clamp(homeY - 4, 32, 92) },
      state: "idle" as CharState,
    };
    // homeX/Y 변동시 텔레포트 막으려고 마운트 1회만.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  const [pos, setPos] = useState(initial.pos);
  const [target, setTarget] = useState(initial.pos);
  const [state, setState] = useState<CharState>(initial.state);
  const [destSpot, setDestSpot] = useState<WanderSpot | null>(null);
  const [destDeskAgentId, setDestDeskAgentId] = useState<string | null>(null);
  const [iconIdx, setIconIdx] = useState(0);
  const [idleAction, setIdleAction] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);

  const lastWorkingRef = useRef(working);

  // working 토글.
  useEffect(() => {
    const wasWorking = lastWorkingRef.current;
    lastWorkingRef.current = working;
    if (working && !wasWorking) {
      setTarget(sitPos);
      setDestSpot(null);
      setDestDeskAgentId(null);
      setState("going");
    } else if (!working && wasWorking) {
      // 일 끝나면 책상 옆 한 발짝.
      const seed = hashSeed(agent.id) ^ Date.now();
      const ox = ((seed >> 4) % 8) - 4;
      setTarget({ x: clamp(homeX + ox, 6, 94), y: clamp(homeY - 6, 32, 92) });
      setDestSpot(null);
      setDestDeskAgentId(null);
      setState("leaving");
    }
  }, [working, agent.id, sitPos, homeX, homeY]);

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

  // idle → 50% 데코 spot, 50% 동료 책상 방문. 외톨이면 100% 데코.
  useEffect(() => {
    if (state !== "idle") return;
    const wait = (2500 + Math.random() * 4000) * personality.waitMul;
    const id = window.setTimeout(() => {
      const others = [...deskByAgent.entries()].filter(([id]) => id !== agent.id);
      const visitDesk = others.length > 0 && Math.random() < 0.5;
      if (visitDesk) {
        const [otherId, deskPos] =
          others[Math.floor(Math.random() * others.length)]!;
        const jx = (Math.random() - 0.5) * 4;
        // 동료 책상 *옆* 으로 가서 인사 (정확히 위에 X).
        setTarget({
          x: clamp(deskPos.x + jx + 5, 6, 94),
          y: clamp(deskPos.y - 4, 32, 92),
        });
        setDestSpot(null);
        setDestDeskAgentId(otherId);
      } else {
        const spot =
          WANDER_SPOTS[Math.floor(Math.random() * WANDER_SPOTS.length)]!;
        const jx = (Math.random() - 0.5) * 4;
        const jy = (Math.random() - 0.5) * 3;
        setTarget({
          x: clamp(spot.x + jx, 6, 94),
          y: clamp(spot.y + jy, 32, 92),
        });
        setDestSpot(spot);
        setDestDeskAgentId(null);
      }
      setState("wander");
    }, wait);
    return () => window.clearTimeout(id);
  }, [state, personality.waitMul, deskByAgent, agent.id]);

  // idle micro-action.
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

  // linger 이모지 회전.
  useEffect(() => {
    if (state !== "linger") return;
    setIconIdx(Math.floor(Math.random() * 3));
    const id = window.setInterval(() => {
      setIconIdx((i) => i + 1);
    }, 1800 + Math.random() * 800);
    return () => window.clearInterval(id);
  }, [state, destSpot, destDeskAgentId]);

  // linger → idle.
  useEffect(() => {
    if (state !== "linger") return;
    const wait = (2500 + Math.random() * 3000) * personality.waitMul;
    const id = window.setTimeout(() => {
      setState("idle");
      setDestSpot(null);
      setDestDeskAgentId(null);
    }, wait);
    return () => window.clearTimeout(id);
  }, [state, personality.waitMul]);

  // 머리 위 표시.
  const bubble = useMemo<string | null>(() => {
    if (state === "working") {
      if (file) return `✎ ${basename(file)}`;
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
    if (state === "linger") {
      if (destSpot) {
        return destSpot.bubbles[iconIdx % destSpot.bubbles.length] ?? null;
      }
      if (destDeskAgentId) {
        const tags = ["💬", "👋", "😄"];
        return tags[iconIdx % tags.length] ?? "💬";
      }
    }
    if (state === "idle" && idleAction) return idleAction;
    return null;
  }, [state, file, activeTool, destSpot, destDeskAgentId, iconIdx, idleAction]);

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
        scale={3}
      />
      {touching ? (
        <span
          aria-hidden
          className="absolute -top-1 -right-1 size-2 rounded-full bg-emerald-500 animate-pulse pointer-events-none"
        />
      ) : null}
    </div>
  );
}
