import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { Run, RunStatus } from "@loom/core";
import { api } from "../api/client.js";
import { Badge, Card, Field } from "../components/ui.js";
import { useI18n } from "../context/I18nContext.js";

const ALL_STATUSES: RunStatus[] = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
];

function statusTone(s: RunStatus) {
  switch (s) {
    case "succeeded":
      return "success" as const;
    case "failed":
      return "danger" as const;
    case "cancelled":
      return "warn" as const;
    case "running":
      return "info" as const;
    default:
      return "neutral" as const;
  }
}

/**
 * History view — read-only audit trail of every run in the project. Starting
 * a new run lives on the Room tab now (Mission Pane). This page exists so
 * users can find, filter, and inspect past runs.
 */
export function RunsPage() {
  const { t } = useI18n();
  const params = useParams<{ id?: string }>();
  const projectId = params.id;
  const [searchParams, setSearchParams] = useSearchParams();
  const agentId = searchParams.get("agentId") ?? undefined;
  const status = (searchParams.get("status") as RunStatus | null) ?? undefined;
  const baseUrl = projectId ? `/projects/${projectId}/runs` : "/runs";

  const agents = useQuery({
    queryKey: ["agents", { projectId }],
    queryFn: () => api.listAgents({ projectId }),
  });
  const projectAgentIds = agents.data?.agents.map((a) => a.id) ?? [];
  const runs = useQuery({
    queryKey: ["runs", { projectId, agentId, status }],
    queryFn: () => api.listRuns({ agentId, status, limit: 100 }),
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return false;
      const hasActive = data.runs.some(
        (r) => r.status === "queued" || r.status === "running",
      );
      return hasActive ? 1500 : false;
    },
  });

  const setFilter = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const selectClasses =
    "h-9 rounded-md border px-2 text-sm border-zinc-300 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100";

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {t("runs.history.hint")}
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("runs.filter.agent")}>
          <select
            className={selectClasses}
            value={agentId ?? ""}
            onChange={(e) => setFilter("agentId", e.target.value || undefined)}
          >
            <option value="">{t("runs.filter.all")}</option>
            {(agents.data?.agents ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("runs.filter.status")}>
          <select
            className={selectClasses}
            value={status ?? ""}
            onChange={(e) => setFilter("status", e.target.value || undefined)}
          >
            <option value="">{t("runs.filter.all")}</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {(() => {
        const visible = projectId
          ? (runs.data?.runs ?? []).filter((r) =>
              projectAgentIds.includes(r.agentId),
            )
          : runs.data?.runs ?? [];
        if (runs.isLoading) {
          return <p className="text-zinc-500 text-sm">{t("common.loading")}</p>;
        }
        if (runs.isError) {
          return (
            <p className="text-red-500 dark:text-red-400 text-sm">
              {runs.error.message}
            </p>
          );
        }
        if (visible.length === 0) {
          return (
            <Card>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {t("runs.empty")}
              </p>
            </Card>
          );
        }
        return (
          <div className="space-y-2">
            {visible.map((r) => (
              <RunRow
                key={r.id}
                run={r}
                agents={agents.data?.agents ?? []}
                baseUrl={baseUrl}
              />
            ))}
          </div>
        );
      })()}
    </div>
  );
}

function RunRow({
  run,
  agents,
  baseUrl,
}: {
  run: Run;
  agents: { id: string; name: string }[];
  baseUrl: string;
}) {
  const { t } = useI18n();
  const agent = agents.find((a) => a.id === run.agentId);
  const dur =
    run.startedAt && run.endedAt
      ? `${((new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime()) / 1000).toFixed(1)}s`
      : run.startedAt
        ? t("runs.duration.running")
        : "—";

  return (
    <Link
      to={`${baseUrl}/${run.id}`}
      className="block rounded-md border px-4 py-2.5 transition-colors border-zinc-200 bg-zinc-50/50 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/50 dark:hover:border-zinc-700"
    >
      <div className="flex items-center gap-3">
        <Badge tone={statusTone(run.status)}>{t(`status.${run.status}`)}</Badge>
        <span className="text-sm truncate flex-1 text-zinc-700 dark:text-zinc-300">
          {run.prompt.slice(0, 100)}
        </span>
        <span className="text-xs text-zinc-500 mono shrink-0">{dur}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
        <span>{agent?.name ?? run.agentId.slice(0, 8)}</span>
        {run.parentRunId ? (
          <>
            <span>·</span>
            <span title={t("runDetail.section.parentRun")}>↳ delegated</span>
          </>
        ) : null}
        <span>·</span>
        <span className="mono">{new Date(run.createdAt).toLocaleString()}</span>
      </div>
    </Link>
  );
}
