// 애니메이션 사무실 — 타이쿤 게임 톤. 캐릭터들이 자기 자리만 왕복하지 않고,
// 사무실의 여러 "destinations"(커피·책장·화분)를 돌아다니다 일이 들어오면
// 자기 책상으로 출근. 호버 = 작은 정보 카드, 클릭 = 그 에이전트와 대화 시작.
//
// State machine:
//   idle      — 잠깐 멈춤. 8~18초 후 다음 destination 추첨 → wander.
//   wander    — 임의 destination으로 걸어감. 도착 시 linger.
//   linger    — destination에서 5~12초 머무름. 머리 위에 destination 아이콘.
//   going     — working 신호 → 책상으로 출근.
//   working   — 책상에 앉음. 화면 펄스, 말풍선에 활동.
//   leaving   — 일 끝. 통로로 한 발짝 → idle.

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ActiveTouch,
  ActiveToolsForAgent,
  Agent,
} from "@loom/core";
import { useI18n } from "../../context/I18nContext.js";
import { agentColorOf, classesFor } from "../../components/agentColor.js";
import { cn } from "../../lib/utils.js";
import { basename } from "../../lib/path.js";
import {
  OfficeBookshelf,
  OfficeCoffee,
  OfficePlant,
  OfficeWindow,
} from "./OfficeDecor.js";
import { PixelCharacter } from "./PixelCharacter.js";
import { PixelDesk } from "./PixelDesk.js";
import { SpeechBubble } from "./SpeechBubble.js";

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

// 책상 슬롯 (고정). 4 × 2 그리드. 상단 22%는 벽이라 책상은 카펫 위에만.
function deskSlot(index: number): { x: number; y: number } {
  const COLS = 4;
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  const x = 16 + col * 22.5;
  const yByRow = [60, 82];
  const y = yByRow[Math.min(row, yByRow.length - 1)] ?? 82;
  return { x, y };
}

// 사무실의 "쉬는 곳" — 데코 아이템 앞에 캐릭터가 멈춰 머무는 spot.
// 좌표는 OfficeDecor의 시각 위치와 1:1 매칭 (해당 데코 아래쪽 통로).
type DestKind = "coffee" | "books" | "plant-l" | "plant-r" | "window";
const DESTINATIONS: ReadonlyArray<{
  kind: DestKind;
  x: number;
  y: number;
  /** 머무는 동안 머리 위에 띄울 이모지. */
  icon: string;
  /** 호버 카드/디버그용 라벨 키. */
  labelKey: string;
}> = [
  { kind: "window", x: 14, y: 30, icon: "🌤", labelKey: "office.dest.window" },
  { kind: "coffee", x: 44, y: 32, icon: "☕", labelKey: "office.dest.coffee" },
  { kind: "books", x: 86, y: 30, icon: "📚", labelKey: "office.dest.books" },
  { kind: "plant-l", x: 8, y: 50, icon: "🪴", labelKey: "office.dest.plant" },
  { kind: "plant-r", x: 92, y: 50, icon: "🪴", labelKey: "office.dest.plant" },
];

export function OfficeFloor({
  agents,
  workingIds,
  touchingIds,
  activeTouches,
  activeTools,
  onPickAgent,
}: {
  agents: Agent[];
  workingIds: Set<string>;
  touchingIds: Set<string>;
  activeTouches: ActiveTouch[];
  activeTools: ActiveToolsForAgent[];
  onPickAgent: (id: string) => void;
}) {
  const { t } = useI18n();

  const touchByAgent = useMemo(() => {
    const m = new Map<string, ActiveTouch>();
    for (const tch of activeTouches) {
      if (!m.has(tch.agentId)) m.set(tch.agentId, tch);
    }
    return m;
  }, [activeTouches]);
  const toolsByAgent = useMemo(() => {
    const m = new Map<string, ActiveToolsForAgent>();
    for (const x of activeTools) {
      if (!m.has(x.agentId)) m.set(x.agentId, x);
    }
    return m;
  }, [activeTools]);

  if (agents.length === 0) {
    return (
      <div className="flex-1 office-floor flex items-center justify-center text-sm text-muted-foreground italic">
        {t("office.empty")}
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center p-4 office-room-outer overflow-hidden">
      <div className="relative w-full h-full max-h-[640px] aspect-[16/9] mx-auto rounded-md overflow-hidden shadow-[inset_0_0_0_2px_color-mix(in_oklch,var(--foreground)_8%,transparent),inset_0_0_0_4px_var(--card)] office-room">
        {/* 벽 */}
        <div className="absolute inset-x-0 top-0 h-[22%] office-wall" />
        <div
          className="absolute inset-x-0 office-skirt"
          style={{ top: "21.5%", height: "1.2%" }}
        />
        {/* 카펫 */}
        <div className="absolute inset-x-0 bottom-0 top-[22%] office-carpet" />

        {/* 데코 */}
        <div className="absolute pointer-events-none" style={{ left: "5%", top: "3%" }}>
          <OfficeWindow />
        </div>
        <div
          className="absolute pointer-events-none"
          style={{ left: "44%", top: "5%", transform: "translateX(-50%)" }}
        >
          <OfficeCoffee />
        </div>
        <div className="absolute pointer-events-none" style={{ right: "5%", top: "1%" }}>
          <OfficeBookshelf />
        </div>
        <div className="absolute pointer-events-none" style={{ left: "1%", bottom: "1%" }}>
          <OfficePlant />
        </div>
        <div className="absolute pointer-events-none" style={{ right: "1%", bottom: "1%" }}>
          <OfficePlant />
        </div>

        {/* 책상 */}
        {agents.map((a, i) => {
          const slot = deskSlot(i);
          return (
            <Desk
              key={`desk-${a.id}`}
              x={slot.x}
              y={slot.y}
              active={workingIds.has(a.id)}
              label={a.name}
            />
          );
        })}

        {/* 캐릭터 */}
        {agents.map((a, i) => {
          const slot = deskSlot(i);
          return (
            <AgentCharacter
              key={a.id}
              agent={a}
              homeX={slot.x}
              homeY={slot.y}
              working={workingIds.has(a.id)}
              touching={touchingIds.has(a.id)}
              activeTouch={touchByAgent.get(a.id) ?? null}
              activeTool={toolsByAgent.get(a.id) ?? null}
              onPick={() => onPickAgent(a.id)}
            />
          );
        })}
      </div>
    </div>
  );
}

function Desk({
  x,
  y,
  active,
  label,
}: {
  x: number;
  y: number;
  active: boolean;
  label: string;
}) {
  return (
    <div
      className="absolute pointer-events-none flex flex-col items-center gap-0.5"
      style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" }}
    >
      <PixelDesk active={active} />
      <span
        className="text-[10px] mono text-muted-foreground/70 truncate max-w-[120px]"
        title={label}
      >
        {label}
      </span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// AgentCharacter — 한 캐릭터의 모든 행동 로직.
// ──────────────────────────────────────────────────────────────────────────

type CharState = "idle" | "wander" | "linger" | "going" | "working" | "leaving";

function AgentCharacter({
  agent,
  homeX,
  homeY,
  working,
  touching,
  activeTouch,
  activeTool,
  onPick,
}: {
  agent: Agent;
  homeX: number;
  homeY: number;
  working: boolean;
  touching: boolean;
  activeTouch: ActiveTouch | null;
  activeTool: ActiveToolsForAgent | null;
  onPick: () => void;
}) {
  const { t } = useI18n();

  // 캐릭터 personality — 같은 사무실에 똑같은 사람만 있으면 재미없음. agent.id
  // 해시로 약간씩 다른 속도/대기시간 multiplier (0.7~1.3) 부여. 어떤 에이전트는
  // 부지런하게 움직이고 어떤 에이전트는 느긋함.
  const personality = useMemo(() => {
    const seed = hashSeed(agent.id);
    const speedMul = 0.7 + ((seed % 100) / 100) * 0.6; // 0.7~1.3
    const waitMul = 0.6 + (((seed >> 8) % 100) / 100) * 0.8; // 0.6~1.4
    return { speedMul, waitMul };
  }, [agent.id]);

  // 시작 위치 — 임의 destination 근처. 페이지 로드 직후 다 같은 자리에 있지 않게.
  const initial = useMemo(() => {
    const seed = hashSeed(agent.id);
    const dest = DESTINATIONS[seed % DESTINATIONS.length]!;
    const ox = ((seed >> 4) % 12) - 6;
    const oy = ((seed >> 8) % 8) - 4;
    return {
      x: clamp(dest.x + ox, 6, 94),
      y: clamp(dest.y + oy, 28, 52),
    };
  }, [agent.id]);

  const [pos, setPos] = useState(initial);
  const [target, setTarget] = useState(initial);
  const [state, setState] = useState<CharState>("idle");
  /** 현재 머무는/가는 destination — linger 시 머리 위 아이콘에 사용. */
  const [destKind, setDestKind] = useState<DestKind | null>(null);
  /** 호버 시 정보 카드 표시. */
  const [hovered, setHovered] = useState(false);
  const lastWorkingRef = useRef(working);

  // working 토글 → 즉시 인터럽트. linger / wander 중이어도 책상으로 출근.
  useEffect(() => {
    const wasWorking = lastWorkingRef.current;
    lastWorkingRef.current = working;
    if (working && !wasWorking) {
      setTarget({ x: homeX, y: homeY - 8 });
      setDestKind(null);
      setState("going");
    } else if (!working && wasWorking) {
      setTarget({
        x: clamp(homeX + 8, 14, 86),
        y: 38 + Math.random() * 8,
      });
      setDestKind(null);
      setState("leaving");
    }
  }, [working, homeX, homeY]);

  // 위치 보간. 사람 걸음 페이스. personality.speedMul로 살짝씩 다르게.
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
              ? 0.05
              : state === "linger"
                ? 0
                : 0.025;
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

  // idle → 몇 초 후 새 destination으로 wander.
  useEffect(() => {
    if (state !== "idle") return;
    const wait = (8000 + Math.random() * 14000) * personality.waitMul;
    const id = window.setTimeout(() => {
      // 25% 확률로 가만히 한 라운드 더.
      if (Math.random() < 0.25) return;
      const dest = pickDestination();
      // dest 좌표 주변 ±3 jitter — 매번 정확히 같은 자리에 모이지 않게.
      const jx = (Math.random() - 0.5) * 6;
      const jy = (Math.random() - 0.5) * 4;
      setTarget({
        x: clamp(dest.x + jx, 8, 92),
        y: clamp(dest.y + jy, 28, 52),
      });
      setDestKind(dest.kind);
      setState("wander");
    }, wait);
    return () => window.clearTimeout(id);
  }, [state, personality.waitMul]);

  // linger → 목적지에서 5~12초 머무름 → idle (다음 wander 추첨으로).
  useEffect(() => {
    if (state !== "linger") return;
    const wait = (5000 + Math.random() * 7000) * personality.waitMul;
    const id = window.setTimeout(() => {
      setState("idle");
      setDestKind(null);
    }, wait);
    return () => window.clearTimeout(id);
  }, [state, personality.waitMul]);

  // 머리 위 표시: working이면 활동 텍스트, linger면 destination 이모지, 그 외 X.
  const bubble = useMemo<string | null>(() => {
    if (state === "working") {
      if (activeTouch && activeTouch.paths[0]) {
        return `✎ ${basename(activeTouch.paths[0])}`;
      }
      const latest = activeTool?.recent[activeTool.recent.length - 1];
      if (latest) {
        if (latest.name.startsWith("mcp__")) {
          const server = latest.name.split("__")[1] ?? "mcp";
          return `🔌 ${server}`;
        }
        if (latest.target) {
          const short = latest.target.split("/").pop() ?? latest.target;
          return `${latest.name} ${short.slice(0, 18)}`;
        }
        return latest.name;
      }
      return "…";
    }
    if (state === "going") return t("office.bubble.heading");
    if (state === "leaving") return t("office.bubble.done");
    if (state === "linger" && destKind) {
      const dest = DESTINATIONS.find((d) => d.kind === destKind);
      return dest?.icon ?? null;
    }
    return null;
  }, [state, activeTouch, activeTool, destKind, t]);

  const isMoving = state === "going" || state === "leaving" || state === "wander";
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
      className={cn(
        "absolute pixel-character-wrap cursor-pointer outline-none",
      )}
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
      {/* 이름 라벨 — 머리 옆 작게. touching이면 라이브 닷. */}
      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-0.5 text-[9px] mono text-muted-foreground/80 whitespace-nowrap pointer-events-none flex items-center gap-0.5">
        {touching ? (
          <span
            aria-hidden
            className="size-1 rounded-full bg-emerald-500 animate-pulse"
          />
        ) : null}
        @{agent.name}
      </div>

      {/* 호버 정보 카드 — "지금 뭐하는 사람인지" 한 눈에. 클릭하면 채팅 시작이라
          카드에 hint 한 줄 추가. */}
      {hovered ? (
        <CharacterCard
          agent={agent}
          state={state}
          destKind={destKind}
          activeTouch={activeTouch}
          activeTool={activeTool}
        />
      ) : null}
    </div>
  );
}

function CharacterCard({
  agent,
  state,
  destKind,
  activeTouch,
  activeTool,
}: {
  agent: Agent;
  state: CharState;
  destKind: DestKind | null;
  activeTouch: ActiveTouch | null;
  activeTool: ActiveToolsForAgent | null;
}) {
  const { t } = useI18n();
  const cls = classesFor(agentColorOf(agent));

  const stateLabel = (() => {
    if (state === "working") return t("office.card.working");
    if (state === "going") return t("office.card.heading");
    if (state === "leaving") return t("office.card.leaving");
    if (state === "linger" && destKind) {
      return t(DESTINATIONS.find((d) => d.kind === destKind)?.labelKey ?? "office.card.idle");
    }
    if (state === "wander") return t("office.card.wandering");
    return t("office.card.idle");
  })();

  const fileNow = activeTouch?.paths[0] ?? null;
  const recentTools = (activeTool?.recent ?? []).slice(-3).reverse();
  const mcpServers = activeTool?.mcpServers ?? [];

  return (
    <div
      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-7 z-30 pointer-events-none"
      role="tooltip"
    >
      <div className="rounded-md border border-border bg-popover/95 backdrop-blur shadow-lg px-2.5 py-1.5 min-w-[160px] max-w-[220px]">
        <div className="flex items-baseline gap-1.5">
          <span className={cn("text-[12px] font-semibold truncate", cls.text)}>
            @{agent.name}
          </span>
          {agent.role ? (
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 truncate">
              {agent.role}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 text-[11px] text-foreground/80">{stateLabel}</div>
        {fileNow ? (
          <div
            className="mt-1 text-[10px] mono text-emerald-700 dark:text-emerald-300 truncate"
            title={fileNow}
          >
            ✎ {basename(fileNow)}
          </div>
        ) : null}
        {recentTools.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-0.5">
            {recentTools.map((t, i) => (
              <span
                key={i}
                className="inline-flex items-center px-1 h-3.5 rounded text-[9px] mono bg-foreground/[0.06] text-muted-foreground"
              >
                {t.name.startsWith("mcp__") ? "🔌" : t.name}
              </span>
            ))}
          </div>
        ) : null}
        {mcpServers.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-0.5">
            {mcpServers.slice(0, 3).map((s) => (
              <span
                key={s}
                className="inline-flex items-center px-1 h-3.5 rounded text-[9px] mono bg-violet-500/10 text-violet-700 dark:text-violet-300"
              >
                {s}
              </span>
            ))}
          </div>
        ) : null}
        <div className="mt-1.5 text-[9px] text-muted-foreground/70 italic">
          {t("office.card.clickHint")}
        </div>
      </div>
      {/* 꼬리 */}
      <span
        aria-hidden
        className="absolute left-1/2 -translate-x-1/2 top-full"
        style={{
          width: 0,
          height: 0,
          borderLeft: "5px solid transparent",
          borderRight: "5px solid transparent",
          borderTop: "5px solid var(--popover)",
        }}
      />
    </div>
  );
}

function pickDestination() {
  return DESTINATIONS[Math.floor(Math.random() * DESTINATIONS.length)]!;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function hashSeed(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h;
}
