import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { Run, RunStatus } from "@loom/core";
import { api } from "../api/client.js";
import { Badge, Button, Card, Field, Input, Textarea } from "../components/ui.js";
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

export function RunsPage() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const agentId = searchParams.get("agentId") ?? undefined;
  const status = (searchParams.get("status") as RunStatus | null) ?? undefined;

  const agents = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.listAgents(),
  });
  const runs = useQuery({
    queryKey: ["runs", { agentId, status }],
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

  const [showForm, setShowForm] = useState(false);

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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("runs.title")}</h1>
        <Button onClick={() => setShowForm((s) => !s)}>
          {showForm ? t("common.cancel") : t("runs.new")}
        </Button>
      </div>

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

      {showForm ? (
        <NewRunForm
          agentId={agentId}
          onCreated={(run) => {
            setShowForm(false);
            navigate(`/runs/${run.id}`);
          }}
        />
      ) : null}

      {runs.isLoading ? (
        <p className="text-zinc-500 text-sm">{t("common.loading")}</p>
      ) : runs.isError ? (
        <p className="text-red-500 dark:text-red-400 text-sm">
          {runs.error.message}
        </p>
      ) : (runs.data?.runs ?? []).length === 0 ? (
        <Card>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {t("runs.empty")}
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {(runs.data?.runs ?? []).map((r) => (
            <RunRow key={r.id} run={r} agents={agents.data?.agents ?? []} />
          ))}
        </div>
      )}
    </div>
  );
}

function RunRow({
  run,
  agents,
}: {
  run: Run;
  agents: { id: string; name: string }[];
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
      to={`/runs/${run.id}`}
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
        <span>·</span>
        <span className="mono">{new Date(run.createdAt).toLocaleString()}</span>
      </div>
    </Link>
  );
}

function NewRunForm({
  agentId: defaultAgentId,
  onCreated,
}: {
  agentId?: string;
  onCreated: (run: Run) => void;
}) {
  const { t } = useI18n();
  const agents = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.listAgents(),
  });
  const specs = useQuery({ queryKey: ["specs"], queryFn: () => api.listSpecs() });
  const qc = useQueryClient();

  const [agentId, setAgentId] = useState(defaultAgentId ?? "");
  const [prompt, setPrompt] = useState("");
  const [cwd, setCwd] = useState("");
  const [attachedSpecIds, setAttachedSpecIds] = useState<string[]>([]);

  const create = useMutation({
    mutationFn: api.createRun,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["runs"] });
      onCreated(data.run);
    },
  });

  const selectableAgents = useMemo(() => agents.data?.agents ?? [], [agents.data]);
  const allSpecs = useMemo(() => specs.data?.specs ?? [], [specs.data]);

  const toggleSpec = (id: string) => {
    setAttachedSpecIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const selectClasses =
    "h-9 w-full rounded-md border px-2 text-sm border-zinc-300 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100";

  return (
    <Card className="space-y-4">
      <h2 className="font-medium">{t("runs.new")}</h2>
      <Field label={t("runs.field.agent")}>
        <select
          className={selectClasses}
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
        >
          <option value="">{t("runs.field.agent.placeholder")}</option>
          {selectableAgents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.adapterKind})
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("runs.field.prompt")} hint={t("runs.field.prompt.hint")}>
        <Textarea
          rows={6}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t("runs.field.prompt.placeholder")}
        />
      </Field>
      {allSpecs.length > 0 ? (
        <Field
          label={t("runs.field.attachSpecs", {
            selected: attachedSpecIds.length,
            total: allSpecs.length,
          })}
          hint={t("runs.field.attachSpecs.hint")}
        >
          <div className="rounded-md border p-2 max-h-44 overflow-y-auto space-y-1 border-zinc-200 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/50">
            {allSpecs.map((s) => {
              const checked = attachedSpecIds.includes(s.id);
              return (
                <label
                  key={s.id}
                  className={
                    "flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-pointer " +
                    (checked
                      ? "bg-zinc-200 dark:bg-zinc-800/60"
                      : "hover:bg-zinc-100 dark:hover:bg-zinc-800/40")
                  }
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSpec(s.id)}
                  />
                  <span className="flex-1 truncate">{s.name}</span>
                  <span className="text-xs text-zinc-500 mono">
                    {(s.content.length / 1024).toFixed(1)}KB
                  </span>
                </label>
              );
            })}
          </div>
        </Field>
      ) : null}
      <Field label={t("runs.field.cwd")}>
        <Input
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder={t("runs.field.cwd.placeholder")}
        />
      </Field>
      {create.error ? (
        <p className="text-xs text-red-500 dark:text-red-400">{create.error.message}</p>
      ) : null}
      <div className="flex justify-end">
        <Button
          disabled={!agentId || !prompt || create.isPending}
          onClick={() =>
            create.mutate({
              agentId,
              prompt,
              cwd: cwd || undefined,
              attachedSpecIds:
                attachedSpecIds.length > 0 ? attachedSpecIds : undefined,
            })
          }
        >
          {create.isPending ? t("common.starting") : t("runs.button.startRun")}
        </Button>
      </div>
    </Card>
  );
}
