import { useEffect, useMemo, useRef } from "react";
import type { Agent } from "@loom/core";

/**
 * Pixel office.
 *
 * Agents are grouped into "departments" by adapter kind. Each agent has a
 * fixed desk; they sit at it most of the time and occasionally take a short
 * walk around the office. Active runs glow at the agent's monitor.
 *
 * Office furniture (whiteboard, plants, water cooler) gives the scene weight
 * so it reads as a workplace, not a sandbox.
 *
 * Delegation arrows: when one agent's run is the parent of another's, an
 * animated dashed arrow connects their desks. Lights up automatically as the
 * harness wires up multi-agent flows.
 */

interface DeskAgent {
  agentId: string;
  name: string;
  adapterKind: string;
  bodyColor: string;
  headColor: string;
  homeX: number;
  homeY: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  state: "seated" | "walking" | "returning";
  facing: "left" | "right" | "down" | "up";
  timer: number;
  phase: number;
}

// Layout constants — bumped 1.3-1.5× from the previous pass.
const ROOM_W = 800;
const MIN_ROOM_H = 640;
const SPRITE_W = 32;
const SPRITE_H = 56;
const DESK_W = 96;
const DESK_H = 32;
const MONITOR_W = 36;
const MONITOR_H = 24;
const CELL_W = 130;
const CELL_H = 180;
const DEPT_HEADER = 36;
const ROOM_PAD_X = 48;
const ROOM_PAD_Y = 96; // leaves room for the whiteboard/coffee at the top
const FOOTER_PAD = 48; // bottom plant clearance

const SPEED = 0.7;

const ADAPTER_PALETTE: Record<
  string,
  { body: string; deptName: string; trim: string }
> = {
  "claude-code": { body: "#cc785c", deptName: "Claude", trim: "#a85f43" },
  gemini: { body: "#4285f4", deptName: "Gemini", trim: "#1a5fce" },
  codex: { body: "#10a37f", deptName: "Codex", trim: "#0a7a5e" },
  opencode: { body: "#fb923c", deptName: "OpenCode", trim: "#c96a1f" },
};
const FALLBACK = { body: "#71717a", deptName: "Other", trim: "#52525b" };

const SKIN_TONES = ["#f4d4ae", "#e0a878", "#c4845a", "#8a5a3c", "#d8b89a"];

export interface Delegation {
  fromAgentId: string;
  toAgentId: string;
}

interface PixelRoomProps {
  agents: Agent[];
  activeAgentIds: Set<string>;
  /** Parent → child agent links, drawn as animated dashed arrows. */
  delegations?: Delegation[];
  onAgentClick?: (agentId: string) => void;
  isDark?: boolean;
  /** Highlights the selected agent with a yellow halo. */
  selectedAgentId?: string | null;
}

export function PixelRoom({
  agents,
  activeAgentIds,
  delegations = [],
  onAgentClick,
  isDark = false,
  selectedAgentId = null,
}: PixelRoomProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const deskAgentsRef = useRef<DeskAgent[]>([]);
  const activeRef = useRef<Set<string>>(activeAgentIds);
  const delegationsRef = useRef<Delegation[]>(delegations);
  const darkRef = useRef<boolean>(isDark);
  const selectedRef = useRef<string | null>(selectedAgentId);

  activeRef.current = activeAgentIds;
  delegationsRef.current = delegations;
  darkRef.current = isDark;
  selectedRef.current = selectedAgentId;

  const layout = useMemo(() => layoutOffice(agents), [agents]);

  useEffect(() => {
    const existing = new Map(deskAgentsRef.current.map((d) => [d.agentId, d]));
    deskAgentsRef.current = layout.desks.map((d, i) => {
      const palette = ADAPTER_PALETTE[d.adapterKind] ?? FALLBACK;
      const headColor = SKIN_TONES[i % SKIN_TONES.length]!;
      const prior = existing.get(d.agentId);
      if (prior) {
        prior.name = d.name;
        prior.adapterKind = d.adapterKind;
        prior.bodyColor = palette.body;
        prior.homeX = d.homeX;
        prior.homeY = d.homeY;
        return prior;
      }
      return {
        agentId: d.agentId,
        name: d.name,
        adapterKind: d.adapterKind,
        bodyColor: palette.body,
        headColor,
        homeX: d.homeX,
        homeY: d.homeY,
        x: d.homeX,
        y: d.homeY,
        tx: d.homeX,
        ty: d.homeY,
        state: "seated",
        facing: "down",
        timer: 60 + Math.floor(Math.random() * 240),
        phase: Math.random() * Math.PI * 2,
      };
    });
  }, [layout]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    let raf = 0;
    const tick = () => {
      step(deskAgentsRef.current, activeRef.current);
      draw(
        ctx,
        deskAgentsRef.current,
        layout,
        activeRef.current,
        delegationsRef.current,
        darkRef.current,
        selectedRef.current,
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [layout]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onAgentClick) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    // Sprite positions are stored in CSS-pixel space (0..ROOM_W); the canvas
    // backing store is 2× for crispness, so we compare against rect (CSS) here.
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // Generous hit area: include the desk row beneath the sprite so wandering
    // agents are still easy to grab.
    const PAD = 8;
    const sorted = [...deskAgentsRef.current].sort((a, b) => b.y - a.y);
    for (const s of sorted) {
      if (
        x >= s.x - PAD &&
        x <= s.x + SPRITE_W + PAD &&
        y >= s.y - PAD &&
        y <= s.y + SPRITE_H + PAD
      ) {
        onAgentClick(s.agentId);
        return;
      }
    }
    // Also let users click an empty desk to pick that agent.
    for (const s of deskAgentsRef.current) {
      const dx = s.homeX;
      const dy = s.homeY + SPRITE_H - 16;
      if (x >= dx - 4 && x <= dx + SPRITE_W + 4 && y >= dy && y <= dy + 32) {
        onAgentClick(s.agentId);
        return;
      }
    }
  };

  return (
    <canvas
      ref={canvasRef}
      width={ROOM_W * 2}
      height={layout.totalH * 2}
      onClick={handleClick}
      style={{
        width: `${ROOM_W}px`,
        height: `${layout.totalH}px`,
        imageRendering: "pixelated",
        cursor: onAgentClick ? "pointer" : "default",
        display: "block",
      }}
      className="rounded-lg border border-zinc-300 dark:border-zinc-700"
    />
  );
}

interface DeskLayout {
  agentId: string;
  name: string;
  adapterKind: string;
  homeX: number;
  homeY: number;
}
interface DepartmentLayout {
  kind: string;
  deptName: string;
  trim: string;
  labelY: number;
  endY: number;
}
interface OfficeLayout {
  desks: DeskLayout[];
  departments: DepartmentLayout[];
  totalH: number;
}

function layoutOffice(agents: Agent[]): OfficeLayout {
  const groups = new Map<string, Agent[]>();
  for (const a of agents) {
    const arr = groups.get(a.adapterKind) ?? [];
    arr.push(a);
    groups.set(a.adapterKind, arr);
  }

  const desks: DeskLayout[] = [];
  const departments: DepartmentLayout[] = [];
  const colsPerRow = Math.max(
    1,
    Math.floor((ROOM_W - ROOM_PAD_X * 2) / CELL_W),
  );

  let y = ROOM_PAD_Y;
  for (const [kind, members] of groups) {
    const palette = ADAPTER_PALETTE[kind] ?? FALLBACK;
    const labelY = y;
    const rowsCount = Math.ceil(members.length / colsPerRow);
    const deptStartY = labelY + DEPT_HEADER;

    members.forEach((a, idx) => {
      const col = idx % colsPerRow;
      const row = Math.floor(idx / colsPerRow);
      const x = ROOM_PAD_X + col * CELL_W + (CELL_W - SPRITE_W) / 2;
      const homeY = deptStartY + row * CELL_H + 36;
      desks.push({
        agentId: a.id,
        name: a.name,
        adapterKind: kind,
        homeX: x,
        homeY,
      });
    });

    const endY = deptStartY + rowsCount * CELL_H;
    departments.push({
      kind,
      deptName: palette.deptName,
      trim: palette.trim,
      labelY,
      endY,
    });
    y = endY + 16;
  }

  const totalH = Math.max(MIN_ROOM_H, y + FOOTER_PAD);
  return { desks, departments, totalH };
}

function step(desks: DeskAgent[], active: Set<string>): void {
  for (const s of desks) {
    if (s.state === "seated") {
      s.timer -= 1;
      s.phase += 0.05;
      if (active.has(s.agentId)) {
        s.timer = Math.max(s.timer, 30);
        continue;
      }
      if (s.timer <= 0 && Math.random() < 0.15) {
        s.tx = clamp(
          s.homeX + (Math.random() - 0.5) * 260,
          ROOM_PAD_X,
          ROOM_W - ROOM_PAD_X - SPRITE_W,
        );
        s.ty = clamp(
          s.homeY + (Math.random() - 0.5) * 160,
          ROOM_PAD_Y + DEPT_HEADER,
          MIN_ROOM_H - SPRITE_H - 16,
        );
        s.state = "walking";
        s.timer = 0;
      } else if (s.timer <= 0) {
        s.timer = 60 + Math.floor(Math.random() * 240);
      }
      continue;
    }

    const tx = s.state === "returning" ? s.homeX : s.tx;
    const ty = s.state === "returning" ? s.homeY : s.ty;
    const dx = tx - s.x;
    const dy = ty - s.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) {
      if (s.state === "walking") {
        s.state = "returning";
        s.timer = 30 + Math.floor(Math.random() * 60);
      } else {
        s.state = "seated";
        s.facing = "down";
        s.timer = 120 + Math.floor(Math.random() * 360);
      }
      continue;
    }
    s.x += (dx / dist) * SPEED;
    s.y += (dy / dist) * SPEED;
    s.facing =
      Math.abs(dx) > Math.abs(dy)
        ? dx > 0
          ? "right"
          : "left"
        : dy > 0
          ? "down"
          : "up";
    s.phase += 0.16;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function draw(
  ctx: CanvasRenderingContext2D,
  desks: DeskAgent[],
  layout: OfficeLayout,
  activeIds: Set<string>,
  delegations: Delegation[],
  isDark: boolean,
  selectedAgentId: string | null,
): void {
  const scale = 2;
  const W = ROOM_W * scale;
  const H = layout.totalH * scale;

  // Floor.
  ctx.fillStyle = isDark ? "#1f1f23" : "#e9e2d4";
  ctx.fillRect(0, 0, W, H);

  // Tile pattern (32×32).
  ctx.fillStyle = isDark ? "#262629" : "#dfd6c2";
  const tile = 32;
  for (let row = 0; row * tile < layout.totalH; row++) {
    for (let col = 0; col * tile < ROOM_W; col++) {
      if ((row + col) % 2 === 0) {
        ctx.fillRect(
          col * tile * scale,
          row * tile * scale,
          tile * scale,
          tile * scale,
        );
      }
    }
  }

  // Walls.
  const wallColor = isDark ? "#3a3a40" : "#c8b894";
  ctx.fillStyle = wallColor;
  ctx.fillRect(0, 0, W, 8 * scale);
  ctx.fillRect(0, 0, 8 * scale, H);
  ctx.fillRect(W - 8 * scale, 0, 8 * scale, H);
  ctx.fillRect(0, H - 8 * scale, W, 8 * scale);

  // Wall furniture (drawn before department labels so labels overlay subtly).
  drawWhiteboard(ctx, isDark);
  drawCoffeeMachine(ctx, isDark);
  drawFilingCabinet(ctx, isDark);

  // Department label bands.
  for (const dept of layout.departments) {
    drawDepartmentBand(ctx, dept, isDark);
  }

  // Free-standing furniture.
  drawPlant(ctx, 16, layout.totalH - 72, isDark);
  drawPlant(ctx, ROOM_W - 48, layout.totalH - 72, isDark);
  drawWaterCooler(ctx, ROOM_W - 80, Math.floor(layout.totalH / 2) - 28, isDark);

  // Delegation arrows (under sprites so they don't obscure faces).
  drawDelegationArrows(ctx, desks, delegations);

  // Desks for seated agents (drawn before sprites for correct layering).
  for (const s of desks) {
    if (s.state === "seated" && Math.abs(s.x - s.homeX) < 1) {
      drawDesk(ctx, s, activeIds.has(s.agentId), isDark);
    }
  }

  // Sprites (back-to-front).
  const sorted = [...desks].sort((a, b) => a.y - b.y);
  for (const s of sorted) {
    if (selectedAgentId && s.agentId === selectedAgentId) {
      drawSelectionHalo(ctx, s);
    }
    drawSprite(ctx, s, activeIds.has(s.agentId), isDark);
  }

  // Empty desks for agents who wandered off.
  for (const s of desks) {
    if (s.state !== "seated" || Math.abs(s.x - s.homeX) >= 1) {
      drawDesk(ctx, s, false, isDark);
    }
  }
}

function drawDepartmentBand(
  ctx: CanvasRenderingContext2D,
  dept: DepartmentLayout,
  isDark: boolean,
): void {
  const scale = 2;
  const labelY = dept.labelY * scale;
  const bandH = DEPT_HEADER * scale;

  ctx.fillStyle = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)";
  ctx.fillRect(
    (ROOM_PAD_X - 4) * scale,
    labelY,
    (ROOM_W - ROOM_PAD_X * 2 + 8) * scale,
    bandH,
  );

  ctx.fillStyle = dept.trim;
  ctx.fillRect(
    (ROOM_PAD_X - 4) * scale,
    labelY,
    4 * scale,
    (dept.endY - dept.labelY) * scale,
  );

  ctx.fillStyle = isDark ? "#e4e4e7" : "#27272a";
  ctx.font = "bold 16px ui-sans-serif, system-ui";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(
    `${dept.deptName.toUpperCase()} DEPT.`,
    (ROOM_PAD_X + 8) * scale,
    labelY + bandH / 2,
  );
}

function drawDesk(
  ctx: CanvasRenderingContext2D,
  s: DeskAgent,
  active: boolean,
  isDark: boolean,
): void {
  const scale = 2;
  const dx = Math.floor(s.homeX - (DESK_W - SPRITE_W) / 2) * scale;
  const dy = Math.floor(s.homeY + 32) * scale;

  // Desk body.
  ctx.fillStyle = isDark ? "#5b4128" : "#a07449";
  ctx.fillRect(dx, dy, DESK_W * scale, DESK_H * scale);
  // Top highlight.
  ctx.fillStyle = isDark ? "#6e4f30" : "#b88a5a";
  ctx.fillRect(dx, dy, DESK_W * scale, 3 * scale);
  // Front shadow.
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(dx, dy + (DESK_H - 3) * scale, DESK_W * scale, 3 * scale);
  // Drawer pulls.
  ctx.fillStyle = isDark ? "#3f2c1c" : "#774f2f";
  ctx.fillRect(dx + 12 * scale, dy + 16 * scale, 8 * scale, 2 * scale);
  ctx.fillRect(dx + 76 * scale, dy + 16 * scale, 8 * scale, 2 * scale);

  // Monitor (centered on desk).
  const mx = dx + Math.floor((DESK_W - MONITOR_W) / 2) * scale;
  const my = dy - (MONITOR_H + 4) * scale;

  // Stand.
  ctx.fillStyle = isDark ? "#26262b" : "#3f3f46";
  ctx.fillRect(
    mx + (MONITOR_W / 2 - 2) * scale,
    my + MONITOR_H * scale,
    4 * scale,
    4 * scale,
  );
  ctx.fillRect(mx + (MONITOR_W / 2 - 8) * scale, my + (MONITOR_H + 3) * scale, 16 * scale, 1 * scale);

  // Bezel.
  ctx.fillStyle = isDark ? "#1c1c20" : "#27272a";
  ctx.fillRect(mx, my, MONITOR_W * scale, MONITOR_H * scale);

  // Screen.
  if (active) {
    const glow = ctx.createRadialGradient(
      mx + (MONITOR_W / 2) * scale,
      my + (MONITOR_H / 2) * scale,
      0,
      mx + (MONITOR_W / 2) * scale,
      my + (MONITOR_H / 2) * scale,
      40 * scale,
    );
    glow.addColorStop(0, "rgba(250, 204, 21, 0.45)");
    glow.addColorStop(1, "rgba(250, 204, 21, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(mx - 24 * scale, my - 24 * scale, 80 * scale, 60 * scale);
    ctx.fillStyle = "#fde68a";
  } else {
    ctx.fillStyle = isDark ? "#3b82f6" : "#7dd3fc";
  }
  ctx.fillRect(
    mx + 2 * scale,
    my + 2 * scale,
    (MONITOR_W - 4) * scale,
    (MONITOR_H - 4) * scale,
  );

  // Code-line decoration.
  ctx.fillStyle = active ? "#a16207" : isDark ? "#1e3a8a" : "#0369a1";
  for (let i = 0; i < 4; i++) {
    const w = 6 + Math.floor(Math.random() * 18); // deterministic-ish
    ctx.fillRect(mx + 4 * scale, my + (4 + i * 4) * scale, w * scale, 1 * scale);
  }

  // Active "thinking" dots above monitor.
  if (active) {
    const t = (Date.now() / 220) % 3;
    ctx.fillStyle = "#facc15";
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = i === Math.floor(t) ? 1 : 0.35;
      ctx.fillRect(
        mx + (8 + i * 6) * scale,
        my - 8 * scale,
        3 * scale,
        3 * scale,
      );
    }
    ctx.globalAlpha = 1;
  }
}

function drawSprite(
  ctx: CanvasRenderingContext2D,
  s: DeskAgent,
  active: boolean,
  isDark: boolean,
): void {
  const scale = 2;
  const x = Math.floor(s.x) * scale;
  const y = Math.floor(s.y) * scale;
  const isMoving = s.state !== "seated";
  const bob = Math.floor(Math.sin(s.phase) * (isMoving ? 1 : 0.5)) * scale;

  // Active aura.
  if (active) {
    const aura = ctx.createRadialGradient(
      x + 16 * scale,
      y + 28 * scale + bob,
      6 * scale,
      x + 16 * scale,
      y + 28 * scale + bob,
      36 * scale,
    );
    aura.addColorStop(0, "rgba(250, 204, 21, 0.45)");
    aura.addColorStop(1, "rgba(250, 204, 21, 0)");
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(x + 16 * scale, y + 28 * scale + bob, 36 * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  // Floor shadow.
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fillRect(x + 6 * scale, y + 54 * scale, 20 * scale, 2 * scale);

  // Pants (lower body).
  ctx.fillStyle = "#2c3e50";
  ctx.fillRect(x + 8 * scale, y + 36 * scale, 16 * scale, 16 * scale + bob);
  // Belt.
  ctx.fillStyle = "#1a242f";
  ctx.fillRect(x + 8 * scale, y + 36 * scale + bob, 16 * scale, 2 * scale);

  // Shirt / torso.
  ctx.fillStyle = s.bodyColor;
  ctx.fillRect(x + 6 * scale, y + 22 * scale + bob, 20 * scale, 15 * scale);
  // Collar / lapel.
  ctx.fillStyle = darken(s.bodyColor, -0.18);
  ctx.fillRect(x + 13 * scale, y + 22 * scale + bob, 6 * scale, 3 * scale);

  // Arms.
  const armSwing = isMoving ? Math.sin(s.phase) * scale : 0;
  ctx.fillStyle = darken(s.bodyColor, 0.15);
  ctx.fillRect(
    x + 4 * scale,
    y + 24 * scale + bob - armSwing,
    2 * scale,
    12 * scale,
  );
  ctx.fillRect(
    x + 26 * scale,
    y + 24 * scale + bob + armSwing,
    2 * scale,
    12 * scale,
  );
  // Hands.
  ctx.fillStyle = s.headColor;
  ctx.fillRect(
    x + 4 * scale,
    y + 36 * scale + bob - armSwing,
    2 * scale,
    3 * scale,
  );
  ctx.fillRect(
    x + 26 * scale,
    y + 36 * scale + bob + armSwing,
    2 * scale,
    3 * scale,
  );

  // Shoes.
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(x + 8 * scale, y + 54 * scale, 6 * scale, 2 * scale);
  ctx.fillRect(x + 18 * scale, y + 54 * scale, 6 * scale, 2 * scale);

  // Head.
  ctx.fillStyle = s.headColor;
  ctx.fillRect(x + 8 * scale, y + 6 * scale + bob, 16 * scale, 16 * scale);
  // Hair.
  ctx.fillStyle = "#2a1f15";
  ctx.fillRect(x + 8 * scale, y + 6 * scale + bob, 16 * scale, 4 * scale);
  ctx.fillRect(x + 8 * scale, y + 10 * scale + bob, 2 * scale, 3 * scale);
  ctx.fillRect(x + 22 * scale, y + 10 * scale + bob, 2 * scale, 3 * scale);

  // Eyes (direction-aware).
  ctx.fillStyle = "#1a1a1a";
  switch (s.facing) {
    case "down":
      ctx.fillRect(x + 12 * scale, y + 14 * scale + bob, 2 * scale, 2 * scale);
      ctx.fillRect(x + 18 * scale, y + 14 * scale + bob, 2 * scale, 2 * scale);
      break;
    case "up":
      break;
    case "left":
      ctx.fillRect(x + 10 * scale, y + 14 * scale + bob, 2 * scale, 2 * scale);
      break;
    case "right":
      ctx.fillRect(x + 20 * scale, y + 14 * scale + bob, 2 * scale, 2 * scale);
      break;
  }

  if (s.facing === "down") {
    ctx.fillStyle = "#5a3a26";
    ctx.fillRect(x + 14 * scale, y + 18 * scale + bob, 4 * scale, 1 * scale);
  }

  // Name label.
  ctx.fillStyle = isDark ? "rgba(244,244,245,0.92)" : "rgba(24,24,27,0.9)";
  ctx.font = "bold 12px ui-monospace, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(s.name, x + 16 * scale, y + 2 * scale);
  if (active) {
    ctx.fillStyle = "#facc15";
    ctx.font = "bold 10px ui-monospace, Menlo, monospace";
    ctx.fillText("● working", x + 16 * scale, y - 12 * scale);
  }
}

/**
 * Soft yellow ring under the selected sprite. Draws *before* the sprite so
 * the character stays crisp on top of the halo.
 */
function drawSelectionHalo(
  ctx: CanvasRenderingContext2D,
  s: DeskAgent,
): void {
  const scale = 2;
  const cx = (s.x + SPRITE_W / 2) * scale;
  const cy = (s.y + SPRITE_H - 6) * scale;
  const rx = (SPRITE_W / 2 + 8) * scale;
  const ry = 10 * scale;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(250, 204, 21, 0.35)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(250, 204, 21, 0.85)";
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Furniture
// ---------------------------------------------------------------------------

function drawWhiteboard(ctx: CanvasRenderingContext2D, isDark: boolean): void {
  const scale = 2;
  const x = 280 * scale;
  const y = 24 * scale;
  const w = 240 * scale;
  const h = 56 * scale;

  // Frame.
  ctx.fillStyle = isDark ? "#52525b" : "#3f3f46";
  ctx.fillRect(x, y, w, h);
  // Surface.
  ctx.fillStyle = isDark ? "#e7e5e4" : "#fafaf9";
  ctx.fillRect(x + 3 * scale, y + 3 * scale, w - 6 * scale, h - 6 * scale);
  // Marks (a roadmap-ish doodle).
  ctx.fillStyle = "#dc2626";
  ctx.fillRect(x + 12 * scale, y + 12 * scale, 60 * scale, 2 * scale);
  ctx.fillStyle = "#0284c7";
  ctx.fillRect(x + 12 * scale, y + 22 * scale, 90 * scale, 2 * scale);
  ctx.fillRect(x + 12 * scale, y + 30 * scale, 70 * scale, 2 * scale);
  ctx.fillStyle = "#16a34a";
  ctx.fillRect(x + 120 * scale, y + 14 * scale, 40 * scale, 2 * scale);
  ctx.fillRect(x + 120 * scale, y + 22 * scale, 50 * scale, 2 * scale);
  // Arrow.
  ctx.fillStyle = "#525252";
  ctx.fillRect(x + 180 * scale, y + 28 * scale, 30 * scale, 2 * scale);
  ctx.fillRect(x + 206 * scale, y + 26 * scale, 2 * scale, 2 * scale);
  ctx.fillRect(x + 206 * scale, y + 30 * scale, 2 * scale, 2 * scale);
  // Tray under whiteboard.
  ctx.fillStyle = isDark ? "#3f3f46" : "#27272a";
  ctx.fillRect(x, y + h, w, 3 * scale);
  // Markers.
  ctx.fillStyle = "#dc2626";
  ctx.fillRect(x + 20 * scale, y + h - 1 * scale, 8 * scale, 2 * scale);
  ctx.fillStyle = "#0284c7";
  ctx.fillRect(x + 36 * scale, y + h - 1 * scale, 8 * scale, 2 * scale);
}

function drawCoffeeMachine(
  ctx: CanvasRenderingContext2D,
  isDark: boolean,
): void {
  const scale = 2;
  const x = 560 * scale;
  const y = 24 * scale;
  // Body.
  ctx.fillStyle = isDark ? "#27272a" : "#171717";
  ctx.fillRect(x, y, 36 * scale, 56 * scale);
  // Top.
  ctx.fillStyle = isDark ? "#3f3f46" : "#262626";
  ctx.fillRect(x, y, 36 * scale, 8 * scale);
  // Display.
  ctx.fillStyle = "#10b981";
  ctx.fillRect(x + 6 * scale, y + 12 * scale, 24 * scale, 8 * scale);
  ctx.fillStyle = "#064e3b";
  ctx.fillRect(x + 8 * scale, y + 14 * scale, 14 * scale, 2 * scale);
  ctx.fillRect(x + 8 * scale, y + 17 * scale, 8 * scale, 1 * scale);
  // Spout.
  ctx.fillStyle = isDark ? "#52525b" : "#3f3f46";
  ctx.fillRect(x + 14 * scale, y + 28 * scale, 8 * scale, 4 * scale);
  // Cup pad.
  ctx.fillStyle = isDark ? "#1c1917" : "#0a0a0a";
  ctx.fillRect(x + 4 * scale, y + 48 * scale, 28 * scale, 2 * scale);
  // Mug.
  ctx.fillStyle = "#fafafa";
  ctx.fillRect(x + 12 * scale, y + 36 * scale, 12 * scale, 12 * scale);
  ctx.fillStyle = "#7c2d12";
  ctx.fillRect(x + 14 * scale, y + 38 * scale, 8 * scale, 4 * scale);
  // Steam.
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  const steamPhase = (Date.now() / 500) % (Math.PI * 2);
  ctx.fillRect(
    x + (15 + Math.sin(steamPhase) * 1.5) * scale,
    y + 32 * scale,
    1 * scale,
    3 * scale,
  );
  ctx.fillRect(
    x + (19 + Math.sin(steamPhase + 1) * 1.5) * scale,
    y + 30 * scale,
    1 * scale,
    3 * scale,
  );
}

function drawFilingCabinet(
  ctx: CanvasRenderingContext2D,
  isDark: boolean,
): void {
  const scale = 2;
  const x = 200 * scale;
  const y = 24 * scale;
  const w = 40;
  const h = 56;

  ctx.fillStyle = isDark ? "#3f3f46" : "#71717a";
  ctx.fillRect(x, y, w * scale, h * scale);
  ctx.fillStyle = isDark ? "#52525b" : "#52525b";
  ctx.fillRect(x, y, w * scale, 2 * scale);

  // Three drawers.
  for (let i = 0; i < 3; i++) {
    const dy = y + (4 + i * 18) * scale;
    ctx.fillStyle = isDark ? "#27272a" : "#3f3f46";
    ctx.fillRect(x + 2 * scale, dy, (w - 4) * scale, 1 * scale);
    // Drawer pull.
    ctx.fillStyle = isDark ? "#71717a" : "#27272a";
    ctx.fillRect(
      x + (w / 2 - 4) * scale,
      dy + 8 * scale,
      8 * scale,
      2 * scale,
    );
  }

  // Plant on top.
  ctx.fillStyle = "#2d6a4f";
  ctx.fillRect(x + 8 * scale, y - 8 * scale, 24 * scale, 8 * scale);
  ctx.fillStyle = "#52b788";
  ctx.fillRect(x + 12 * scale, y - 12 * scale, 4 * scale, 4 * scale);
  ctx.fillRect(x + 18 * scale, y - 14 * scale, 4 * scale, 6 * scale);
  ctx.fillRect(x + 24 * scale, y - 10 * scale, 4 * scale, 4 * scale);
  // Pot.
  ctx.fillStyle = "#9c4a1f";
  ctx.fillRect(x + 14 * scale, y - 4 * scale, 12 * scale, 4 * scale);
}

function drawPlant(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  isDark: boolean,
): void {
  const scale = 2;
  const x = px * scale;
  const y = py * scale;

  // Pot.
  const potColor = isDark ? "#7c2d12" : "#9c4a1f";
  ctx.fillStyle = potColor;
  ctx.fillRect(x + 4 * scale, y + 40 * scale, 24 * scale, 16 * scale);
  ctx.fillStyle = darken(potColor, 0.2);
  ctx.fillRect(x + 4 * scale, y + 40 * scale, 24 * scale, 2 * scale);

  // Leaves (overlapping clusters).
  const leaf1 = "#2d6a4f";
  const leaf2 = "#52b788";
  ctx.fillStyle = leaf1;
  ctx.fillRect(x + 4 * scale, y + 24 * scale, 24 * scale, 18 * scale);
  ctx.fillRect(x + 0 * scale, y + 28 * scale, 8 * scale, 12 * scale);
  ctx.fillRect(x + 24 * scale, y + 28 * scale, 8 * scale, 12 * scale);
  ctx.fillStyle = leaf2;
  ctx.fillRect(x + 8 * scale, y + 16 * scale, 16 * scale, 14 * scale);
  ctx.fillRect(x + 6 * scale, y + 22 * scale, 4 * scale, 4 * scale);
  ctx.fillRect(x + 22 * scale, y + 22 * scale, 4 * scale, 4 * scale);
  ctx.fillRect(x + 12 * scale, y + 10 * scale, 8 * scale, 8 * scale);
  // Highlights.
  ctx.fillStyle = "#74c69d";
  ctx.fillRect(x + 10 * scale, y + 18 * scale, 2 * scale, 2 * scale);
  ctx.fillRect(x + 18 * scale, y + 14 * scale, 2 * scale, 2 * scale);
}

function drawWaterCooler(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  isDark: boolean,
): void {
  const scale = 2;
  const x = px * scale;
  const y = py * scale;

  // Jug (light blue tinted, with water level).
  ctx.fillStyle = "#bae6fd";
  ctx.fillRect(x + 4 * scale, y, 24 * scale, 28 * scale);
  ctx.fillStyle = "#0ea5e9";
  ctx.fillRect(x + 6 * scale, y + 6 * scale, 20 * scale, 18 * scale);
  // Jug cap.
  ctx.fillStyle = "#075985";
  ctx.fillRect(x + 8 * scale, y - 2 * scale, 16 * scale, 4 * scale);

  // Bubble animation.
  const bubblePhase = (Date.now() / 600) % 1;
  ctx.fillStyle = "#bae6fd";
  ctx.fillRect(
    x + 12 * scale,
    y + (20 - bubblePhase * 12) * scale,
    2 * scale,
    2 * scale,
  );
  ctx.fillRect(
    x + 18 * scale,
    y + (24 - bubblePhase * 16) * scale,
    2 * scale,
    2 * scale,
  );

  // Body.
  ctx.fillStyle = isDark ? "#3f3f46" : "#fafaf9";
  ctx.fillRect(x, y + 28 * scale, 32 * scale, 36 * scale);
  ctx.fillStyle = isDark ? "#52525b" : "#e4e4e7";
  ctx.fillRect(x, y + 28 * scale, 32 * scale, 2 * scale);

  // Tap.
  ctx.fillStyle = "#dc2626";
  ctx.fillRect(x + 6 * scale, y + 38 * scale, 6 * scale, 4 * scale);
  ctx.fillStyle = "#1d4ed8";
  ctx.fillRect(x + 20 * scale, y + 38 * scale, 6 * scale, 4 * scale);
  ctx.fillStyle = isDark ? "#71717a" : "#a8a29e";
  ctx.fillRect(x + 6 * scale, y + 44 * scale, 20 * scale, 2 * scale);
}

// ---------------------------------------------------------------------------
// Delegation arrows
// ---------------------------------------------------------------------------

function drawDelegationArrows(
  ctx: CanvasRenderingContext2D,
  desks: DeskAgent[],
  delegations: Delegation[],
): void {
  if (delegations.length === 0) return;
  const scale = 2;
  const byId = new Map(desks.map((d) => [d.agentId, d]));
  const dashOffset = (Date.now() / 60) % 16;

  for (const link of delegations) {
    const from = byId.get(link.fromAgentId);
    const to = byId.get(link.toAgentId);
    if (!from || !to) continue;

    // Anchor at the agent's monitor (top of desk).
    const fx = (from.homeX + SPRITE_W / 2) * scale;
    const fy = (from.homeY + 28) * scale;
    const tx = (to.homeX + SPRITE_W / 2) * scale;
    const ty = (to.homeY + 28) * scale;

    ctx.save();
    ctx.strokeStyle = "rgba(250, 204, 21, 0.85)";
    ctx.lineWidth = 2 * scale;
    ctx.setLineDash([8 * scale, 4 * scale]);
    ctx.lineDashOffset = -dashOffset * scale;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.restore();

    // Arrowhead at child end.
    const angle = Math.atan2(ty - fy, tx - fx);
    const ah = 8 * scale;
    ctx.fillStyle = "#facc15";
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(
      tx - Math.cos(angle - 0.4) * ah,
      ty - Math.sin(angle - 0.4) * ah,
    );
    ctx.lineTo(
      tx - Math.cos(angle + 0.4) * ah,
      ty - Math.sin(angle + 0.4) * ah,
    );
    ctx.closePath();
    ctx.fill();
  }
}

/** Lighten (negative `amount`) or darken an RGB hex color. */
function darken(hex: string, amount: number): string {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const adjust = (v: number) =>
    Math.max(0, Math.min(255, Math.floor(v * (1 - amount))));
  const r = adjust(parseInt(m[1]!, 16));
  const g = adjust(parseInt(m[2]!, 16));
  const b = adjust(parseInt(m[3]!, 16));
  return `rgb(${r},${g},${b})`;
}
