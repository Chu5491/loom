// 애니메이션 사무실 — 캐릭터들이 자기 자리에 가서 일하고, 일이 없으면
// 사무실을 어슬렁거림. 말풍선으로 "지금 뭐하고 있어요"를 보여줌.
//
// 구조:
//   OfficeFloor       = 캔버스(aspect-video) + 책상 배치 + 캐릭터들 자리잡기
//   AgentCharacter    = 한 에이전트 = 한 캐릭터 + 상태머신 + 말풍선
//
// 좌표계는 viewBox(0..100 × 0..100) 기준 % — 컨테이너 폭에 따라 자동 스케일.
// 캐릭터/책상 사이즈는 CSS px로 고정 (찌그러지지 않게).

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ActiveTouch,
  ActiveToolsForAgent,
  Agent,
} from "@loom/core";
import { useI18n } from "../../context/I18nContext.js";
import { agentColorOf } from "../../components/agentColor.js";
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

// agent 색상 → 셔츠 색상으로 사용할 OKLCH 값. agentColor.ts 의 PALETTE 와
// 1:1 매칭 — 새 색상 추가 시 여기도 같이.
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

// 책상은 카펫(y 22~100%) 위에만. 4 × 2 그리드 → 최대 8명 책상. 그 이상은 같은
// 칸을 공유 (얼라이언스 좁아 보임). 캐릭터가 돌아다닐 좁은 통로(30~48%)는
// 첫 책상 행보다 위에 둠.
function deskSlot(index: number): { x: number; y: number } {
  const COLS = 4;
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  // 가로: 4개 균등 — 16, 38, 61, 83 (양쪽 화분/책장과 겹치지 않게).
  const x = 16 + col * 22.5;
  const yByRow = [60, 82];
  const y = yByRow[Math.min(row, yByRow.length - 1)] ?? 82;
  return { x, y };
}

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
      {/* 캔버스 — 16:9 비율, max-w/h로 컨테이너에 맞춤. 두 레이어:
            - 윗부분(0~22%) : 벽 (--office-wall) + 데코 (창문/커피/책장)
            - 아랫부분(22~100%) : 카펫 (--office-carpet) + 책상 + 캐릭터
          벽-바닥 경계엔 "걸레받이"를 1줄 그어 방 안 같은 느낌을 줌. */}
      <div className="relative w-full h-full max-h-[640px] aspect-[16/9] mx-auto rounded-md overflow-hidden shadow-[inset_0_0_0_2px_color-mix(in_oklch,var(--foreground)_8%,transparent),inset_0_0_0_4px_var(--card)] office-room">
        {/* 벽 — 위쪽 22%. 단색에 살짝 격자 무늬 (벽지). */}
        <div className="absolute inset-x-0 top-0 h-[22%] office-wall" />
        {/* 걸레받이 — 벽-바닥 경계 1px(렌더 시) 짙은 띠. */}
        <div
          className="absolute inset-x-0 office-skirt"
          style={{ top: "21.5%", height: "1.2%" }}
        />
        {/* 바닥 — 카펫 톤 + 미세 격자. */}
        <div className="absolute inset-x-0 bottom-0 top-[22%] office-carpet" />

        {/* 데코 — 벽 위에 부착된 요소들. 좌측 창문, 가운데 커피코너, 우측 책장. */}
        <div
          className="absolute pointer-events-none"
          style={{ left: "5%", top: "3%" }}
        >
          <OfficeWindow />
        </div>
        <div
          className="absolute pointer-events-none"
          style={{ left: "44%", top: "5%", transform: "translateX(-50%)" }}
        >
          <OfficeCoffee />
        </div>
        <div
          className="absolute pointer-events-none"
          style={{ right: "5%", top: "1%" }}
        >
          <OfficeBookshelf />
        </div>

        {/* 바닥 화분 — 좌하/우하 모서리에 하나씩. */}
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

        {/* 책상들 — 자리 고정. */}
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

        {/* 캐릭터들. */}
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
      style={{
        left: `${x}%`,
        top: `${y}%`,
        transform: "translate(-50%, -50%)",
      }}
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
//
//  pos, target: viewBox 좌표 (0..100). pos는 "현재 좌표", target은 "걸어가고
//  싶은 곳". 매 프레임 pos를 target 쪽으로 일정 속도로 보간.
//
//  state machine:
//    idle      — target에 도달 → 5~9초 후 "wander"로 새 target 뽑기
//    wander    — 어슬렁 (working도 아니고 home도 아닌 임의 좌표)
//    going     — working 신호로 target=desk 설정. 책상 도달 시 "working"
//    working   — 책상 위에 sit 포즈. 화면 펄스 (PixelDesk active).
//    leaving   — working 끝 → home 약간 옆으로 target → "idle"
// ──────────────────────────────────────────────────────────────────────────

type CharState = "idle" | "going" | "working" | "leaving";

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

  // 시작 위치 — 책상 행과 무관하게 통로(y 30~48) 안에 임의 배치. agent.id
  // 기반 deterministic noise — 새로고침 시 위치가 안 튀게.
  const initial = useMemo(() => {
    const seed = hashSeed(agent.id);
    const ox = (seed % 30) - 15; // -15~14
    const oy = (seed >> 4) % 18; // 0~17
    return {
      x: clamp(homeX + ox, 14, 86),
      y: 30 + oy, // 통로 30 ~ 47
    };
  }, [agent.id, homeX]);

  const [pos, setPos] = useState(initial);
  const [target, setTarget] = useState(initial);
  const [state, setState] = useState<CharState>("idle");
  const lastWorkingRef = useRef(working);

  // working 토글 → 상태 전이.
  useEffect(() => {
    const wasWorking = lastWorkingRef.current;
    lastWorkingRef.current = working;
    if (working && !wasWorking) {
      // 책상에 앉음 — y는 책상 중앙 살짝 위. sit 포즈가 모니터 너머로 머리만 보임.
      setTarget({ x: homeX, y: homeY - 8 });
      setState("going");
    } else if (!working && wasWorking) {
      // 퇴근 — 통로로 한 번에 빠져 나옴.
      setTarget({ x: clamp(homeX + 8, 14, 86), y: 38 + Math.random() * 8 });
      setState("leaving");
    }
  }, [working, homeX, homeY]);

  // 위치 보간 — "걸어다니는" 게임 캐릭터 속도로. 60fps 기준
  //   - wander 0.025 unit/frame ≈ 1.5 unit/sec ≈ 한 걸음(0.4s 봅) ≈ 0.6 unit
  //     (= 캐릭터 절반 너비). Stardew Valley / Habbo 같은 산책 페이스.
  //   - going 0.05 — 부름 받으면 약간 서두르지만 뛰진 않음.
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
          return cur;
        }
        const speed =
          state === "working"
            ? 0
            : state === "going"
              ? 0.05
              : 0.025;
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
  }, [target, state]);

  // idle 상태에서 주기적으로 새 wander target. 진짜 사람처럼 — 멀리 안 가고
  // 자기 주변 한두 발짝 이동만. 사무실 끝에서 끝으로 행군하는 느낌 X.
  useEffect(() => {
    if (state !== "idle") return;
    // 12~32s — 자주 움직이지 않음. 40% 확률로 그냥 가만히.
    const wait = 12000 + Math.random() * 20000;
    const id = window.setTimeout(() => {
      if (Math.random() < 0.4) return; // 가만히 있는 턴
      const r = Math.random;
      // 현재 위치 주변 ±18 / ±8 만큼만 — 작은 영역 산책.
      const nx = clamp(pos.x + (r() * 36 - 18), 14, 86);
      const ny = clamp(pos.y + (r() * 16 - 8), 28, 48);
      setTarget({ x: nx, y: ny });
    }, wait);
    return () => window.clearTimeout(id);
  }, [state, pos]);

  // 말풍선 텍스트 — working 중에만. 활동 종류에 따라 한 줄 요약.
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
    return null;
  }, [state, activeTouch, activeTool, t]);

  // 좌→우 이동이면 정상, 우→좌면 sprite flip.
  const movingLeft = target.x < pos.x;
  const isMoving = state === "going" || state === "leaving" || hasGap(pos, target);
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
      className={cn(
        "absolute pixel-character-wrap cursor-pointer outline-none",
        // pos는 rAF로 매 프레임 직접 갱신 — CSS transition을 덧붙이면 속도가
        // 두 번 보간돼 "둥둥 떠다니는" 느낌이 됨. 의도적으로 transition 없음.
      )}
      style={{
        left: `${pos.x}%`,
        top: `${pos.y}%`,
        transform: "translate(-50%, -100%)",
        zIndex: state === "working" ? 1 : 5,
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
      {/* 이름 라벨 — 자기 자리/이동 중에 머리 옆에 작게. touching이면 라이브 닷. */}
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

// 두 좌표 사이 거리가 epsilon보다 크면 "이동 중".
function hasGap(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y) > 0.5;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// 간단한 string → int 해시. 캐릭터의 deterministic 시작 위치용.
function hashSeed(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h;
}
