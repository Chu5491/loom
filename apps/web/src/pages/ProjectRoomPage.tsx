import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client.js";
import { Card } from "../components/ui.js";
import { MissionPane } from "../components/MissionPane.js";
import { PixelRoom, type Delegation } from "../components/PixelRoom.js";
import { useI18n } from "../context/I18nContext.js";
import { useTheme } from "../context/ThemeContext.js";

export function ProjectRoomPage() {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const { effective } = useTheme();

  const agents = useQuery({
    queryKey: ["agents", { projectId: id }],
    queryFn: () => api.listAgents({ projectId: id }),
    enabled: !!id,
  });
  const skills = useQuery({
    queryKey: ["specs"],
    queryFn: () => api.listSpecs(),
  });
  const runs = useQuery({
    queryKey: ["runs", { projectId: id }],
    queryFn: () => api.listRuns({ limit: 50 }),
    refetchInterval: 1500,
    enabled: !!id,
  });

  const agentList = agents.data?.agents ?? [];
  const projectAgentIds = useMemo(
    () => new Set(agentList.map((a) => a.id)),
    [agentList],
  );

  const projectRuns = useMemo(
    () => (runs.data?.runs ?? []).filter((r) => projectAgentIds.has(r.agentId)),
    [runs.data, projectAgentIds],
  );

  const activeAgentIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of projectRuns) {
      if (r.status === "queued" || r.status === "running") {
        set.add(r.agentId);
      }
    }
    return set;
  }, [projectRuns]);

  const delegations: Delegation[] = useMemo(() => {
    const byId = new Map(projectRuns.map((r) => [r.id, r]));
    const out: Delegation[] = [];
    const seen = new Set<string>();
    for (const child of projectRuns) {
      if (!child.parentRunId) continue;
      if (child.status !== "queued" && child.status !== "running") continue;
      const parent = byId.get(child.parentRunId);
      if (!parent) continue;
      const key = `${parent.agentId}->${child.agentId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ fromAgentId: parent.agentId, toAgentId: child.agentId });
    }
    return out;
  }, [projectRuns]);

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedAgentId && !projectAgentIds.has(selectedAgentId)) {
      setSelectedAgentId(null);
    }
  }, [selectedAgentId, projectAgentIds]);

  if (agents.isLoading) {
    return <p className="text-zinc-500 text-sm">{t("common.loading")}</p>;
  }
  if (agentList.length === 0) {
    return (
      <Card>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {t("room.empty")}{" "}
          <Link
            to={`/projects/${id}/agents`}
            className="text-sky-600 dark:text-sky-300 hover:underline"
          >
            {t("agents.new")}
          </Link>
        </p>
      </Card>
    );
  }

  // Bound the room to the remaining viewport so the MissionPane scrolls
  // internally instead of pushing the whole page taller. The 240px estimate
  // covers the global header + project header + tab strip + status bar +
  // padding; close enough across themes that nothing else needs to scroll.
  return (
    <div
      className="flex flex-col gap-3 min-h-0"
      style={{ height: "calc(100vh - 240px)" }}
    >
      <RoomStatusBar
        agentCount={agentList.length}
        activeCount={activeAgentIds.size}
        skillCount={skills.data?.specs.length ?? 0}
        runCount={projectRuns.length}
        delegationCount={delegations.length}
      />
      <div className="grid flex-1 min-h-0 gap-4 lg:grid-cols-[auto_minmax(380px,1fr)] items-stretch">
        <div className="overflow-hidden flex items-start justify-center">
          <PixelRoom
            agents={agentList}
            activeAgentIds={activeAgentIds}
            delegations={delegations}
            isDark={effective === "dark"}
            selectedAgentId={selectedAgentId}
            onAgentClick={(agentId) =>
              setSelectedAgentId((prev) => (prev === agentId ? null : agentId))
            }
          />
        </div>
        <div className="min-h-0 min-w-0 h-full">
          <MissionPane
            projectId={id!}
            selectedAgentId={selectedAgentId}
            agents={agentList}
            runs={projectRuns}
            onClose={() => setSelectedAgentId(null)}
          />
        </div>
      </div>
    </div>
  );
}

function RoomStatusBar({
  agentCount,
  activeCount,
  skillCount,
  runCount,
  delegationCount,
}: {
  agentCount: number;
  activeCount: number;
  skillCount: number;
  runCount: number;
  delegationCount: number;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-zinc-200 bg-zinc-50/50 px-4 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900/50">
      <div className="flex flex-wrap items-center gap-4">
        <Stat label={t("room.stat.agents")} value={agentCount} />
        <Stat
          label={t("room.stat.active")}
          value={activeCount}
          tone={activeCount > 0 ? "ok" : "muted"}
        />
        <Stat label={t("room.stat.skills")} value={skillCount} />
        <Stat label={t("room.stat.runs")} value={runCount} />
        {delegationCount > 0 ? (
          <Stat
            label={t("room.stat.delegations")}
            value={delegationCount}
            tone="warn"
          />
        ) : null}
      </div>
      <span className="text-zinc-500 mono">{t("room.hint")}</span>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: number;
  tone?: "muted" | "ok" | "warn";
}) {
  const colors = {
    muted: "text-zinc-700 dark:text-zinc-300",
    ok: "text-emerald-700 dark:text-emerald-400",
    warn: "text-amber-700 dark:text-amber-400",
  } as const;
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-zinc-500 uppercase tracking-wide">{label}</span>
      <span className={`text-base font-semibold ${colors[tone]}`}>{value}</span>
    </span>
  );
}
