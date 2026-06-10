// 채팅 곁의 동행 패널 — 이 프로젝트 팀의 하네스(핸드오프 그래프)를 작게 보여주고,
// 일하는 중인 에이전트를 라이브로 점멸. 아래엔 다음 스케줄. "소통 + 하네스가 한눈에".
//
// 데이터는 전부 기존 엔드포인트 재사용: 팀(agents prop) + harness edges + schedules.

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Agent } from "@loom/core";
import { api } from "../api/client.js";
import { agentColorOf, classesFor } from "./agentColor.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

const VIEW = 220;
const NODE_R = 22;

function nodePos(i: number, n: number) {
  const c = VIEW / 2;
  if (n === 1) return { x: c, y: c };
  const R = Math.min(78, 44 + n * 6);
  const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
  return { x: c + R * Math.cos(ang), y: c + R * Math.sin(ang) };
}

function edgePath(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const sx = a.x + ux * NODE_R;
  const sy = a.y + uy * NODE_R;
  const ex = b.x - ux * (NODE_R + 7);
  const ey = b.y - uy * (NODE_R + 7);
  const mx = (sx + ex) / 2 - uy * 16;
  const my = (sy + ey) / 2 + ux * 16;
  return `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`;
}

export function TeamHarnessPanel({
  projectId,
  agents,
  workingIds,
}: {
  projectId: string;
  agents: Agent[];
  workingIds: Set<string>;
}) {
  const { t } = useI18n();

  const edgesQuery = useQuery({
    queryKey: ["harness", projectId],
    queryFn: () => api.listHarnessEdges(projectId),
    enabled: !!projectId,
  });
  const schedulesQuery = useQuery({
    queryKey: ["schedules"],
    queryFn: () => api.listSchedules(),
  });

  const edges = edgesQuery.data?.edges ?? [];
  const posById = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    agents.forEach((a, i) => m.set(a.id, nodePos(i, agents.length)));
    return m;
  }, [agents]);

  // 다음 발화 예정 스케줄 — 이 팀 에이전트 중 enabled + 가장 이른 nextFireAt.
  const teamIds = useMemo(() => new Set(agents.map((a) => a.id)), [agents]);
  const nextSchedule = useMemo(() => {
    const upcoming = (schedulesQuery.data?.schedules ?? [])
      .filter((s) => s.enabled && s.nextFireAt && teamIds.has(s.agentId))
      .sort((a, b) => (a.nextFireAt! < b.nextFireAt! ? -1 : 1));
    return upcoming[0] ?? null;
  }, [schedulesQuery.data, teamIds]);

  return (
    <aside className="hidden w-[232px] shrink-0 flex-col border-l border-border bg-muted/20 lg:flex">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <span className="text-sm font-medium">{t("teamPanel.title")}</span>
        <Link
          to={`/projects/${projectId}/harness`}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          {t("teamPanel.edit")}
        </Link>
      </div>

      <div className="p-2">
        {agents.length < 2 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {t("teamPanel.needAgents")}
          </p>
        ) : (
          <svg
            viewBox={`0 0 ${VIEW} ${VIEW}`}
            className="w-full"
            role="img"
            aria-label={t("teamPanel.title")}
          >
            <defs>
              <marker
                id="tp-arrow"
                markerWidth="8"
                markerHeight="8"
                refX="6"
                refY="3"
                orient="auto"
              >
                <path d="M0,0 L6,3 L0,6 Z" fill="#888780" />
              </marker>
            </defs>
            {edges.map((e) => {
              const a = posById.get(e.fromAgentId);
              const b = posById.get(e.toAgentId);
              if (!a || !b) return null;
              return (
                <path
                  key={e.id}
                  d={edgePath(a, b)}
                  fill="none"
                  stroke="#888780"
                  strokeWidth={1.2}
                  strokeDasharray={e.mode === "ask" ? "4 3" : undefined}
                  markerEnd="url(#tp-arrow)"
                />
              );
            })}
            {agents.map((a) => {
              const p = posById.get(a.id)!;
              const cls = classesFor(agentColorOf(a));
              const working = workingIds.has(a.id);
              return (
                <g key={a.id} className={cls.text}>
                  {working ? (
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={NODE_R + 3}
                      fill="currentColor"
                      fillOpacity={0.18}
                      className="animate-pulse"
                    />
                  ) : null}
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={NODE_R}
                    fill="currentColor"
                    fillOpacity={0.12}
                    stroke="currentColor"
                    strokeWidth={working ? 2 : 1.3}
                  />
                  <text
                    x={p.x}
                    y={p.y + 3}
                    textAnchor="middle"
                    fontSize={10}
                    fill="currentColor"
                  >
                    {a.name.slice(0, 6)}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      <div className="mt-auto border-t border-border px-3 py-2.5">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground/80">
          {t("teamPanel.nextRun")}
        </div>
        {nextSchedule ? (
          <Link
            to={`/projects/${projectId}/schedules`}
            className="mt-1 block truncate text-xs text-foreground hover:underline"
          >
            {nextSchedule.name}
            <span className="ml-1.5 text-muted-foreground">
              {new Date(nextSchedule.nextFireAt!).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </Link>
        ) : (
          <Link
            to={`/projects/${projectId}/schedules`}
            className={cn(
              "mt-1 block text-xs text-muted-foreground hover:text-foreground",
            )}
          >
            {t("teamPanel.noSchedule")}
          </Link>
        )}
      </div>
    </aside>
  );
}
