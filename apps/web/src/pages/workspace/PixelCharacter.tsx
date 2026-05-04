// 사무실에서 돌아다니는 작은 캐릭터. 12×18 픽셀, 4× 스케일 = 48×72px.
// 색상은 CSS 변수 + agent의 shirt 색상을 prop으로 받아 한 자리에 채움.
// 스프라이트는 3 프레임:
//   - stand: 양 다리 가지런히
//   - walkA: 왼발 앞
//   - walkB: 오른발 앞
// walking=true면 CSS animation으로 walkA ↔ walkB 0.4s 교대.

import { cn } from "../../lib/utils.js";

// 12 cols × 18 rows. 글자:
//   . = 투명
//   H = 머리카락
//   S = 피부 (얼굴/팔)
//   E = 눈
//   T = 셔츠 (agent color, prop)
//   P = 바지
//   B = 신발
const STAND: ReadonlyArray<string> = [
  "............",
  "....HHHH....",
  "...HHHHHH...",
  "..HHSSSSHH..",
  "..HSEESSEH..",
  "..HSSSSSSH..",
  "...SSSSSS...",
  "....SSSS....",
  "...TTTTTT...",
  "..STTTTTTS..",
  "..STTTTTTS..",
  "..STTTTTTS..",
  "...TTTTTT...",
  "...PPPPPP...",
  "...PPPPPP...",
  "...PP..PP...",
  "...PP..PP...",
  "...BB..BB...",
];

const WALK_A: ReadonlyArray<string> = [
  "............",
  "....HHHH....",
  "...HHHHHH...",
  "..HHSSSSHH..",
  "..HSEESSEH..",
  "..HSSSSSSH..",
  "...SSSSSS...",
  "....SSSS....",
  "...TTTTTT...",
  ".STTTTTTT...",
  ".STTTTTTTS..",
  "..STTTTTTS..",
  "...TTTTTT...",
  "...PPPPPP...",
  "...PP.PPP...",
  "...PP..PP...",
  "...BB...PP..",
  "..BBB...BB..",
];

const WALK_B: ReadonlyArray<string> = [
  "............",
  "....HHHH....",
  "...HHHHHH...",
  "..HHSSSSHH..",
  "..HSEESSEH..",
  "..HSSSSSSH..",
  "...SSSSSS...",
  "....SSSS....",
  "...TTTTTT...",
  "...TTTTTTS.",
  "..STTTTTTS..",
  "..STTTTTTS..",
  "...TTTTTT...",
  "...PPPPPP...",
  "...PPP.PP...",
  "...PP..PP...",
  "..PP...BB...",
  "..BB...BBB..",
];

// 책상에 앉은 상태 — 상반신만 보임 (모니터 너머).
const SIT: ReadonlyArray<string> = [
  "............",
  "............",
  "............",
  "............",
  "............",
  "............",
  "....HHHH....",
  "...HHHHHH...",
  "..HHSSSSHH..",
  "..HSEESSEH..",
  "..HSSSSSSH..",
  "...SSSSSS...",
  "....SSSS....",
  "...TTTTTT...",
  "..STTTTTTS..",
  "..STTTTTTS..",
  "..STTTTTTS..",
  "............",
];

const COLORS: Record<string, string> = {
  H: "var(--pixel-char-hair)",
  S: "var(--pixel-char-skin)",
  E: "var(--pixel-char-eye)",
  P: "var(--pixel-char-pants)",
  B: "var(--pixel-char-boots)",
  // T는 prop으로 직접 fill
};

const W = 12;
const H = 18;

function gridToRects(
  sprite: ReadonlyArray<string>,
  shirtColor: string,
): Array<{ x: number; y: number; fill: string }> {
  const out: Array<{ x: number; y: number; fill: string }> = [];
  for (let y = 0; y < sprite.length; y++) {
    const row = sprite[y]!;
    for (let x = 0; x < W; x++) {
      const ch = row[x];
      if (!ch || ch === ".") continue;
      const fill = ch === "T" ? shirtColor : (COLORS[ch] ?? "currentColor");
      out.push({ x, y, fill });
    }
  }
  return out;
}

export interface PixelCharacterProps {
  shirtColor: string;
  /** "walking"이면 두 walk 프레임 교대, "sit"이면 앉은 프레임, 그 외엔 stand. */
  pose: "stand" | "walking" | "sit";
  /** 좌→우 이동 시 false, 우→좌 이동 시 true (transform: scaleX(-1)). */
  flipX?: boolean;
  /** 화면 픽셀 사이즈. 1 sprite-pixel = `scale` CSS 픽셀. */
  scale?: number;
  className?: string;
}

export function PixelCharacter({
  shirtColor,
  pose,
  flipX,
  scale = 4,
  className,
}: PixelCharacterProps) {
  const standRects = gridToRects(STAND, shirtColor);
  const walkARects = gridToRects(WALK_A, shirtColor);
  const walkBRects = gridToRects(WALK_B, shirtColor);
  const sitRects = gridToRects(SIT, shirtColor);

  // 걷기/숨쉬기 살짝 보조 애니메이션은 outer wrapper에서 transform Y bob,
  // inner SVG에선 flipX scaleX(-1)만 — 두 transform이 충돌하지 않게.
  return (
    <span
      className={cn(
        "inline-block",
        pose === "walking" && "pixel-bob-walk",
        pose === "stand" && "pixel-bob-idle",
        className,
      )}
      style={{ width: W * scale, height: H * scale }}
      aria-hidden
    >
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W * scale}
      height={H * scale}
      shapeRendering="crispEdges"
      style={{
        imageRendering: "pixelated",
        transform: flipX ? "scaleX(-1)" : undefined,
      }}
      className="pixel-character"
    >
      {/* 같은 SVG 안에서 group들을 visibility로 토글 — DOM 재마운트 없이
          프레임 전환. .pixel-walk-frame-a/b 는 CSS keyframes가 50%마다 swap. */}
      {pose === "sit" ? (
        <g>
          {sitRects.map((r, i) => (
            <rect
              key={i}
              x={r.x}
              y={r.y}
              width={1}
              height={1}
              fill={r.fill}
            />
          ))}
        </g>
      ) : pose === "walking" ? (
        <>
          <g className="pixel-walk-frame-a">
            {walkARects.map((r, i) => (
              <rect
                key={i}
                x={r.x}
                y={r.y}
                width={1}
                height={1}
                fill={r.fill}
              />
            ))}
          </g>
          <g className="pixel-walk-frame-b">
            {walkBRects.map((r, i) => (
              <rect
                key={i}
                x={r.x}
                y={r.y}
                width={1}
                height={1}
                fill={r.fill}
              />
            ))}
          </g>
        </>
      ) : (
        <g>
          {standRects.map((r, i) => (
            <rect
              key={i}
              x={r.x}
              y={r.y}
              width={1}
              height={1}
              fill={r.fill}
            />
          ))}
        </g>
      )}
    </svg>
    </span>
  );
}
