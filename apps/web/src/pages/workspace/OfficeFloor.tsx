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
// `icons`는 머리 위에 띄울 이모지 풀 — 머무는 동안 ~2초마다 하나씩 사이클되어
// "같은 자리에 박제"된 인상을 깬다.
type DestKind =
  | "coffee"
  | "books"
  | "plant-l"
  | "plant-r"
  | "window"
  | "whiteboard"
  | "cooler"
  | "chat-corner";
const DESTINATIONS: ReadonlyArray<{
  kind: DestKind;
  x: number;
  y: number;
  icons: ReadonlyArray<string>;
  /** 호버 카드/디버그용 라벨 키. */
  labelKey: string;
}> = [
  { kind: "window", x: 14, y: 30, icons: ["🌤", "🐦", "💭", "🌳"], labelKey: "office.dest.window" },
  { kind: "coffee", x: 44, y: 32, icons: ["☕", "🥐", "😌", "💬"], labelKey: "office.dest.coffee" },
  { kind: "books", x: 86, y: 30, icons: ["📚", "✏️", "🤔", "💡"], labelKey: "office.dest.books" },
  { kind: "plant-l", x: 8, y: 50, icons: ["🪴", "💧", "🌱", "😊"], labelKey: "office.dest.plant" },
  { kind: "plant-r", x: 92, y: 50, icons: ["🪴", "💧", "🌱", "😊"], labelKey: "office.dest.plant" },
  { kind: "whiteboard", x: 62, y: 30, icons: ["🧠", "📝", "✏️", "💡"], labelKey: "office.dest.whiteboard" },
  { kind: "cooler", x: 30, y: 50, icons: ["💧", "🥤", "😮‍💨", "💭"], labelKey: "office.dest.cooler" },
  { kind: "chat-corner", x: 70, y: 55, icons: ["💬", "😄", "🗣", "✨"], labelKey: "office.dest.chat" },
];

// idle 중간에 가끔 끼워넣는 micro-action — 진짜 정지가 아니라 살아있는 인상.
// 매 idle round마다 30% 확률로 발현, 1.5~2.5초 후 사라지고 정상 idle 흐름으로 복귀.
const IDLE_ACTIONS = [
  "🙆", // stretch
  "🥱", // yawn
  "💭", // daydream
  "📱", // phone
  "🎵", // hum
  "👀", // glance around
] as const;

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
  // 해시로 약간씩 다른 속도/대기시간 multiplier 부여, 거기에 "favorite destination"
  // 까지 — 어떤 에이전트는 커피 광이고 어떤 에이전트는 책장에만 박혀있음.
  const personality = useMemo(() => {
    const seed = hashSeed(agent.id);
    const speedMul = 0.8 + ((seed % 100) / 100) * 0.5; // 0.8~1.3
    const waitMul = 0.7 + (((seed >> 8) % 100) / 100) * 0.6; // 0.7~1.3
    const favorite = DESTINATIONS[(seed >> 16) % DESTINATIONS.length]!;
    return { speedMul, waitMul, favorite };
  }, [agent.id]);

  // 마운트 시 `working`이 이미 true면 캐릭터는 책상에 앉은 상태로 시작해야 함
  // — 사용자가 다른 뷰에서 일을 시켜놓고 사무실로 돌아왔는데 캐릭터가 통로에
  // 서있으면 "사무실이 초기화된" 인상. idle 시작은 working=false일 때만.
  const initial = useMemo(() => {
    if (working) {
      return {
        pos: { x: homeX, y: homeY - 8 },
        state: "working" as CharState,
      };
    }
    const seed = hashSeed(agent.id);
    const dest = DESTINATIONS[seed % DESTINATIONS.length]!;
    const ox = ((seed >> 4) % 12) - 6;
    const oy = ((seed >> 8) % 8) - 4;
    return {
      pos: {
        x: clamp(dest.x + ox, 6, 94),
        y: clamp(dest.y + oy, 28, 52),
      },
      state: "idle" as CharState,
    };
    // working은 초회 마운트의 분기점일 뿐 — 중간 변경은 아래 transition useEffect가
    // 따로 처리. 그래서 deps에 의도적으로 포함하지 않음 (eslint 무시).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id, homeX, homeY]);

  const [pos, setPos] = useState(initial.pos);
  const [target, setTarget] = useState(initial.pos);
  const [state, setState] = useState<CharState>(initial.state);
  /** 현재 머무는/가는 destination — linger 시 머리 위 아이콘에 사용. */
  const [destKind, setDestKind] = useState<DestKind | null>(null);
  /** linger 동안 destination 이모지 풀에서 선택된 인덱스 (2초마다 회전). */
  const [iconIdx, setIconIdx] = useState(0);
  /** idle 중에 끼워넣는 micro-action 이모지 (stretch/yawn/think...). null 이면 평범 idle. */
  const [idleAction, setIdleAction] = useState<string | null>(null);
  /** 호버 시 정보 카드 표시. */
  const [hovered, setHovered] = useState(false);
  // ref 초기값을 `working`으로 — 마운트 후 첫 effect 실행에서 wasWorking === working이
  // 되어 잘못된 going 트리거를 막음 (이미 working이면 그대로 working에 안착해 있음).
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
        // 0.025 였을 땐 화면 한 번 가로지르는 데 ~20초 걸려서 정지로 보였음. 3~4배 가속.
        const baseSpeed =
          state === "working"
            ? 0
            : state === "going"
              ? 0.18
              : state === "linger"
                ? 0
                : 0.10; // wander / leaving
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

  // idle → 짧게 쉬다가 새 destination으로 wander. 30% 확률로 favorite, 70% 랜덤.
  // 8~22초 → 2.5~6.5초로 단축. "안 움직이는" 인상 제거.
  useEffect(() => {
    if (state !== "idle") return;
    const wait = (2500 + Math.random() * 4000) * personality.waitMul;
    const id = window.setTimeout(() => {
      const dest =
        Math.random() < 0.3 ? personality.favorite : pickDestination();
      const jx = (Math.random() - 0.5) * 6;
      const jy = (Math.random() - 0.5) * 4;
      setTarget({
        x: clamp(dest.x + jx, 8, 92),
        y: clamp(dest.y + jy, 28, 55),
      });
      setDestKind(dest.kind);
      setState("wander");
    }, wait);
    return () => window.clearTimeout(id);
  }, [state, personality.waitMul, personality.favorite]);

  // idle 도중 30% 확률로 micro-action 발현 (stretch / yawn / think...). 1.5~2.5초 후 사라짐.
  // wander 트리거 타이머와 별개라 두 개가 동시에 돌 수 있음 — 그게 의도.
  useEffect(() => {
    if (state !== "idle") {
      setIdleAction(null);
      return;
    }
    const onset = 600 + Math.random() * 1500;
    const onsetId = window.setTimeout(() => {
      if (Math.random() < 0.3) {
        const action = IDLE_ACTIONS[Math.floor(Math.random() * IDLE_ACTIONS.length)]!;
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

  // linger 진입 시 이모지 인덱스 리셋 + 2초마다 다음 이모지로 회전. 같은 자리에
  // 박제된 인상을 깨고 "뭐 하나 하다 다른 거 하다" 같은 인상.
  useEffect(() => {
    if (state !== "linger" || !destKind) return;
    setIconIdx(Math.floor(Math.random() * 4));
    const id = window.setInterval(() => {
      setIconIdx((i) => i + 1);
    }, 1800 + Math.random() * 800);
    return () => window.clearInterval(id);
  }, [state, destKind]);

  // linger → 목적지에서 2.5~5.5초 머무름 → idle (다음 wander 추첨으로).
  // 5~12초 → 절반으로 단축. 더 자주 새 자리로 옮겨감.
  useEffect(() => {
    if (state !== "linger") return;
    const wait = (2500 + Math.random() * 3000) * personality.waitMul;
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
      if (!dest || dest.icons.length === 0) return null;
      return dest.icons[iconIdx % dest.icons.length] ?? null;
    }
    if (state === "idle" && idleAction) return idleAction;
    return null;
  }, [state, activeTouch, activeTool, destKind, iconIdx, idleAction, t]);

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
