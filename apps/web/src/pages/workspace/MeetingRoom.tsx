// MeetingRoom — 모던 회의실. 픽셀 X, 정보 ●.
//
// 각 에이전트는 자기 좌석에 고정. 그 주변에 풍부한 라이브 정보:
//   - 모니터 카드 = 현재 만지는 파일 / 도구. 클릭 → 에디터로
//   - 호버 시 확장 — 최근 도구 5개, 진행 중 run id, "Talk to →"
//   - tool 사용 시 작은 버스트 애니메이션이 위로 떠오름
//   - 같은 thread 의 두 명은 점선으로 *연결*. 활성 thread 면 흐름 애니메이션
//   - 게시판은 위쪽에 모던 패널 — thread 목록, 작업 중 dot, 클릭 활성화
//
// 캐릭터의 *위치 이동* 은 없음 (이전 시도가 fake 였음). 정보의 *흐름* 으로
// 협업감을 표현 — tether 라인, tool burst, 모니터 변경.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CornerDownRight,
  ExternalLink,
  MessageSquare,
  Pen,
  RefreshCw,
  Wrench,
} from "lucide-react";
import type {
  ActiveToolsForAgent,
  ActiveTouch,
  Agent,
  Thread,
} from "@loom/core";
import { agentColorOf, classesFor } from "../../components/agentColor.js";
import { AgentInitialBadge } from "../../components/AgentInitialBadge.js";
import { useI18n } from "../../context/I18nContext.js";
import { basename } from "../../lib/path.js";
import { cn } from "../../lib/utils.js";

// ──────────────────────────────────────────────────────────────────────────
// 좌석 배치 — 인원에 따라 한 줄 / 두 줄.
// ──────────────────────────────────────────────────────────────────────────

const ROOM_PAD_X = 10;
const SEAT_ROW_SINGLE_Y = 60;
const SEAT_ROW_BACK_Y = 45;
const SEAT_ROW_FRONT_Y = 75;

function seatPos(index: number, total: number): { x: number; y: number } {
  const cols = total <= 4 ? Math.max(total, 1) : Math.ceil(total / 2);
  const row = total <= 4 ? 0 : Math.floor(index / cols);
  const col = index % cols;
  const span = 100 - ROOM_PAD_X * 2;
  const x = ROOM_PAD_X + ((col + 0.5) / cols) * span;
  const y =
    total <= 4
      ? SEAT_ROW_SINGLE_Y
      : row === 0
        ? SEAT_ROW_BACK_Y
        : SEAT_ROW_FRONT_Y;
  return { x, y };
}

// ──────────────────────────────────────────────────────────────────────────
// Tool 이름 → 아이콘 (간단 매핑)
// ──────────────────────────────────────────────────────────────────────────

function toolIcon(name: string): string {
  if (name.startsWith("mcp__")) return "🔌";
  const n = name.toLowerCase();
  if (n.includes("read")) return "📖";
  if (n.includes("write") || n.includes("create")) return "✍️";
  if (n.includes("edit") || n.includes("update")) return "✎";
  if (n.includes("bash") || n.includes("exec")) return "⚡";
  if (n.includes("search") || n.includes("grep") || n.includes("find")) return "🔍";
  if (n.includes("web") || n.includes("fetch") || n.includes("curl")) return "🌐";
  if (n.includes("test")) return "🧪";
  return "🔧";
}

// ──────────────────────────────────────────────────────────────────────────
// 메인
// ──────────────────────────────────────────────────────────────────────────

interface Props {
  projectName: string;
  agents: Agent[];
  workingIds: Set<string>;
  touchingIds: Set<string>;
  activeTouches: ActiveTouch[];
  activeTools: ActiveToolsForAgent[];
  threadList: Thread[];
  workingThreadIds: Set<string>;
  activeThreadId: string | null;
  /** 에이전트 → 현재 진행 중 run 의 thread id. tether 페어링용. */
  threadByAgent: Map<string, string>;
  onPickFile: (path: string) => void;
  onPickAgent: (id: string) => void;
  onPickThread: (id: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function MeetingRoom({
  projectName,
  agents,
  workingIds,
  touchingIds,
  activeTouches,
  activeTools,
  threadList,
  workingThreadIds,
  activeThreadId,
  threadByAgent,
  onPickFile,
  onPickAgent,
  onPickThread,
  onRefresh,
  refreshing,
}: Props) {
  const { t } = useI18n();

  // 자리: 에이전트 id → seat 좌표.
  const seatByAgent = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    agents.forEach((a, i) => m.set(a.id, seatPos(i, agents.length)));
    return m;
  }, [agents]);

  // 같은 thread 의 페어들 — tether 라인.
  const tethers = useMemo(() => {
    const byThread = new Map<string, Agent[]>();
    for (const a of agents) {
      const tid = threadByAgent.get(a.id);
      if (!tid) continue;
      if (!byThread.has(tid)) byThread.set(tid, []);
      byThread.get(tid)!.push(a);
    }
    type T = {
      key: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      colorClass: string;
      active: boolean;
    };
    const out: T[] = [];
    for (const [tid, group] of byThread) {
      if (group.length < 2) continue;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i]!;
          const b = group[j]!;
          const sa = seatByAgent.get(a.id);
          const sb = seatByAgent.get(b.id);
          if (!sa || !sb) continue;
          out.push({
            key: `${tid}-${a.id}-${b.id}`,
            x1: sa.x,
            y1: sa.y,
            x2: sb.x,
            y2: sb.y,
            colorClass: classesFor(agentColorOf(a)).text,
            active: tid === activeThreadId,
          });
        }
      }
    }
    return out;
  }, [agents, threadByAgent, seatByAgent, activeThreadId]);

  const fileByAgent = useMemo(() => {
    const m = new Map<string, string>();
    for (const tch of activeTouches) {
      const first = tch.paths[0];
      if (first && !m.has(tch.agentId)) m.set(tch.agentId, first);
    }
    return m;
  }, [activeTouches]);

  const toolByAgent = useMemo(() => {
    const m = new Map<string, ActiveToolsForAgent>();
    for (const x of activeTools) m.set(x.agentId, x);
    return m;
  }, [activeTools]);

  if (agents.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground italic">
        {t("office.empty")}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <RoomHeader
        projectName={projectName}
        onRefresh={onRefresh}
        refreshing={refreshing}
      />

      <div className="flex-1 min-h-0 flex items-center justify-center p-4 overflow-hidden">
        <div className="relative w-full h-full max-w-[1200px] max-h-[700px] aspect-[16/10] rounded-lg border border-border/60 overflow-hidden bg-gradient-to-br from-card via-card to-muted/20">
          {/* 배경 도트 그리드 — 깊이감용. */}
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none opacity-30"
            style={{
              backgroundImage:
                "radial-gradient(circle, color-mix(in oklch, var(--foreground) 8%, transparent) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          />

          <ThreadBoard
            threadList={threadList}
            workingThreadIds={workingThreadIds}
            activeThreadId={activeThreadId}
            onPickThread={onPickThread}
            agents={agents}
            threadByAgent={threadByAgent}
          />

          <TetherLines tethers={tethers} />

          {agents.map((agent) => {
            const seat = seatByAgent.get(agent.id);
            if (!seat) return null;
            return (
              <AgentSeat
                key={agent.id}
                agent={agent}
                x={seat.x}
                y={seat.y}
                working={workingIds.has(agent.id)}
                touching={touchingIds.has(agent.id)}
                file={fileByAgent.get(agent.id) ?? null}
                tool={toolByAgent.get(agent.id) ?? null}
                threadActive={
                  threadByAgent.get(agent.id) === activeThreadId &&
                  activeThreadId !== null
                }
                onPickAgent={() => onPickAgent(agent.id)}
                onPickFile={onPickFile}
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

function RoomHeader({
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
        {projectName}
        <span className="text-muted-foreground/70 font-normal ml-2">
          · {t("room.label")}
        </span>
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
// 게시판 (상단)
// ──────────────────────────────────────────────────────────────────────────

function ThreadBoard({
  threadList,
  workingThreadIds,
  activeThreadId,
  onPickThread,
  agents,
  threadByAgent,
}: {
  threadList: Thread[];
  workingThreadIds: Set<string>;
  activeThreadId: string | null;
  onPickThread: (id: string) => void;
  agents: Agent[];
  threadByAgent: Map<string, string>;
}) {
  const { t } = useI18n();

  // thread 별 참여자 (현재 running 인 에이전트)
  const participantsByThread = useMemo(() => {
    const m = new Map<string, Agent[]>();
    for (const a of agents) {
      const tid = threadByAgent.get(a.id);
      if (!tid) continue;
      if (!m.has(tid)) m.set(tid, []);
      m.get(tid)!.push(a);
    }
    return m;
  }, [agents, threadByAgent]);

  // 정렬: working 우선 → updatedAt 내림.
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
      style={{ left: "10%", top: "4%", width: "80%" }}
    >
      <div className="pointer-events-auto rounded-md border border-border bg-card/90 backdrop-blur-sm shadow-md p-2">
        <div className="flex items-center justify-between mb-1.5 px-1">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("room.board.title")}
          </span>
          <span className="text-[9px] text-muted-foreground/60">
            {threadList.length} threads
          </span>
        </div>
        {top.length === 0 ? (
          <div className="text-[10px] italic text-muted-foreground/60 px-1 py-1">
            {t("room.board.empty")}
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-1">
            {top.map((th) => {
              const working = workingThreadIds.has(th.id);
              const active = th.id === activeThreadId;
              const parts = participantsByThread.get(th.id) ?? [];
              return (
                <li key={th.id}>
                  <button
                    type="button"
                    onClick={() => onPickThread(th.id)}
                    title={th.name ?? t("thread.untitled")}
                    className={cn(
                      "w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-[11px] transition-colors text-left border",
                      active
                        ? "bg-foreground/[0.06] border-foreground/30 text-foreground font-medium"
                        : "border-transparent hover:bg-muted/60 text-foreground/80",
                    )}
                  >
                    {working ? (
                      <span
                        aria-hidden
                        className="size-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0"
                      />
                    ) : (
                      <CornerDownRight className="size-2.5 opacity-40 shrink-0" />
                    )}
                    <span className="truncate flex-1 min-w-0">
                      {th.name ?? t("thread.untitled")}
                    </span>
                    {parts.length > 0 ? (
                      <span className="flex -space-x-1 shrink-0">
                        {parts.slice(0, 3).map((a) => (
                          <AgentInitialBadge
                            key={a.id}
                            agent={a}
                            size="xs"
                            className="ring-1 ring-card"
                          />
                        ))}
                      </span>
                    ) : null}
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
// 테더 라인 — 같은 thread 두 명 연결. SVG layer.
// ──────────────────────────────────────────────────────────────────────────

function TetherLines({
  tethers,
}: {
  tethers: Array<{
    key: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    colorClass: string;
    active: boolean;
  }>;
}) {
  if (tethers.length === 0) return null;
  return (
    <>
      <style>{`
        @keyframes tether-flow {
          to { stroke-dashoffset: -16; }
        }
      `}</style>
      <svg
        className="absolute inset-0 pointer-events-none"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
      >
        {tethers.map((tt) => (
          <g key={tt.key} className={tt.colorClass}>
            <line
              x1={tt.x1}
              y1={tt.y1}
              x2={tt.x2}
              y2={tt.y2}
              stroke="currentColor"
              strokeWidth={tt.active ? 2 : 1.4}
              strokeDasharray={tt.active ? "4,3" : "2,3"}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              opacity={tt.active ? 0.75 : 0.4}
              style={
                tt.active
                  ? { animation: "tether-flow 1.5s linear infinite" }
                  : undefined
              }
            />
          </g>
        ))}
      </svg>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// AgentSeat — 한 에이전트의 모든 UI: 배지 + 모니터 + 호버 카드 + 도구 버스트.
// ──────────────────────────────────────────────────────────────────────────

interface ToolBurstItem {
  id: number;
  name: string;
}

function AgentSeat({
  agent,
  x,
  y,
  working,
  touching,
  file,
  tool,
  threadActive,
  onPickAgent,
  onPickFile,
}: {
  agent: Agent;
  x: number;
  y: number;
  working: boolean;
  touching: boolean;
  file: string | null;
  tool: ActiveToolsForAgent | null;
  threadActive: boolean;
  onPickAgent: () => void;
  onPickFile: (path: string) => void;
}) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [bursts, setBursts] = useState<ToolBurstItem[]>([]);
  const lastToolRef = useRef<string | null>(null);
  const cls = classesFor(agentColorOf(agent));

  // 새 도구 사용 → 버스트 spawn. 1.5s 후 자동 제거.
  useEffect(() => {
    const latest = tool?.recent[tool.recent.length - 1];
    const name = latest?.name ?? null;
    if (!name) {
      lastToolRef.current = null;
      return;
    }
    if (name === lastToolRef.current) return;
    lastToolRef.current = name;
    const id = Date.now() + Math.random();
    setBursts((prev) => [...prev, { id, name }]);
    const timeout = window.setTimeout(() => {
      setBursts((prev) => prev.filter((b) => b.id !== id));
    }, 1500);
    return () => window.clearTimeout(timeout);
  }, [tool]);

  // 머리 위 상태 표시 — 우선순위: touching > thinking > idle.
  const stateBadge = (() => {
    if (working && touching && file) return "edit";
    if (working) return "thinking";
    return "idle";
  })();

  return (
    <div
      className="absolute"
      style={{
        left: `${x}%`,
        top: `${y}%`,
        transform: "translate(-50%, -50%)",
        zIndex: hovered ? 30 : 10,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <style>{`
        @keyframes seat-bob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-2px); }
        }
        @keyframes tool-burst {
          0% { opacity: 0; transform: translate(-50%, 6px) scale(0.85); }
          15% { opacity: 1; }
          100% { opacity: 0; transform: translate(-50%, -42px) scale(1.1); }
        }
        @keyframes typing-dot {
          0%, 60%, 100% { opacity: 0.3; }
          30% { opacity: 1; }
        }
      `}</style>

      <div className="relative flex flex-col items-center gap-1.5">
        {/* 머리 위: typing dots / edit 펜 */}
        <div className="h-4 flex items-center justify-center">
          {stateBadge === "thinking" ? (
            <div className="flex gap-0.5 items-center px-1.5 py-0.5 rounded-full bg-card border border-border shadow-sm">
              <span
                className={cn("size-1 rounded-full", cls.dot)}
                style={{ animation: "typing-dot 1.2s ease-in-out infinite" }}
              />
              <span
                className={cn("size-1 rounded-full", cls.dot)}
                style={{
                  animation: "typing-dot 1.2s ease-in-out infinite",
                  animationDelay: "200ms",
                }}
              />
              <span
                className={cn("size-1 rounded-full", cls.dot)}
                style={{
                  animation: "typing-dot 1.2s ease-in-out infinite",
                  animationDelay: "400ms",
                }}
              />
            </div>
          ) : stateBadge === "edit" ? (
            <div
              className={cn(
                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium",
                cls.bgSoft,
                cls.text,
                "border",
                cls.border,
              )}
            >
              <Pen className="size-2.5" />
              {t("room.state.editing")}
            </div>
          ) : null}
        </div>

        {/* 배지 — bob 애니메이션 idle 시. */}
        <button
          type="button"
          onClick={onPickAgent}
          title={`${t("room.talk")} @${agent.name}`}
          aria-label={`Talk to ${agent.name}`}
          className={cn(
            "relative cursor-pointer transition-transform hover:scale-110 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-card rounded-md",
            cls.ring,
            working && "ring-2 ring-offset-2 ring-offset-card",
            threadActive && !working && "ring-1 ring-offset-1 ring-offset-card",
          )}
          style={
            !working && !hovered
              ? { animation: "seat-bob 3.5s ease-in-out infinite" }
              : undefined
          }
        >
          <AgentInitialBadge agent={agent} size="xl" live={touching} />

          {/* tool 버스트 — 머리 위로 떠오름. */}
          {bursts.map((b) => (
            <span
              key={b.id}
              aria-hidden
              className="absolute left-1/2 top-0 pointer-events-none"
              style={{
                animation: "tool-burst 1.4s ease-out forwards",
              }}
            >
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-foreground text-background text-[9px] font-medium whitespace-nowrap shadow-md mono">
                {toolIcon(b.name)} {b.name.slice(0, 14)}
              </span>
            </span>
          ))}
        </button>

        {/* 모니터 카드 — 컴팩트 버전. 호버 시 expanded 카드가 옆에 뜸. */}
        <MonitorCard
          file={file}
          tool={tool}
          working={working}
          onPickFile={onPickFile}
        />

        {/* 이름 라벨 */}
        <span className="text-[10px] mono text-muted-foreground/80 truncate max-w-[140px]">
          @{agent.name}
        </span>
      </div>

      {/* 호버 시 — 풍부한 카드. 자리 우측에 띄움 (또는 좌측, 화면 가장자리 회피). */}
      {hovered ? (
        <HoverCard agent={agent} tool={tool} file={file} working={working} />
      ) : null}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// MonitorCard — 모니터처럼 보이는 작은 정보 패널.
// ──────────────────────────────────────────────────────────────────────────

function MonitorCard({
  file,
  tool,
  working,
  onPickFile,
}: {
  file: string | null;
  tool: ActiveToolsForAgent | null;
  working: boolean;
  onPickFile: (path: string) => void;
}) {
  const { t } = useI18n();
  const latest = tool?.recent[tool.recent.length - 1];

  const status: "edit" | "tool" | "thinking" | "idle" = file
    ? "edit"
    : latest
      ? "tool"
      : working
        ? "thinking"
        : "idle";

  return (
    <button
      type="button"
      disabled={!file}
      onClick={() => file && onPickFile(file)}
      title={file ?? (latest?.name ?? "")}
      className={cn(
        "relative w-[140px] rounded-md border bg-zinc-950 text-zinc-100 px-2 py-1.5 mono shadow-sm overflow-hidden",
        file ? "cursor-pointer hover:border-foreground/60" : "cursor-default",
        working ? "border-emerald-500/40" : "border-zinc-800",
      )}
    >
      {/* 위쪽 한 줄 — 상태 아이콘 + 텍스트 */}
      <div className="flex items-center gap-1 min-w-0">
        {status === "edit" ? (
          <Pen className="size-2.5 text-emerald-400 shrink-0" />
        ) : status === "tool" ? (
          <Wrench className="size-2.5 text-amber-400 shrink-0" />
        ) : status === "thinking" ? (
          <span
            className="size-1.5 rounded-full bg-emerald-400 shrink-0"
            style={{ animation: "typing-dot 1.2s ease-in-out infinite" }}
          />
        ) : (
          <span className="size-1.5 rounded-full bg-zinc-600 shrink-0" />
        )}
        <span
          className={cn(
            "text-[9.5px] truncate",
            status === "edit"
              ? "text-emerald-300"
              : status === "tool"
                ? "text-amber-300"
                : status === "thinking"
                  ? "text-emerald-300/80"
                  : "text-zinc-500",
          )}
        >
          {status === "edit"
            ? basename(file!)
            : status === "tool"
              ? `${toolIcon(latest!.name)} ${latest!.name}`
              : status === "thinking"
                ? t("room.monitor.thinking")
                : t("room.monitor.idle")}
        </span>
      </div>
      {/* 작은 진행 바 — working 일 때 활성. */}
      {working ? (
        <div className="mt-1 h-0.5 w-full rounded-full bg-zinc-800 overflow-hidden">
          <div
            className={cn("h-full rounded-full bg-emerald-400/70")}
            style={{
              animation: "monitor-scan 1.8s ease-in-out infinite",
              width: "40%",
            }}
          />
        </div>
      ) : (
        <div className="mt-1 h-0.5 w-full rounded-full bg-zinc-900" />
      )}
      <style>{`
        @keyframes monitor-scan {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(250%); }
        }
      `}</style>
      {/* hover 시 외부 클릭 힌트. */}
      {file ? (
        <ExternalLink className="absolute top-1 right-1 size-2.5 text-zinc-600 group-hover:text-zinc-300" />
      ) : null}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 호버 카드 — 풍부한 정보.
// ──────────────────────────────────────────────────────────────────────────

function HoverCard({
  agent,
  tool,
  file,
  working,
}: {
  agent: Agent;
  tool: ActiveToolsForAgent | null;
  file: string | null;
  working: boolean;
}) {
  const { t } = useI18n();
  const cls = classesFor(agentColorOf(agent));
  const recent = (tool?.recent ?? []).slice(-5).reverse();
  const mcps = tool?.mcpServers ?? [];

  return (
    <div
      role="tooltip"
      className="absolute left-full ml-3 top-1/2 -translate-y-1/2 z-40 pointer-events-none"
    >
      <div className="rounded-md border border-border bg-popover/95 backdrop-blur shadow-xl px-3 py-2 min-w-[200px] max-w-[260px]">
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
        <div className="mt-0.5 text-[11px] text-foreground/80">
          {working
            ? file
              ? t("room.hover.editing")
              : t("room.hover.thinking")
            : t("room.hover.idle")}
        </div>
        {file ? (
          <div className="mt-1 text-[10px] mono text-emerald-700 dark:text-emerald-300 truncate">
            ✎ {file}
          </div>
        ) : null}
        {recent.length > 0 ? (
          <div className="mt-1.5">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60 mb-0.5">
              {t("room.hover.recentTools")}
            </div>
            <div className="flex flex-wrap gap-0.5">
              {recent.map((r, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-0.5 px-1 h-4 rounded text-[9px] mono bg-foreground/[0.06] text-foreground/80"
                  title={r.target ?? r.name}
                >
                  <span>{toolIcon(r.name)}</span>
                  <span className="truncate max-w-[80px]">{r.name}</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {mcps.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-0.5">
            {mcps.slice(0, 3).map((s) => (
              <span
                key={s}
                className="inline-flex items-center px-1 h-4 rounded text-[9px] mono bg-violet-500/10 text-violet-700 dark:text-violet-300"
              >
                🔌 {s}
              </span>
            ))}
          </div>
        ) : null}
        <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground/80 italic">
          <MessageSquare className="size-3" />
          {t("room.hover.click")}
        </div>
      </div>
    </div>
  );
}
