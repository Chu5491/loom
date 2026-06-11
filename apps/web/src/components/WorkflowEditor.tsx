// 워크플로우 그래프 캔버스 — 노드(스텝)를 드래그로 배치하고 엣지(성공/실패/항상)로
// 잇는 편집기. 정의는 office/workflows/<name>.json (PUT 으로 저장).
// 실행은 Talk 의 수동 버튼 — 여기는 정의만.

import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, CirclePlay, Link2, Plus, Trash2, X, Zap } from "lucide-react";
import type { AgentSpec, WorkflowEdge, WorkflowNode, WorkflowSpec } from "@loom/core";
import { api } from "../api/client.js";
import { AgentAvatar } from "./AgentAvatar.js";
import { Button } from "./ui.js";
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

function newNodeId(nodes: WorkflowNode[]): string {
  let i = 1;
  while (nodes.some((n) => n.id === `n${i}`)) i++;
  return `n${i}`;
}

export function WorkflowEditor({ agents }: { agents: AgentSpec[] }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const officeQ = qc.getQueryData<{ office: { workflows: WorkflowSpec[] } }>(["office"]);
  const workflows = officeQ?.office.workflows ?? [];

  const [editing, setEditing] = useState<WorkflowSpec | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (wf: WorkflowSpec) => api.putWorkflow(wf),
    onSuccess: () => { setDirty(false); setErr(null); void qc.invalidateQueries({ queryKey: ["office"] }); },
    onError: (e) => setErr(e instanceof Error ? e.message.replace(/^\d+ [^:]+: /, "") : String(e)),
  });
  const del = useMutation({
    mutationFn: (name: string) => api.deleteWorkflow(name),
    onSuccess: () => { setEditing(null); void qc.invalidateQueries({ queryKey: ["office"] }); },
  });

  function open(wf: WorkflowSpec) {
    setEditing(structuredClone(wf));
    setDirty(false);
    setErr(null);
  }
  function create() {
    const name = newName.trim();
    if (!name) return;
    const first = agents[0]?.name ?? "";
    setEditing({
      name,
      entry: "n1",
      nodes: [{ id: "n1", agent: first, prompt: "{{input}}", x: 120, y: 180 }],
      edges: [],
    });
    setCreating(false);
    setNewName("");
    setDirty(true);
  }

  return (
    <div>
      {/* 목록 + 새로 만들기 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {workflows.map((w) => (
          <button
            key={w.name}
            type="button"
            onClick={() => open(w)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              editing?.name === w.name ? "border-primary/50 bg-primary/15" : "border-border text-muted-foreground hover:bg-muted/60",
            )}
          >
            <CirclePlay className="size-3.5" />
            {w.name}
            <span className="text-[10px] text-muted-foreground">{w.nodes.length}</span>
          </button>
        ))}
        {creating ? (
          <span className="inline-flex items-center gap-1">
            <input
              autoFocus
              value={newName}
              placeholder={t("wf.namePh")}
              onChange={(e) => setNewName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Enter") create();
                if (e.key === "Escape") setCreating(false);
              }}
              className="h-7 w-36 rounded-md border border-primary/50 bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <Button size="sm" disabled={!newName.trim()} onClick={create}><Check className="size-3.5" /></Button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
          >
            <Plus className="size-3.5" />
            {t("wf.new")}
          </button>
        )}
      </div>

      {editing ? (
        <Canvas
          key={editing.name}
          wf={editing}
          agents={agents}
          onChange={(next) => { setEditing(next); setDirty(true); }}
          onSave={() => save.mutate(editing)}
          onDelete={() => { if (workflows.some((w) => w.name === editing.name)) del.mutate(editing.name); else setEditing(null); }}
          saving={save.isPending}
          dirty={dirty}
          err={err}
        />
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">{t("wf.empty")}</p>
      )}
    </div>
  );
}

// ── 캔버스 + 선택 패널 ─────────────────────────────────────────────────────────
function Canvas({
  wf, agents, onChange, onSave, onDelete, saving, dirty, err,
}: {
  wf: WorkflowSpec;
  agents: AgentSpec[];
  onChange: (next: WorkflowSpec) => void;
  onSave: () => void;
  onDelete: () => void;
  saving: boolean;
  dirty: boolean;
  err: string | null;
}) {
  const { t } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);
  const [sel, setSel] = useState<{ kind: "node"; id: string } | { kind: "edge"; i: number } | null>(
    { kind: "node", id: wf.entry },
  );
  // 연결 모드 — 노드 패널의 "연결" 클릭 후 대상 노드 클릭으로 엣지 생성.
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);

  const byId = useMemo(() => new Map(wf.nodes.map((n) => [n.id, n])), [wf.nodes]);
  const selNode = sel?.kind === "node" ? byId.get(sel.id) : undefined;
  const selEdge = sel?.kind === "edge" ? wf.edges[sel.i] : undefined;

  function svgPoint(e: React.PointerEvent): { x: number; y: number } {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * VIEW_W,
      y: ((e.clientY - rect.top) / rect.height) * VIEW_H,
    };
  }

  function patchNode(id: string, patch: Partial<WorkflowNode>) {
    onChange({ ...wf, nodes: wf.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) });
  }

  function addNode() {
    const id = newNodeId(wf.nodes);
    const node: WorkflowNode = {
      id,
      agent: agents[0]?.name ?? "",
      prompt: "{{result}}",
      x: 120 + ((wf.nodes.length * 170) % (VIEW_W - 200)),
      y: 90 + ((wf.nodes.length * 110) % (VIEW_H - 160)),
    };
    onChange({ ...wf, nodes: [...wf.nodes, node] });
    setSel({ kind: "node", id });
  }

  function removeNode(id: string) {
    if (wf.nodes.length <= 1) return;
    const nodes = wf.nodes.filter((n) => n.id !== id);
    onChange({
      ...wf,
      nodes,
      edges: wf.edges.filter((e) => e.from !== id && e.to !== id),
      entry: wf.entry === id ? nodes[0]!.id : wf.entry,
    });
    setSel(null);
  }

  function clickNode(id: string) {
    if (linkFrom && linkFrom !== id) {
      if (!wf.edges.some((e) => e.from === linkFrom && e.to === id)) {
        onChange({ ...wf, edges: [...wf.edges, { from: linkFrom, to: id, on: "success" }] });
        setSel({ kind: "edge", i: wf.edges.length });
      }
      setLinkFrom(null);
      return;
    }
    setSel({ kind: "node", id });
  }

  const pos = (n: WorkflowNode) => ({ x: n.x ?? 100, y: n.y ?? 100 });

  return (
    <div className="mt-4">
      {/* 액션 바 */}
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">{wf.name}</span>
        {linkFrom ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
            <Link2 className="size-3" />
            {t("wf.linkHint", { from: linkFrom })}
            <button type="button" onClick={() => setLinkFrom(null)}><X className="size-3" /></button>
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="secondary" size="sm" onClick={addNode}>
            <Plus className="size-3.5" />
            {t("wf.addNode")}
          </Button>
          <Button variant="danger" size="sm" onClick={onDelete}>
            <Trash2 className="size-3.5" />
          </Button>
          <Button size="sm" disabled={!dirty || saving} onClick={onSave}>
            <Check className="size-3.5" />
            {saving ? "…" : t("wf.save")}
          </Button>
        </div>
      </div>
      {err ? <p className="mb-2 text-xs text-destructive">{err}</p> : null}

      {/* 트리거 — 에이전트 run 종료 시 자동/제안 발화 (옛 하네스 흡수). 없으면 수동 전용 */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-xl border border-border/60 bg-muted/20 px-2.5 py-1.5 text-xs">
        <Zap className="size-3.5 text-primary" />
        <span className="font-medium text-muted-foreground">{t("wf.trigger")}</span>
        <select
          value={wf.trigger?.agent ?? ""}
          onChange={(e) =>
            onChange({
              ...wf,
              trigger: e.target.value
                ? { agent: e.target.value, on: wf.trigger?.on ?? "success", mode: wf.trigger?.mode ?? "ask" }
                : null,
            })
          }
          className="h-7 rounded-md border border-input bg-background px-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">{t("wf.trigger.manual")}</option>
          {agents.map((a) => (
            <option key={a.name} value={a.name}>@{a.name}</option>
          ))}
        </select>
        {wf.trigger ? (
          <>
            <select
              value={wf.trigger.on}
              onChange={(e) => onChange({ ...wf, trigger: { ...wf.trigger!, on: e.target.value as "success" | "fail" | "changes" } })}
              className="h-7 rounded-md border border-input bg-background px-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="success">{t("wf.trigger.success")}</option>
              <option value="fail">{t("wf.trigger.fail")}</option>
              <option value="changes">{t("wf.trigger.changes")}</option>
            </select>
            <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
              {(["auto", "ask"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onChange({ ...wf, trigger: { ...wf.trigger!, mode: m } })}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-xs font-medium transition-all",
                    wf.trigger!.mode === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(`wf.trigger.${m}`)}
                </button>
              ))}
            </div>
            <span className="text-[10px] text-muted-foreground">{t("wf.trigger.hint")}</span>
          </>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        {/* SVG 캔버스 */}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="h-[440px] w-full touch-none rounded-2xl border border-border bg-card/60"
          onPointerMove={(e) => {
            if (!drag.current) return;
            const p = svgPoint(e);
            patchNode(drag.current.id, {
              x: Math.round(Math.min(VIEW_W - 80, Math.max(80, p.x - drag.current.dx))),
              y: Math.round(Math.min(VIEW_H - 40, Math.max(40, p.y - drag.current.dy))),
            });
          }}
          onPointerUp={() => { drag.current = null; }}
        >
          <defs>
            <marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" className="text-muted-foreground" />
            </marker>
          </defs>

          {/* 엣지 — from/to 노드 중심을 잇는 곡선 */}
          {wf.edges.map((e, i) => {
            const a = byId.get(e.from);
            const b = byId.get(e.to);
            if (!a || !b) return null;
            const pa = pos(a);
            const pb = pos(b);
            const mx = (pa.x + pb.x) / 2;
            const my = (pa.y + pb.y) / 2 - 36;
            const seld = sel?.kind === "edge" && sel.i === i;
            return (
              <g key={i} onClick={() => setSel({ kind: "edge", i })} className="cursor-pointer">
                <path
                  d={`M ${pa.x} ${pa.y} Q ${mx} ${my} ${pb.x} ${pb.y}`}
                  fill="none"
                  stroke={ON_TONE[e.on]}
                  strokeWidth={seld ? 3 : 1.5}
                  strokeDasharray={e.on === "always" ? "5 4" : undefined}
                  markerEnd="url(#wf-arrow)"
                  opacity={seld ? 1 : 0.7}
                />
                <text x={mx} y={my + 14} textAnchor="middle" className="fill-muted-foreground text-[10px]" style={{ fontSize: 10 }}>
                  {t(`wf.on.${e.on}`)}
                </text>
              </g>
            );
          })}

          {/* 노드 — 카드(아바타+에이전트명), entry 는 링 강조 */}
          {wf.nodes.map((n) => {
            const p = pos(n);
            const selected = sel?.kind === "node" && sel.id === n.id;
            const isEntry = wf.entry === n.id;
            return (
              <g
                key={n.id}
                transform={`translate(${p.x - NODE_W / 2}, ${p.y - NODE_H / 2})`}
                className="cursor-grab"
                onPointerDown={(e) => {
                  const pt = svgPoint(e);
                  drag.current = { id: n.id, dx: pt.x - p.x, dy: pt.y - p.y };
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                }}
                onClick={() => clickNode(n.id)}
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={14}
                  className={cn(
                    "fill-card stroke-2",
                    selected ? "stroke-[var(--color-primary)]" : isEntry ? "stroke-[var(--color-primary)] opacity-90" : "stroke-[var(--color-border)]",
                  )}
                  strokeDasharray={linkFrom && linkFrom !== n.id ? "4 3" : undefined}
                />
                {isEntry ? (
                  <text x={10} y={16} style={{ fontSize: 10 }} className="fill-[var(--color-primary)]">▶ {t("wf.entry")}</text>
                ) : null}
                <text x={10} y={isEntry ? 34 : 26} style={{ fontSize: 13, fontWeight: 600 }} className="fill-foreground">
                  {n.kind === "gate" ? `⏸ ${t("wf.gate")}` : `@${n.agent || "?"}`}
                </text>
                <text x={10} y={isEntry ? 48 : 42} style={{ fontSize: 10 }} className="fill-muted-foreground">
                  {n.id}{n.kind === "gate" ? "" : ` · ${(n.prompt || "").slice(0, 18)}`}
                </text>
              </g>
            );
          })}
        </svg>

        {/* 선택 패널 */}
        <div className="rounded-2xl border border-border bg-card p-4">
          {selNode ? (
            <NodePanel
              wf={wf}
              node={selNode}
              agents={agents}
              onPatch={(p) => patchNode(selNode.id, p)}
              onEntry={() => onChange({ ...wf, entry: selNode.id })}
              onLink={() => setLinkFrom(selNode.id)}
              onRemove={() => removeNode(selNode.id)}
            />
          ) : selEdge ? (
            <EdgePanel
              edge={selEdge}
              onOn={(on) => onChange({ ...wf, edges: wf.edges.map((e, i) => (sel?.kind === "edge" && i === sel.i ? { ...e, on } : e)) })}
              onRemove={() => {
                onChange({ ...wf, edges: wf.edges.filter((_, i) => !(sel?.kind === "edge" && i === sel.i)) });
                setSel(null);
              }}
            />
          ) : (
            <p className="text-xs text-muted-foreground">{t("wf.pick")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function NodePanel({
  wf, node, agents, onPatch, onEntry, onLink, onRemove,
}: {
  wf: WorkflowSpec;
  node: WorkflowNode;
  agents: AgentSpec[];
  onPatch: (p: Partial<WorkflowNode>) => void;
  onEntry: () => void;
  onLink: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const agent = agents.find((a) => a.name === node.agent);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {agent ? <AgentAvatar adapter={agent.adapter} size={22} className="rounded-md" /> : null}
        <span className="font-mono text-xs text-muted-foreground">{node.id}</span>
        {wf.entry === node.id ? (
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">{t("wf.entry")}</span>
        ) : (
          <button type="button" onClick={onEntry} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:border-primary/50 hover:text-primary">
            {t("wf.makeEntry")}
          </button>
        )}
      </div>

      {/* 노드 종류 — 에이전트 스텝 vs 휴먼 게이트(승인=성공 경로 / 거부=실패 경로) */}
      <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
        {(["agent", "gate"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onPatch(k === "gate" ? { kind: "gate", agent: "" } : { kind: "agent", agent: node.agent || agents[0]?.name || "" })}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
              (node.kind ?? "agent") === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`wf.kind.${k}`)}
          </button>
        ))}
      </div>

      {node.kind === "gate" ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{t("wf.gate.hint")}</p>
      ) : (
        <>
          <div>
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">{t("wf.agent")}</p>
            <select
              value={node.agent}
              onChange={(e) => onPatch({ agent: e.target.value })}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {agents.map((a) => (
                <option key={a.name} value={a.name}>@{a.name} · {a.adapter}</option>
              ))}
            </select>
          </div>

          <div>
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">{t("wf.prompt")}</p>
            <textarea
              value={node.prompt}
              onChange={(e) => onPatch({ prompt: e.target.value })}
              placeholder={t("wf.promptPh")}
              className="min-h-28 w-full rounded-lg border border-input bg-background px-2.5 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">{t("wf.promptHint")}</p>
          </div>
        </>
      )}

      <div className="flex gap-1.5">
        <Button variant="secondary" size="sm" onClick={onLink}>
          <Link2 className="size-3.5" />
          {t("wf.link")}
        </Button>
        <Button variant="danger" size="sm" onClick={onRemove}>
          <Trash2 className="size-3.5" />
          {t("wf.removeNode")}
        </Button>
      </div>
    </div>
  );
}

function EdgePanel({
  edge, onOn, onRemove,
}: {
  edge: WorkflowEdge;
  onOn: (on: WorkflowEdge["on"]) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      <p className="font-mono text-xs text-muted-foreground">{edge.from} → {edge.to}</p>
      <div>
        <p className="mb-1 text-[11px] font-medium text-muted-foreground">{t("wf.onLabel")}</p>
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
          {(["success", "fail", "always"] as const).map((on) => (
            <button
              key={on}
              type="button"
              onClick={() => onOn(on)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                edge.on === on ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`wf.on.${on}`)}
            </button>
          ))}
        </div>
      </div>
      <Button variant="danger" size="sm" onClick={onRemove}>
        <Trash2 className="size-3.5" />
        {t("wf.removeEdge")}
      </Button>
    </div>
  );
}
