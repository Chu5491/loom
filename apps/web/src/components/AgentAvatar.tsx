// AgentAvatar — agent.id 해시로 결정되는 고유 SVG 미니 로봇.
//
// 모노그램 배지(AgentInitialBadge)는 작은 자리(파일 탭, 트리, 참여자 stack)에
// 적합하지만 회의실의 *주인공* 자리에는 단조로움. 이건 그 자리용 — 각 에이전트
// 마다 머리 모양/안테나/눈/입/몸체가 deterministic 하게 다른 mini bot.
//
// Variants:
//   head        × 3   (rounded-rect, oval, hexagon)
//   antenna     × 3   (single bulb, twin bulbs, line+bulb)
//   eyes        × 4   (dots / bars / cyclops / arches)
//   mouth       × 3   (line, smile, LED grid)
//   body        × 2   (square, rounded)
//   accent dot  × 4   (위치 변화)
//   color       — agentColor 그대로
// = 3·3·4·3·2·4 = 864 조합
//
// State 애니메이션:
//   idle      → 아무 것 없음 (외부에서 bob 처리)
//   thinking  → 안테나 LED 천천히 펄스
//   working   → 안테나 LED 빠르게 펄스 + 눈 빈도 깜빡
//   editing   → 입이 LED-grid 처럼 깜빡

import type { Agent } from "@loom/core";
import { agentColorOf } from "./agentColor.js";
import { cn } from "../lib/utils.js";

// agentColor → SVG 색상 (3톤: 본체 / accent / glow).
const COLOR_MAP: Record<
  string,
  { bg: string; accent: string; glow: string; eye: string }
> = {
  sky: { bg: "#0ea5e9", accent: "#075985", glow: "#7dd3fc", eye: "#f0f9ff" },
  emerald: { bg: "#10b981", accent: "#065f46", glow: "#6ee7b7", eye: "#ecfdf5" },
  amber: { bg: "#f59e0b", accent: "#78350f", glow: "#fcd34d", eye: "#fffbeb" },
  rose: { bg: "#f43f5e", accent: "#881337", glow: "#fda4af", eye: "#fff1f2" },
  violet: { bg: "#8b5cf6", accent: "#4c1d95", glow: "#c4b5fd", eye: "#f5f3ff" },
  teal: { bg: "#14b8a6", accent: "#134e4a", glow: "#5eead4", eye: "#f0fdfa" },
  fuchsia: { bg: "#d946ef", accent: "#701a75", glow: "#f0abfc", eye: "#fdf4ff" },
  lime: { bg: "#84cc16", accent: "#365314", glow: "#bef264", eye: "#f7fee7" },
  orange: { bg: "#f97316", accent: "#7c2d12", glow: "#fdba74", eye: "#fff7ed" },
  cyan: { bg: "#06b6d4", accent: "#155e75", glow: "#67e8f9", eye: "#ecfeff" },
  indigo: { bg: "#6366f1", accent: "#312e81", glow: "#a5b4fc", eye: "#eef2ff" },
  slate: { bg: "#64748b", accent: "#1e293b", glow: "#cbd5e1", eye: "#f8fafc" },
};

function hashSeed(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

export type AvatarState = "idle" | "thinking" | "working" | "editing";

export function AgentAvatar({
  agent,
  size = 56,
  state = "idle",
  className,
  ariaLabel,
}: {
  agent: Agent;
  size?: number;
  state?: AvatarState;
  className?: string;
  ariaLabel?: string;
}) {
  const seed = hashSeed(agent.id);
  const color = COLOR_MAP[agentColorOf(agent)] ?? COLOR_MAP.slate!;

  const headShape = seed % 3;
  const antenna = (seed >> 3) % 3;
  const eyes = (seed >> 6) % 4;
  const mouth = (seed >> 9) % 3;
  const body = (seed >> 12) % 2;
  const accentSide = (seed >> 15) % 4;

  // LED 빈도. working = 0.6s, thinking = 1.4s, idle = no animate.
  const ledDur =
    state === "working" ? "0.6s" : state === "thinking" ? "1.4s" : null;

  // 눈 깜빡 빈도.
  const blinkDur =
    state === "working" ? "2.5s" : state === "thinking" ? "4s" : null;

  // editing 시 LED 입 빠른 깜빡.
  const mouthBlink = state === "editing";

  return (
    <svg
      viewBox="0 0 56 56"
      width={size}
      height={size}
      className={cn("select-none", className)}
      role="img"
      aria-label={ariaLabel ?? `@${agent.name}`}
    >
      {/* ─ Antenna ─ */}
      {antenna === 0 ? (
        <g>
          <line
            x1="28"
            y1="4"
            x2="28"
            y2="12"
            stroke={color.accent}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <circle cx="28" cy="3.5" r="2.2" fill={color.glow}>
            {ledDur ? (
              <animate
                attributeName="opacity"
                values="0.5;1;0.5"
                dur={ledDur}
                repeatCount="indefinite"
              />
            ) : null}
          </circle>
        </g>
      ) : antenna === 1 ? (
        <g>
          <line
            x1="22"
            y1="6"
            x2="22"
            y2="12"
            stroke={color.accent}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <line
            x1="34"
            y1="6"
            x2="34"
            y2="12"
            stroke={color.accent}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <circle cx="22" cy="5" r="1.8" fill={color.glow}>
            {ledDur ? (
              <animate
                attributeName="opacity"
                values="0.5;1;0.5"
                dur={ledDur}
                repeatCount="indefinite"
              />
            ) : null}
          </circle>
          <circle cx="34" cy="5" r="1.8" fill={color.glow}>
            {ledDur ? (
              <animate
                attributeName="opacity"
                values="1;0.5;1"
                dur={ledDur}
                repeatCount="indefinite"
              />
            ) : null}
          </circle>
        </g>
      ) : (
        <g>
          <line
            x1="20"
            y1="5"
            x2="36"
            y2="5"
            stroke={color.accent}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <circle cx="28" cy="5" r="2.2" fill={color.glow}>
            {ledDur ? (
              <animate
                attributeName="opacity"
                values="0.5;1;0.5"
                dur={ledDur}
                repeatCount="indefinite"
              />
            ) : null}
          </circle>
          <line
            x1="28"
            y1="5"
            x2="28"
            y2="12"
            stroke={color.accent}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </g>
      )}

      {/* ─ Head ─ */}
      {headShape === 0 ? (
        <rect
          x="9"
          y="12"
          width="38"
          height="26"
          rx="7"
          fill={color.bg}
          stroke={color.accent}
          strokeWidth="1"
        />
      ) : headShape === 1 ? (
        <ellipse
          cx="28"
          cy="25"
          rx="19"
          ry="13"
          fill={color.bg}
          stroke={color.accent}
          strokeWidth="1"
        />
      ) : (
        <polygon
          points="28,12 44,17 44,33 28,38 12,33 12,17"
          fill={color.bg}
          stroke={color.accent}
          strokeWidth="1"
        />
      )}

      {/* ─ Visor (눈 영역 어두운 배경) ─ */}
      <rect
        x="14"
        y="18"
        width="28"
        height="10"
        rx="4"
        fill={color.accent}
        opacity="0.5"
      />

      {/* ─ Eyes ─ */}
      {eyes === 0 ? (
        <g>
          <circle cx="20" cy="23" r="2" fill={color.eye}>
            {blinkDur ? (
              <animate
                attributeName="ry"
                values="2;0.3;2;2"
                keyTimes="0;0.05;0.1;1"
                dur={blinkDur}
                repeatCount="indefinite"
              />
            ) : null}
          </circle>
          <circle cx="36" cy="23" r="2" fill={color.eye}>
            {blinkDur ? (
              <animate
                attributeName="ry"
                values="2;0.3;2;2"
                keyTimes="0;0.05;0.1;1"
                dur={blinkDur}
                repeatCount="indefinite"
              />
            ) : null}
          </circle>
        </g>
      ) : eyes === 1 ? (
        <g>
          <rect x="16" y="22" width="8" height="2.5" rx="1.2" fill={color.eye} />
          <rect x="32" y="22" width="8" height="2.5" rx="1.2" fill={color.eye} />
        </g>
      ) : eyes === 2 ? (
        <ellipse cx="28" cy="23" rx="9" ry="2.5" fill={color.eye}>
          {blinkDur ? (
            <animate
              attributeName="ry"
              values="2.5;0.4;2.5;2.5"
              keyTimes="0;0.05;0.1;1"
              dur={blinkDur}
              repeatCount="indefinite"
            />
          ) : null}
        </ellipse>
      ) : (
        <g>
          <path
            d={`M 16 24 Q 20 19 24 24`}
            stroke={color.eye}
            strokeWidth="1.8"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d={`M 32 24 Q 36 19 40 24`}
            stroke={color.eye}
            strokeWidth="1.8"
            fill="none"
            strokeLinecap="round"
          />
        </g>
      )}

      {/* ─ Mouth ─ */}
      {mouth === 0 ? (
        <line
          x1="20"
          y1="33"
          x2="36"
          y2="33"
          stroke={color.eye}
          strokeWidth="1.6"
          strokeLinecap="round"
        >
          {mouthBlink ? (
            <animate
              attributeName="opacity"
              values="1;0.3;1"
              dur="0.5s"
              repeatCount="indefinite"
            />
          ) : null}
        </line>
      ) : mouth === 1 ? (
        <path
          d="M 20 32 Q 28 36 36 32"
          stroke={color.eye}
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
        >
          {mouthBlink ? (
            <animate
              attributeName="opacity"
              values="1;0.3;1"
              dur="0.5s"
              repeatCount="indefinite"
            />
          ) : null}
        </path>
      ) : (
        <g>
          {[0, 1, 2, 3, 4].map((i) => (
            <rect
              key={i}
              x={20 + i * 3.2}
              y="32"
              width="2"
              height="2"
              fill={color.eye}
              rx="0.4"
            >
              {mouthBlink ? (
                <animate
                  attributeName="opacity"
                  values="0.3;1;0.3"
                  dur="0.5s"
                  begin={`${i * 0.1}s`}
                  repeatCount="indefinite"
                />
              ) : null}
            </rect>
          ))}
        </g>
      )}

      {/* ─ Body ─ */}
      <rect
        x="16"
        y="38"
        width="24"
        height="10"
        rx={body === 0 ? "2.5" : "5"}
        fill={color.accent}
      />
      {/* 어깨선 — neck/shoulder transition. */}
      <rect
        x="22"
        y="36"
        width="12"
        height="3"
        rx="1.2"
        fill={color.accent}
        opacity="0.85"
      />

      {/* ─ Body accent dot — 가슴의 작은 LED. */}
      <circle
        cx={accentSide < 2 ? "22" : "34"}
        cy="42"
        r="1.4"
        fill={color.glow}
      >
        {ledDur ? (
          <animate
            attributeName="opacity"
            values="0.4;1;0.4"
            dur={ledDur}
            repeatCount="indefinite"
          />
        ) : null}
      </circle>

      {/* ─ 팔 stub ─ */}
      <rect x="11" y="40" width="4" height="6" rx="1.5" fill={color.accent} />
      <rect x="41" y="40" width="4" height="6" rx="1.5" fill={color.accent} />
    </svg>
  );
}
