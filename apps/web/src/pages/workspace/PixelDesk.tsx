// 책상 카드 상단의 픽셀 디오라마. 32×12 그리드, 4× scale로 렌더 → 128×48px.
// 색상은 모두 CSS 변수 (var(--pixel-*)) — light/dark 테마는 styles.css가 담당.
// 픽셀당 1개의 <rect> 라 SVG 노드 수가 보일 만한 정도지만, 카드당 한 번이라
// 전체 페이지 부담은 적음. shape-rendering: crispEdges로 sub-pixel 흐림 차단.

import { cn } from "../../lib/utils.js";

// "sprite map" — 32 cols × 12 rows. 글자 = 색상 키.
//   . = 투명 / 배경 (사무실 floor가 비침)
//   M = 모니터 프레임
//   G = 모니터 화면 (working 상태에선 .pixel-desk-active로 펄스)
//   k = 키보드
//   C = 머그컵
//   D = 책상 상판 (밝음)
//   d = 책상 모서리 (어두운 그림자)
//   T = 화분 잎
//   t = 화분 줄기
//   p = 화분 통
//   c = 의자 등받이 (모니터 뒤로 살짝 보임)
const SPRITE: ReadonlyArray<string> = [
  "................................", // 0
  ".......MMMMMMMMMM...............", // 1
  ".......MGGGGGGGGM..........TTT..", // 2
  ".......MGGGGGGGGM.........TTTTT.", // 3
  ".......MGGGGGGGGM..........TTT..", // 4
  ".......MMMMMMMMMM............t..", // 5
  "........MMmmmmM..............t..", // 6
  ".......kkkkkkkkk............ppp.", // 7
  "..CC...kkkkkkkkk............ppp.", // 8
  "..CC............................", // 9
  "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD", // 10
  "dddddddddddddddddddddddddddddddd", // 11
];

// 글자 → CSS var 매핑. var()로 가서 styles.css의 :root / .dark 가 분기.
const COLORS: Record<string, string> = {
  M: "var(--pixel-monitor)",
  G: "var(--pixel-screen)",
  m: "var(--pixel-monitor-stand)",
  k: "var(--pixel-keyboard)",
  C: "var(--pixel-mug)",
  D: "var(--pixel-desk)",
  d: "var(--pixel-desk-edge)",
  T: "var(--pixel-plant-leaf)",
  t: "var(--pixel-plant-stem)",
  p: "var(--pixel-plant-pot)",
};

const W = 32;
const H = SPRITE.length;
const SCALE = 4;

export interface PixelDeskProps {
  /** working 상태일 때 화면이 펄스. */
  active?: boolean;
  className?: string;
}

export function PixelDesk({ active, className }: PixelDeskProps) {
  // 한 번만 펼쳐서 rect 배열을 만든다 — sprite는 상수라 매 렌더 동일.
  const rects: Array<{ x: number; y: number; ch: string }> = [];
  for (let y = 0; y < H; y++) {
    const row = SPRITE[y]!;
    for (let x = 0; x < W; x++) {
      const ch = row[x];
      if (!ch || ch === ".") continue;
      rects.push({ x, y, ch });
    }
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W * SCALE}
      height={H * SCALE}
      className={cn(
        "pixel-desk shrink-0",
        active && "pixel-desk-active",
        className,
      )}
      // crispEdges + image-rendering pixelated → 어떤 zoom에서도 픽셀 윤곽 유지.
      shapeRendering="crispEdges"
      style={{ imageRendering: "pixelated" }}
      aria-hidden
    >
      {rects.map(({ x, y, ch }, i) => (
        <rect
          key={i}
          x={x}
          y={y}
          width={1}
          height={1}
          fill={COLORS[ch] ?? "currentColor"}
          // 화면(G)만 별도 클래스 — active일 때 CSS animation 적용.
          className={ch === "G" ? "pixel-screen" : undefined}
        />
      ))}
    </svg>
  );
}
