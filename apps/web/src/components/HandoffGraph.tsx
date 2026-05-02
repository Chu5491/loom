// 스레드 안 run의 parent → child 관계를 노드 그래프로. ~50 run까지는 BFS 좌표로 충분.

import { useMemo } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { AdapterManifest, Agent, Run } from "@loom/core";
import { AdapterIcon } from "./AdapterIcon.js";
import { agentColorOf, classesFor } from "./agentColor.js";
import { runStatusVariant } from "../lib/runStatus.js";
import { Badge } from "./ui/badge.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

interface RunNodeData extends Record<string, unknown> {
  run: Run;
  agent: Agent | undefined;
  manifest: AdapterManifest | undefined;
  onJump?: (runId: string) => void;
}

const NODE_WIDTH = 220;
const NODE_HEIGHT = 84;
const COLUMN_GAP = 280;
const ROW_GAP = 110;

export function HandoffGraph({
  runs,
  agents,
  manifests,
  onJump,
}: {
  runs: Run[];
  agents: Agent[];
  manifests: AdapterManifest[];
  onJump?: (runId: string) => void;
}) {
  const { nodes, edges } = useMemo(
    () => buildGraph(runs, agents, manifests, onJump),
    [runs, agents, manifests, onJump],
  );

  return (
    <div className="h-full w-full bg-muted/30">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={{ run: RunNode }}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
      >
        <Background gap={24} size={1} className="opacity-30" />
        <Controls
          showInteractive={false}
          className="!bg-background !border-border"
        />
      </ReactFlow>
    </div>
  );
}

function RunNode({ data }: NodeProps) {
  const { t } = useI18n();
  const d = data as RunNodeData;
  const { run, agent, manifest, onJump } = d;
  const cls = agent ? classesFor(agentColorOf(agent)) : null;

  return (
    <button
      type="button"
      onClick={() => onJump?.(run.id)}
      className={cn(
        "group relative flex flex-col gap-1 rounded-lg border bg-card p-2.5 text-left shadow-sm transition-all",
        "hover:shadow-md hover:-translate-y-0.5",
        cls?.border ?? "border-border",
      )}
      style={{ width: NODE_WIDTH }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!size-2 !bg-foreground/30 !border-0"
      />
      <div className="flex items-center gap-2 min-w-0">
        {manifest ? (
          <AdapterIcon manifest={manifest} size={20} />
        ) : (
          <span className="size-5 rounded bg-muted shrink-0" />
        )}
        <span className={cn("text-xs font-semibold truncate flex-1", cls?.text)}>
          @{agent?.name ?? "—"}
        </span>
        <Badge
          variant={runStatusVariant(run.status)}
          className="h-3.5 px-1 text-[9px] shrink-0"
        >
          {t(`status.${run.status}`)}
        </Badge>
      </div>
      <p className="text-[10px] text-muted-foreground line-clamp-2 leading-tight">
        {run.prompt}
      </p>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!size-2 !bg-foreground/30 !border-0"
      />
    </button>
  );
}

// BFS로 부모-자식 트리 구성. parent 없는 run은 루트.
// 같은 깊이의 노드는 가로로 나란히, 자식은 한 단계 아래로.
function buildGraph(
  runs: Run[],
  agents: Agent[],
  manifests: AdapterManifest[],
  onJump?: (runId: string) => void,
): { nodes: Node<RunNodeData>[]; edges: Edge[] } {
  if (runs.length === 0) return { nodes: [], edges: [] };

  const byId = new Map(runs.map((r) => [r.id, r]));
  const childrenByParent = new Map<string | null, Run[]>();
  for (const r of runs) {
    const key = r.parentRunId && byId.has(r.parentRunId) ? r.parentRunId : null;
    const arr = childrenByParent.get(key) ?? [];
    arr.push(r);
    childrenByParent.set(key, arr);
  }

  const positions = new Map<string, { x: number; y: number }>();
  const visit = (parentId: string | null, depth: number, x: number): number => {
    const kids = childrenByParent.get(parentId) ?? [];
    if (kids.length === 0) return x;
    let cursor = x;
    for (const k of kids) {
      const startX = cursor;
      const next = visit(k.id, depth + 1, cursor);
      const myX = next > startX ? (startX + next - COLUMN_GAP) / 2 : startX;
      positions.set(k.id, { x: myX, y: depth * ROW_GAP });
      cursor = Math.max(next, startX + COLUMN_GAP);
    }
    return cursor;
  };
  visit(null, 0, 0);

  const agentById = new Map(agents.map((a) => [a.id, a]));
  const manifestByKind = new Map(manifests.map((m) => [m.kind, m]));

  const nodes: Node<RunNodeData>[] = runs.map((r) => {
    const a = agentById.get(r.agentId);
    const m = a ? manifestByKind.get(a.adapterKind) : undefined;
    const pos = positions.get(r.id) ?? { x: 0, y: 0 };
    return {
      id: r.id,
      type: "run",
      position: pos,
      data: { run: r, agent: a, manifest: m, onJump },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    };
  });

  const edges: Edge[] = runs
    .filter((r) => r.parentRunId && byId.has(r.parentRunId))
    .map((r) => ({
      id: `${r.parentRunId}->${r.id}`,
      source: r.parentRunId!,
      target: r.id,
      animated: r.status === "running" || r.status === "queued",
      style: { stroke: "var(--muted-foreground)", strokeOpacity: 0.5 },
    }));

  return { nodes, edges };
}
