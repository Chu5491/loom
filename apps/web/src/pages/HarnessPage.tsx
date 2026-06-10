// Harness Studio — 에이전트 팀을 노드로, 핸드오프 규칙을 엣지로 보는 캔버스.
// 노드는 원형 배치(자동 레이아웃), 엣지는 곡선+화살표. 엣지 추가/선택/삭제 +
// auto↔ask 토글. 실제 발화 엔진(run-service)이 이 엣지들을 읽어 동작한다.

import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent, HarnessEdge, HarnessMode, HarnessTrigger } from "@loom/core";
import { PageScroll } from "../components/PageScroll.js";
import { PageHeader } from "../components/PageHeader.js";
import { Button, Card, Field, Textarea, Badge } from "../components/ui.js";
import { agentColorOf, classesFor } from "../components/agentColor.js";
import { useI18n } from "../context/I18nContext.js";
import { api, type CreateHarnessEdgeBody } from "../api/client.js";
import { cn } from "../lib/utils.js";

const TRIGGERS: HarnessTrigger[] = ["on_success", "on_fail", "on_changes", "manual"];
const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

const TRIGGER_SHORT: Record<HarnessTrigger, string> = {
  on_success: "pass",
  on_fail: "fail",
  on_changes: "changes",
  manual: "manual",
};

// ── geometry ────────────────────────────────────────────────────────────────
const VIEW_W = 800;
const VIEW_H = 380;
const NODE_R = 30;

function nodePos(i: number, n: number) {
  const cx = VIEW_W / 2;
  const cy = VIEW_H / 2;
  if (n === 1) return { x: cx, y: cy };
  const R = Math.min(150, 90 + n * 8);
  const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
  return { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) };
}

function edgeGeometry(
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const sx = a.x + ux * NODE_R;
  const sy = a.y + uy * NODE_R;
  const ex = b.x - ux * (NODE_R + 9);
  const ey = b.y - uy * (NODE_R + 9);
  // bend to the left of travel so A→B and B→A separate.
  const bend = 26;
  const mx = (sx + ex) / 2 - uy * bend;
  const my = (sy + ey) / 2 + ux * bend;
  const d = `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`;
  // quadratic midpoint for the label.
  const lx = 0.25 * sx + 0.5 * mx + 0.25 * ex;
  const ly = 0.25 * sy + 0.5 * my + 0.25 * ey;
  return { d, lx, ly };
}

export function HarnessPage() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const agentsQuery = useQuery({
    queryKey: ["agents", { projectId }],
    queryFn: () => api.listAgents({ projectId }),
    enabled: !!projectId,
  });
  const edgesQuery = useQuery({
    queryKey: ["harness", projectId],
    queryFn: () => api.listHarnessEdges(projectId!),
    enabled: !!projectId,
  });

  const agents = agentsQuery.data?.agents ?? [];
  const edges = edgesQuery.data?.edges ?? [];
  const agentById = useMemo(
    () => new Map(agents.map((a) => [a.id, a])),
    [agents],
  );
  const posById = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    agents.forEach((a, i) => m.set(a.id, nodePos(i, agents.length)));
    return m;
  }, [agents]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["harness", projectId] });

  const create = useMutation({
    mutationFn: (body: CreateHarnessEdgeBody) => api.createHarnessEdge(body),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: (args: { id: string; mode: HarnessMode }) =>
      api.updateHarnessEdge(args.id, { mode: args.mode }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteHarnessEdge(id),
    onSuccess: () => {
      invalidate();
      setSelectedId(null);
    },
  });

  return (
    <PageScroll className="space-y-4">
      <PageHeader title={t("harness.title")} description={t("harness.subtitle")} />

      {agents.length < 2 ? (
        <Card>
          <p className="text-sm text-muted-foreground">{t("harness.needAgents")}</p>
        </Card>
      ) : (
        <>
          <Card noPad className="overflow-hidden bg-muted/20">
            <svg
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              className="w-full"
              role="img"
              aria-label={t("harness.title")}
            >
              <defs>
                <marker
                  id="harness-arrow"
                  markerWidth="9"
                  markerHeight="9"
                  refX="7"
                  refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L7,3 L0,6 Z" fill="currentColor" />
                </marker>
              </defs>

              {edges.map((e) => {
                const a = posById.get(e.fromAgentId);
                const b = posById.get(e.toAgentId);
                if (!a || !b) return null;
                const { d, lx, ly } = edgeGeometry(a, b);
                const selected = e.id === selectedId;
                const label = TRIGGER_SHORT[e.trigger];
                return (
                  <g
                    key={e.id}
                    className={cn(
                      "cursor-pointer",
                      selected ? "text-primary" : "text-muted-foreground",
                    )}
                    onClick={() => setSelectedId(e.id)}
                  >
                    <path
                      d={d}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={selected ? 2.2 : 1.4}
                      strokeDasharray={e.mode === "ask" ? "5 4" : undefined}
                      markerEnd="url(#harness-arrow)"
                    />
                    {/* wide invisible hit area */}
                    <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
                    <rect
                      x={lx - label.length * 3.5 - 5}
                      y={ly - 9}
                      width={label.length * 7 + 10}
                      height={16}
                      rx={4}
                      className="fill-background"
                    />
                    <text
                      x={lx}
                      y={ly + 3}
                      textAnchor="middle"
                      fontSize={11}
                      fill="currentColor"
                      className="font-mono"
                    >
                      {label}
                    </text>
                  </g>
                );
              })}

              {agents.map((a) => {
                const p = posById.get(a.id)!;
                const cls = classesFor(agentColorOf(a));
                const initials = a.name.slice(0, 2);
                return (
                  <g key={a.id} className={cls.text}>
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={NODE_R}
                      fill="currentColor"
                      fillOpacity={0.12}
                      stroke="currentColor"
                      strokeWidth={1.5}
                    />
                    <text
                      x={p.x}
                      y={p.y + 4}
                      textAnchor="middle"
                      fontSize={13}
                      fontWeight={500}
                      fill="currentColor"
                    >
                      {initials}
                    </text>
                    <text
                      x={p.x}
                      y={p.y + NODE_R + 14}
                      textAnchor="middle"
                      fontSize={11}
                      className="fill-foreground"
                    >
                      @{a.name.length > 14 ? a.name.slice(0, 13) + "…" : a.name}
                    </text>
                  </g>
                );
              })}
            </svg>
            <div className="flex items-center gap-4 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-px w-5 bg-muted-foreground" />
                {t("harness.legend.auto")}
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-px w-5 border-t border-dashed border-muted-foreground"
                  style={{ borderTopWidth: 1 }}
                />
                {t("harness.legend.ask")}
              </span>
            </div>
          </Card>

          <AddEdgeForm
            agents={agents}
            projectId={projectId!}
            onCreate={(body) => create.mutate(body)}
            pending={create.isPending}
            error={create.error?.message ?? null}
          />

          <div className="space-y-2">
            {edges.length === 0 ? (
              <Card>
                <p className="text-sm text-muted-foreground">{t("harness.empty")}</p>
              </Card>
            ) : (
              edges.map((e) => (
                <EdgeRow
                  key={e.id}
                  edge={e}
                  from={agentById.get(e.fromAgentId)}
                  to={agentById.get(e.toAgentId)}
                  selected={e.id === selectedId}
                  onSelect={() => setSelectedId(e.id)}
                  onToggleMode={() =>
                    update.mutate({
                      id: e.id,
                      mode: e.mode === "auto" ? "ask" : "auto",
                    })
                  }
                  onDelete={() => remove.mutate(e.id)}
                />
              ))
            )}
          </div>
        </>
      )}
    </PageScroll>
  );
}

function AddEdgeForm({
  agents,
  projectId,
  onCreate,
  pending,
  error,
}: {
  agents: Agent[];
  projectId: string;
  onCreate: (body: CreateHarnessEdgeBody) => void;
  pending: boolean;
  error: string | null;
}) {
  const { t } = useI18n();
  const [fromId, setFromId] = useState(agents[0]?.id ?? "");
  const [toId, setToId] = useState(agents[1]?.id ?? "");
  const [trigger, setTrigger] = useState<HarnessTrigger>("on_success");
  const [mode, setMode] = useState<HarnessMode>("ask");
  const [carry, setCarry] = useState(false);
  const [prompt, setPrompt] = useState("");

  const valid =
    fromId && toId && fromId !== toId && (prompt.trim() || carry);

  return (
    <Card className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label={t("harness.field.from")}>
          <select
            className={selectClass}
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("harness.field.to")}>
          <select
            className={selectClass}
            value={toId}
            onChange={(e) => setToId(e.target.value)}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("harness.field.trigger")}>
          <select
            className={selectClass}
            value={trigger}
            onChange={(e) => setTrigger(e.target.value as HarnessTrigger)}
          >
            {TRIGGERS.map((tr) => (
              <option key={tr} value={tr}>
                {t(`harness.trigger.${tr}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("harness.field.mode")}>
          <select
            className={selectClass}
            value={mode}
            onChange={(e) => setMode(e.target.value as HarnessMode)}
          >
            <option value="ask">{t("harness.mode.ask")}</option>
            <option value="auto">{t("harness.mode.auto")}</option>
          </select>
        </Field>
      </div>

      <Field label={t("harness.field.prompt")} hint={t("harness.field.promptHint")}>
        <Textarea
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </Field>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={carry}
            onChange={(e) => setCarry(e.target.checked)}
          />
          {t("harness.field.carry")}
        </label>
        <div className="flex items-center gap-2">
          {error ? <span className="text-xs text-destructive">{error}</span> : null}
          <Button
            disabled={!valid || pending}
            onClick={() =>
              onCreate({
                projectId,
                fromAgentId: fromId,
                toAgentId: toId,
                trigger,
                mode,
                carryResult: carry,
                prompt: prompt.trim() || null,
              })
            }
          >
            {t("harness.addEdge")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function EdgeRow({
  edge,
  from,
  to,
  selected,
  onSelect,
  onToggleMode,
  onDelete,
}: {
  edge: HarnessEdge;
  from: Agent | undefined;
  to: Agent | undefined;
  selected: boolean;
  onSelect: () => void;
  onToggleMode: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  return (
    <Card
      noPad
      onClick={onSelect}
      className={cn(
        "flex cursor-pointer items-center gap-2 px-3 py-2",
        selected && "ring-2 ring-primary",
      )}
    >
      <span className="truncate text-sm font-medium">@{from?.name ?? "—"}</span>
      <span className="text-muted-foreground">→</span>
      <span className="truncate text-sm font-medium">@{to?.name ?? "—"}</span>
      <Badge tone="neutral">{t(`harness.trigger.${edge.trigger}`)}</Badge>
      <Badge tone={edge.mode === "auto" ? "success" : "neutral"}>
        {t(`harness.mode.${edge.mode}`)}
      </Badge>
      {edge.carryResult ? <Badge tone="info">{t("harness.carryBadge")}</Badge> : null}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={(ev) => {
            ev.stopPropagation();
            onToggleMode();
          }}
        >
          {edge.mode === "auto" ? t("harness.makeAsk") : t("harness.makeAuto")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={(ev) => {
            ev.stopPropagation();
            onDelete();
          }}
        >
          {t("common.delete")}
        </Button>
      </div>
    </Card>
  );
}
