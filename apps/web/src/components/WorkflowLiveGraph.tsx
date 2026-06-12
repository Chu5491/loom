// 워크플로우 라이브 그래프 — Office 에디터와 같은 좌표(x/y)로 그리되,
// 편집 대신 실행 상태를 입힌다: 노드별 run 상태(running 펄스·success·fail),
// 대기 게이트(승인 버튼 인라인), 진행 엣지 애니메이션. 정의는 손대지 않는 뷰.

import { useMemo } from "react";
import type { RunInfo, WorkflowEdge, WorkflowGate, WorkflowNode, WorkflowSpec } from "@loom/core";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

const VIEW_W = 820;
const VIEW_H = 440;
const NODE_W = 150;
const NODE_H = 54;

const ON_TONE: Record<WorkflowEdge["on"], string> = {
  success: "var(--color-success, #22c55e)",
  fail: "var(--color-destructive, #ef4444)",
  always: "var(--color-muted-foreground, #888)",
};

type NodeState = "pending" | "running" | "succeeded" | "failed" | "gate";

const NODE_STROKE: Record<NodeState, string> = {
  pending: "var(--color-border)",
  running: "var(--color-primary)",
  succeeded: "var(--color-success, #22c55e)",
  failed: "var(--color-destructive, #ef4444)",
  gate: "var(--color-warning, #f59e0b)",
};

/** 체인의 run 들에서 노드별 최신 상태를 뽑는다 — 같은 노드를 재방문했으면 마지막 run 기준. */
export function nodeStates(wf: WorkflowSpec, chainRuns: RunInfo[], gates: WorkflowGate[]): Map<string, NodeState> {
  const out = new Map<string, NodeState>();
  for (const n of wf.nodes) out.set(n.id, "pending");
  const sorted = [...chainRuns].sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
  for (const r of sorted) {
    if (!r.node || !out.has(r.node)) continue;
    out.set(
      r.node,
      r.status === "running" ? "running" : r.status === "succeeded" ? "succeeded" : "failed",
    );
  }
  for (const g of gates) {
    if (g.workflow === wf.name && out.has(g.nodeId)) out.set(g.nodeId, "gate");
  }
  return out;
}

export function WorkflowLiveGraph({
  wf, chainRuns, gates, onGate,
}: {
  wf: WorkflowSpec;
  chainRuns: RunInfo[];
  gates: WorkflowGate[];
  onGate: (id: string, ok: boolean) => void;
}) {
  const { t } = useI18n();
  const byId = useMemo(() => new Map(wf.nodes.map((n) => [n.id, n])), [wf.nodes]);
  const states = useMemo(() => nodeStates(wf, chainRuns, gates), [wf, chainRuns, gates]);
  const agentByNode = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of chainRuns) if (r.node) m.set(r.node, r.agent);
    return m;
  }, [chainRuns]);
  const pos = (n: WorkflowNode) => ({ x: n.x ?? 100, y: n.y ?? 100 });

  // 그려진 좌표 범위만큼만 보이게 — 노드가 위쪽에 몰려 있으면 아래 여백을 잘라낸다.
  const viewBox = useMemo(() => {
    const ys = wf.nodes.map((n) => pos(n).y);
    const maxY = Math.min(VIEW_H, Math.max(...ys, 0) + NODE_H);
    return `0 0 ${VIEW_W} ${Math.max(160, maxY + 16)}`;
  }, [wf.nodes]);

  return (
    <svg viewBox={viewBox} className="w-full rounded-xl border border-border/60 bg-card/40">
      <defs>
        <marker id="wf-live-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" className="text-muted-foreground" />
        </marker>
      </defs>

      {wf.edges.map((e, i) => {
        const a = byId.get(e.from);
        const b = byId.get(e.to);
        if (!a || !b) return null;
        const pa = pos(a);
        const pb = pos(b);
        const mx = (pa.x + pb.x) / 2;
        const my = (pa.y + pb.y) / 2 - 36;
        // from 이 끝났고 to 가 돌고 있으면 "지금 흐르는 길" — 점선을 흘려보낸다.
        const flowing = states.get(e.from) === "succeeded" && (states.get(e.to) === "running" || states.get(e.to) === "gate");
        return (
          <g key={i}>
            <path
              d={`M ${pa.x} ${pa.y} Q ${mx} ${my} ${pb.x} ${pb.y}`}
              fill="none"
              stroke={ON_TONE[e.on]}
              strokeWidth={flowing ? 2.5 : 1.5}
              strokeDasharray={flowing ? "6 5" : e.on === "always" ? "5 4" : undefined}
              markerEnd="url(#wf-live-arrow)"
              opacity={flowing ? 1 : 0.55}
            >
              {flowing ? <animate attributeName="stroke-dashoffset" from="22" to="0" dur="0.9s" repeatCount="indefinite" /> : null}
            </path>
          </g>
        );
      })}

      {wf.nodes.map((n) => {
        const p = pos(n);
        const st = states.get(n.id) ?? "pending";
        const gate = st === "gate" ? gates.find((g) => g.workflow === wf.name && g.nodeId === n.id) : undefined;
        const agent = agentByNode.get(n.id) ?? n.agent;
        return (
          <g key={n.id} transform={`translate(${p.x - NODE_W / 2}, ${p.y - NODE_H / 2})`}>
            {st === "running" || st === "gate" ? (
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={14}
                fill="none"
                stroke={NODE_STROKE[st]}
                strokeWidth={2}
                opacity={0.5}
              >
                <animate attributeName="stroke-width" values="2;7;2" dur="1.6s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.5;0.12;0.5" dur="1.6s" repeatCount="indefinite" />
              </rect>
            ) : null}
            <rect
              width={NODE_W}
              height={NODE_H}
              rx={14}
              stroke={NODE_STROKE[st]}
              strokeWidth={2}
              className={cn("fill-card", st === "pending" && "opacity-60")}
            />
            <text x={10} y={22} style={{ fontSize: 13, fontWeight: 600 }} className="fill-foreground">
              {n.kind === "gate" ? `⏸ ${t("wf.gate")}` : `@${agent || "?"}`}
            </text>
            <text x={10} y={40} style={{ fontSize: 10 }} className="fill-muted-foreground">
              {n.id}
              {st === "running" ? ` · ${t("talk.wfNode.running")}` : st === "succeeded" ? " · ✓" : st === "failed" ? " · ✗" : ""}
            </text>
            {gate ? (
              <>
                {/* SVG 안 버튼 — foreignObject 대신 단순 rect+text (양 테마 토큰 사용) */}
                <g className="cursor-pointer" onClick={() => onGate(gate.id, true)}>
                  <rect x={NODE_W + 8} y={2} width={58} height={22} rx={7} fill="var(--color-success, #22c55e)" opacity={0.15} stroke="var(--color-success, #22c55e)" strokeOpacity={0.4} />
                  <text x={NODE_W + 37} y={17} textAnchor="middle" style={{ fontSize: 10, fontWeight: 600 }} fill="var(--color-success, #22c55e)">
                    {t("talk.gate.approve")}
                  </text>
                </g>
                <g className="cursor-pointer" onClick={() => onGate(gate.id, false)}>
                  <rect x={NODE_W + 8} y={30} width={58} height={22} rx={7} fill="var(--color-destructive, #ef4444)" opacity={0.15} stroke="var(--color-destructive, #ef4444)" strokeOpacity={0.4} />
                  <text x={NODE_W + 37} y={45} textAnchor="middle" style={{ fontSize: 10, fontWeight: 600 }} fill="var(--color-destructive, #ef4444)">
                    {t("talk.gate.reject")}
                  </text>
                </g>
              </>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
