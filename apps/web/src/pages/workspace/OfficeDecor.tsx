// 사무실 분위기 — 캐릭터/책상 외의 데코. 모두 fixed 위치, 인터랙티브 X.
// SVG <rect> 픽셀 아트 + CSS 변수로 light/dark 동시 대응. 픽셀 게임의
// "방 안에 가구 깔린" 느낌을 위해 작은 모티프들(창문/커피머신/책장/화분)을
// 사무실 가장자리에 배치.

import { cn } from "../../lib/utils.js";

// 작은 SVG-rect 픽셀 헬퍼. 같은 패턴 반복이라 한 번만 정의.
function gridSvg({
  rows,
  colors,
  scale = 4,
  className,
}: {
  rows: ReadonlyArray<string>;
  colors: Record<string, string>;
  scale?: number;
  className?: string;
}) {
  const w = rows[0]?.length ?? 0;
  const h = rows.length;
  const rects: Array<{ x: number; y: number; fill: string }> = [];
  for (let y = 0; y < h; y++) {
    const row = rows[y]!;
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      if (!ch || ch === ".") continue;
      const fill = colors[ch];
      if (fill) rects.push({ x, y, fill });
    }
  }
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={w * scale}
      height={h * scale}
      shapeRendering="crispEdges"
      style={{ imageRendering: "pixelated" }}
      className={className}
      aria-hidden
    >
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={1} height={1} fill={r.fill} />
      ))}
    </svg>
  );
}

// ── 창문 (24×16) ────────────────────────────────────────
//   F = frame (어두운 나무)
//   S = sky (light → blue, dark → midnight)
//   X = mullion (창살)
//   L = sun/moon halo
//   M = sun/moon
const WINDOW: ReadonlyArray<string> = [
  "FFFFFFFFFFFFFFFFFFFFFFFF",
  "FSSSSSSSSSSSXSSSSSSSSSSF",
  "FSSSSSSSSLSSXSSSSSSSSSSF",
  "FSSSSSSSLLLSXSSSSSSSSSSF",
  "FSSSSSSSLMLSXSSSSSSSSSSF",
  "FSSSSSSSLLLSXSSSSSSSSSSF",
  "FSSSSSSSSLSSXSSSSSSSSSSF",
  "FSSSSSSSSSSSXSSSSSSSSSSF",
  "FXXXXXXXXXXXXXXXXXXXXXXF",
  "FSSSSSSSSSSSXSSSSSSSSSSF",
  "FSSSSSSSSSSSXSSSSSSSSSSF",
  "FSSSSSSSSSSSXSSSSSSSSSSF",
  "FSSSSSSSSSSSXSSSSSSSSSSF",
  "FSSSSSSSSSSSXSSSSSSSSSSF",
  "FSSSSSSSSSSSXSSSSSSSSSSF",
  "FFFFFFFFFFFFFFFFFFFFFFFF",
];
const WINDOW_COLORS: Record<string, string> = {
  F: "var(--decor-window-frame)",
  S: "var(--decor-window-sky)",
  X: "var(--decor-window-frame)",
  L: "var(--decor-window-halo)",
  M: "var(--decor-window-sun)",
};

// ── 커피 코너 (16×14) ──────────────────────────────────
//   C = counter top
//   c = counter front
//   M = espresso 머신 본체 (검정)
//   B = 머신 베이스
//   S = steam (밝은 회색)
//   p = pot 손잡이 (어두운 회색)
//   K = 커피색 (브라운)
//   D = 컵 (흰색-ish)
const COFFEE: ReadonlyArray<string> = [
  ".....SS.........",
  "....S..S........",
  "....S..S........",
  ".....S..........",
  "...MMMMMMMM.....",
  "...MKKKKKKM.....",
  "...MKKKKKKM.....",
  "...MMMMMMMM.....",
  "...BBBBBBBB.....",
  "............DD..",
  "...........DDDD.",
  "............DD..",
  "CCCCCCCCCCCCCCCC",
  "cccccccccccccccc",
];
const COFFEE_COLORS: Record<string, string> = {
  C: "var(--decor-counter)",
  c: "var(--decor-counter-edge)",
  M: "var(--decor-machine)",
  B: "var(--decor-machine-base)",
  S: "var(--decor-steam)",
  K: "var(--pixel-mug)",
  D: "var(--decor-cup)",
};

// ── 화분 (10×14) ───────────────────────────────────────
//   L = 잎 (sage/green)
//   l = 잎 highlight
//   s = 줄기
//   p = 화분 통
//   P = 화분 가장자리(어두움)
const PLANT: ReadonlyArray<string> = [
  "...LLL....",
  "..LLLLL...",
  ".LLLlLLL..",
  "LLLLlLLLL.",
  ".LLLLLLL..",
  "..LLsLL...",
  "...sss....",
  "...sss....",
  "..pppppp..",
  "..pppppp..",
  "..pppppp..",
  "..PPPPPP..",
  "...PPPP...",
  "....PP....",
];
const PLANT_COLORS: Record<string, string> = {
  L: "var(--pixel-plant-leaf)",
  l: "var(--decor-plant-highlight)",
  s: "var(--pixel-plant-stem)",
  p: "var(--pixel-plant-pot)",
  P: "var(--decor-plant-pot-edge)",
};

// ── 책장 (16×24, 세로) ─────────────────────────────────
//   F = 책장 프레임
//   r,o,y,g,b,p = 책 색상 (책 등 색깔)
//   . = 빈 공간
const BOOKSHELF: ReadonlyArray<string> = [
  "FFFFFFFFFFFFFFFF",
  "FrrrooyybbggppFF",
  "FrrrooyybbggppFF",
  "FrrrooyybbggppFF",
  "FrrrooyybbggppFF",
  "FFFFFFFFFFFFFFFF",
  "FppgggrrooyybbFF",
  "FppgggrrooyybbFF",
  "FppgggrrooyybbFF",
  "FppgggrrooyybbFF",
  "FFFFFFFFFFFFFFFF",
  "FbbyyrrooppggrrFF".slice(0, 16),
  "FbbyyrrooppggrrFF".slice(0, 16),
  "FbbyyrrooppggrrFF".slice(0, 16),
  "FbbyyrrooppggrrFF".slice(0, 16),
  "FFFFFFFFFFFFFFFF",
  "FrrooyyggbbpprrFF".slice(0, 16),
  "FrrooyyggbbpprrFF".slice(0, 16),
  "FrrooyyggbbpprrFF".slice(0, 16),
  "FrrooyyggbbpprrFF".slice(0, 16),
  "FFFFFFFFFFFFFFFF",
  "FFFFFFFFFFFFFFFF",
  "FFFFFFFFFFFFFFFF",
  "FFFFFFFFFFFFFFFF",
];
const BOOKSHELF_COLORS: Record<string, string> = {
  F: "var(--decor-shelf-frame)",
  r: "var(--decor-book-r)",
  o: "var(--decor-book-o)",
  y: "var(--decor-book-y)",
  g: "var(--decor-book-g)",
  b: "var(--decor-book-b)",
  p: "var(--decor-book-p)",
};

export function OfficeWindow({ className }: { className?: string }) {
  return gridSvg({
    rows: WINDOW,
    colors: WINDOW_COLORS,
    scale: 3,
    className: cn("decor-window", className),
  });
}

export function OfficeCoffee({ className }: { className?: string }) {
  return gridSvg({
    rows: COFFEE,
    colors: COFFEE_COLORS,
    scale: 3,
    className,
  });
}

export function OfficePlant({ className }: { className?: string }) {
  return gridSvg({
    rows: PLANT,
    colors: PLANT_COLORS,
    scale: 3,
    className: cn("decor-plant", className),
  });
}

export function OfficeBookshelf({ className }: { className?: string }) {
  return gridSvg({
    rows: BOOKSHELF,
    colors: BOOKSHELF_COLORS,
    scale: 3,
    className,
  });
}
