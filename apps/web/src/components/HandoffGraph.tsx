// 스레드의 parent → child 핸드오프를 들여쓰기 트리로 보여줌. 그래프 라이브러리 없이
// 평범한 ul + 들여쓰기로 충분 (한 스레드의 run은 보통 ≤ 30개, 깊이 ≤ 5).

import { useMemo } from "react";
import type { AdapterManifest, Agent, Run } from "@loom/core";
import { AdapterIcon } from "./AdapterIcon.js";
import { agentColorOf, classesFor } from "./agentColor.js";
import { runStatusVariant } from "../lib/runStatus.js";
import { Badge } from "./ui/badge.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

interface TreeNode {
  run: Run;
  children: TreeNode[];
}

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
  const tree = useMemo(() => buildTree(runs), [runs]);
  const agentById = useMemo(
    () => new Map(agents.map((a) => [a.id, a])),
    [agents],
  );
  const manifestByKind = useMemo(
    () => new Map(manifests.map((m) => [m.kind, m])),
    [manifests],
  );

  if (tree.length === 0) return null;

  return (
    <div className="h-full overflow-auto p-3 bg-muted/30">
      <ul className="space-y-1">
        {tree.map((n) => (
          <RunRow
            key={n.run.id}
            node={n}
            depth={0}
            agentById={agentById}
            manifestByKind={manifestByKind}
            onJump={onJump}
          />
        ))}
      </ul>
    </div>
  );
}

function RunRow({
  node,
  depth,
  agentById,
  manifestByKind,
  onJump,
}: {
  node: TreeNode;
  depth: number;
  agentById: Map<string, Agent>;
  manifestByKind: Map<string, AdapterManifest>;
  onJump?: (runId: string) => void;
}) {
  const { t } = useI18n();
  const r = node.run;
  const agent = agentById.get(r.agentId);
  const manifest = agent ? manifestByKind.get(agent.adapterKind) : undefined;
  const cls = agent ? classesFor(agentColorOf(agent)) : null;

  return (
    <li>
      <button
        type="button"
        onClick={() => onJump?.(r.id)}
        className={cn(
          "group w-full flex items-start gap-2 rounded-md border bg-card px-2.5 py-1.5 text-left transition-colors",
          cls?.border ?? "border-border",
          "hover:bg-muted/50",
        )}
        style={{ marginLeft: `${depth * 16}px` }}
      >
        {/* 깊이가 0이 아니면 좌측에 가는 ↳ 표시로 부모 자식 관계 시각화 */}
        {depth > 0 ? (
          <span
            aria-hidden
            className="text-muted-foreground/50 mono text-[11px] leading-5 shrink-0"
          >
            ↳
          </span>
        ) : null}
        {manifest ? (
          <AdapterIcon manifest={manifest} size={18} />
        ) : (
          <span className="size-4 rounded bg-muted shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "text-xs font-semibold truncate",
                cls?.text ?? "text-foreground",
              )}
            >
              @{agent?.name ?? "—"}
            </span>
            <Badge
              variant={runStatusVariant(r.status)}
              className="h-3.5 px-1 text-[9px] shrink-0"
            >
              {t(`status.${r.status}`)}
            </Badge>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2 leading-tight">
            {r.prompt}
          </p>
        </div>
      </button>
      {node.children.length > 0 ? (
        <ul className="mt-1 space-y-1">
          {node.children.map((c) => (
            <RunRow
              key={c.run.id}
              node={c}
              depth={depth + 1}
              agentById={agentById}
              manifestByKind={manifestByKind}
              onJump={onJump}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

// parent_run_id 기준으로 트리 구성. 부모를 못 찾는 run은 루트.
function buildTree(runs: Run[]): TreeNode[] {
  if (runs.length === 0) return [];
  const byId = new Map(runs.map((r) => [r.id, r]));
  const nodeOf = new Map<string, TreeNode>();
  for (const r of runs) nodeOf.set(r.id, { run: r, children: [] });

  const roots: TreeNode[] = [];
  for (const r of runs) {
    const n = nodeOf.get(r.id)!;
    const parentId = r.parentRunId && byId.has(r.parentRunId) ? r.parentRunId : null;
    if (parentId) {
      nodeOf.get(parentId)!.children.push(n);
    } else {
      roots.push(n);
    }
  }
  // 시간순 정렬 — 최신이 위로 가는 게 자연스러운 핸드오프 흐름.
  const sortByTime = (a: TreeNode, b: TreeNode) =>
    new Date(a.run.createdAt).getTime() - new Date(b.run.createdAt).getTime();
  const walk = (ns: TreeNode[]) => {
    ns.sort(sortByTime);
    for (const n of ns) walk(n.children);
  };
  walk(roots);
  return roots;
}
