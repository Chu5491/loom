import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import type {
  AdapterField,
  AdapterManifest,
  AdapterSelectOption,
  Agent,
  Project,
} from "@loom/core";
import {
  api,
  type CreateAgentBody,
  type UpdateAgentBody,
} from "../api/client.js";
import { Badge, Button, Card, Field, Input, Textarea } from "../components/ui.js";
import { PageScroll } from "../components/PageScroll.js";
import { AdapterFieldInput } from "../components/AdapterFields.js";
import { AdapterIcon } from "../components/AdapterIcon.js";
import {
  AdapterRefreshButton,
  AdapterStatusDetails,
  AdapterStatusLive,
} from "../components/AdapterStatus.js";
import { AdapterTestButton } from "../components/AdapterTest.js";
import { useI18n } from "../context/I18nContext.js";

type FormMode = { mode: "create" } | { mode: "edit"; agent: Agent };

export function AgentsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  // Always nested under /projects/:id — the parent route provides the
  // project scope. There is no flat "all agents" listing in the new
  // navigation model.
  const { id: projectId } = useParams<{ id: string }>();

  const projects = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
  const list = useQuery({
    queryKey: ["agents", { projectId }],
    queryFn: () => api.listAgents({ projectId }),
  });
  const adapters = useQuery({ queryKey: ["adapters"], queryFn: api.listAdapters });

  const activeProject = projectId
    ? projects.data?.projects.find((p) => p.id === projectId)
    : undefined;

  const [formState, setFormState] = useState<FormMode | null>(null);

  const create = useMutation({
    mutationFn: api.createAgent,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      setFormState(null);
    },
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAgentBody }) =>
      api.updateAgent(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      setFormState(null);
    },
  });

  const remove = useMutation({
    mutationFn: api.deleteAgent,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });

  return (
    <PageScroll className="space-y-4">
      <div className="flex justify-end">
        <Button
          onClick={() =>
            setFormState((s) => (s ? null : { mode: "create" }))
          }
          disabled={!activeProject && (projects.data?.projects.length ?? 0) === 0}
        >
          {formState ? t("common.cancel") : t("agents.new")}
        </Button>
      </div>

      {(projects.data?.projects.length ?? 0) === 0 ? (
        <Card>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {t("agents.needsProject")}{" "}
            <Link
              to="/projects"
              className="text-sky-600 dark:text-sky-300 hover:underline"
            >
              {t("projects.new")}
            </Link>
          </p>
        </Card>
      ) : null}

      {formState ? (
        <AgentForm
          state={formState}
          manifests={adapters.data?.adapters ?? []}
          loadingManifests={adapters.isLoading}
          projects={projects.data?.projects ?? []}
          defaultProjectId={projectId}
          onCancel={() => setFormState(null)}
          submitting={create.isPending || update.isPending}
          error={
            (formState.mode === "create" ? create.error : update.error)
              ?.message ?? null
          }
          onSubmit={(body) => {
            if (formState.mode === "edit") {
              update.mutate({ id: formState.agent.id, body });
            } else {
              create.mutate(body);
            }
          }}
        />
      ) : null}

      {list.isLoading ? (
        <p className="text-zinc-500 text-sm">{t("common.loading")}</p>
      ) : list.isError ? (
        <p className="text-red-500 dark:text-red-400 text-sm">
          {list.error.message}
        </p>
      ) : list.data!.agents.length === 0 ? (
        <Card>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {t("agents.empty")}
          </p>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.data!.agents.map((a) => {
            const manifest = adapters.data?.adapters.find(
              (m) => m.kind === a.adapterKind,
            );
            return (
              <Card key={a.id} className="space-y-3">
                <div className="flex items-start gap-3">
                  {manifest ? <AdapterIcon manifest={manifest} size={32} /> : null}
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/runs?agentId=${a.id}`}
                      className="font-medium hover:underline truncate block"
                    >
                      {a.name}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                      <Badge tone="info">
                        {manifest?.displayName ?? a.adapterKind}
                      </Badge>
                      {a.role ? <Badge>{a.role}</Badge> : null}
                      {typeof a.adapterConfig?.model === "string" ? (
                        <span className="text-xs text-zinc-500 mono truncate">
                          {a.adapterConfig.model as string}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2">
                      <AdapterStatusLive
                        kind={a.adapterKind}
                        command={
                          typeof a.adapterConfig?.command === "string"
                            ? (a.adapterConfig.command as string)
                            : undefined
                        }
                      />
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setFormState({ mode: "edit", agent: a })}
                    >
                      {t("common.edit")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm(t("agents.deleteConfirm", { name: a.name }))) {
                          remove.mutate(a.id);
                        }
                      }}
                    >
                      {t("common.delete")}
                    </Button>
                  </div>
                </div>
                {a.defaultCwd ? (
                  <p className="text-xs text-zinc-500 mono truncate" title={a.defaultCwd}>
                    cwd: {a.defaultCwd}
                  </p>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </PageScroll>
  );
}

const ROLE_OPTIONS = ["engineer", "researcher", "reviewer", "writer", "other"] as const;

function AgentForm({
  state,
  manifests,
  loadingManifests,
  projects,
  defaultProjectId,
  onSubmit,
  submitting,
  error,
  onCancel,
}: {
  state: FormMode;
  manifests: AdapterManifest[];
  loadingManifests: boolean;
  projects: Project[];
  defaultProjectId?: string;
  onSubmit: (body: CreateAgentBody) => void;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const isEdit = state.mode === "edit";
  const editingAgent = isEdit ? state.agent : null;

  const [projectId, setProjectId] = useState<string>(
    editingAgent?.projectId ?? defaultProjectId ?? projects[0]?.id ?? "",
  );
  const [adapterKind, setAdapterKind] = useState<string | null>(
    editingAgent?.adapterKind ?? null,
  );
  const [name, setName] = useState(editingAgent?.name ?? "");
  const [prompt, setPrompt] = useState(editingAgent?.prompt ?? "");
  const [skillIds, setSkillIds] = useState<string[]>(
    editingAgent?.skillIds ?? [],
  );
  const [role, setRole] = useState<string>(editingAgent?.role ?? "");
  const [defaultCwd, setDefaultCwd] = useState(editingAgent?.defaultCwd ?? "");
  const [config, setConfig] = useState<Record<string, unknown>>(
    editingAgent?.adapterConfig ?? {},
  );
  const [showAdvanced, setShowAdvanced] = useState(isEdit);

  const skills = useQuery({ queryKey: ["specs"], queryFn: () => api.listSpecs() });

  const toggleSkill = (id: string) => {
    setSkillIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const selectedManifest = useMemo(
    () => manifests.find((m) => m.kind === adapterKind) ?? null,
    [manifests, adapterKind],
  );

  // When adapter changes in CREATE mode, seed config + name with defaults.
  // In EDIT mode we never auto-overwrite the user's saved values.
  useEffect(() => {
    if (isEdit) return;
    if (selectedManifest) {
      setConfig({ ...selectedManifest.defaultConfig });
      if (!name) setName(selectedManifest.displayName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapterKind]);

  const fieldsBasic = (selectedManifest?.fields ?? []).filter(
    (f) => f.group !== "advanced",
  );
  const fieldsAdvanced = (selectedManifest?.fields ?? []).filter(
    (f) => f.group === "advanced",
  );

  const handleSubmit = () => {
    if (!selectedManifest || !name || !projectId) return;
    onSubmit({
      projectId,
      name,
      prompt: prompt || undefined,
      skillIds,
      adapterKind: selectedManifest.kind,
      role: role || null,
      defaultCwd: defaultCwd || null,
      adapterConfig: stripUndefined(config),
    });
  };

  return (
    <Card className="space-y-6">
      <h2 className="font-medium">
        {isEdit ? t("agents.edit") : t("agents.new")}
      </h2>

      <section className="space-y-3">
        <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {t("agents.section.adapter")}
        </div>
        {loadingManifests ? (
          <p className="text-zinc-500 text-sm">{t("common.loading")}</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {manifests.map((m) => (
              <AdapterCard
                key={m.kind}
                manifest={m}
                selected={adapterKind === m.kind}
                onSelect={() => {
                  if (isEdit && m.kind !== editingAgent!.adapterKind) {
                    if (
                      !confirm(
                        "Switching adapter will reset this agent's config. Continue?",
                      )
                    ) {
                      return;
                    }
                    setConfig({ ...m.defaultConfig });
                  }
                  setAdapterKind(m.kind);
                }}
              />
            ))}
          </div>
        )}
      </section>

      {selectedManifest ? (
        <>
          <SelectedAdapterPanel
            manifest={selectedManifest}
            command={config.command as string | undefined}
          />

          <section className="space-y-3">
            <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {t("agents.section.identity")}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={t("agents.field.project")}
                hint={
                  projects.find((p) => p.id === projectId)?.path ??
                  t("agents.field.projectHint")
                }
              >
                <select
                  className="h-9 w-full rounded-md border px-2 text-sm border-zinc-300 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                >
                  {projects.length === 0 ? (
                    <option value="">{t("agents.field.project.none")}</option>
                  ) : null}
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("agents.field.name")}>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("agents.placeholder.name")}
                />
              </Field>
              <Field label={t("agents.field.role")}>
                <select
                  className="h-9 w-full rounded-md border px-2 text-sm border-zinc-300 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option value="">—</option>
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={t("agents.field.defaultCwd")}
                hint={t("agents.field.defaultCwdHint")}
              >
                <Input
                  value={defaultCwd}
                  onChange={(e) => setDefaultCwd(e.target.value)}
                  placeholder={t("agents.placeholder.defaultCwd")}
                />
              </Field>
            </div>
          </section>

          <section className="space-y-3">
            <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {t("agents.section.prompt")}
            </div>
            <Field
              label={t("agents.field.prompt")}
              hint={t("agents.field.promptHint")}
            >
              <Textarea
                rows={5}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t("agents.placeholder.prompt")}
              />
            </Field>
            <Field
              label={t("agents.field.skills", {
                selected: skillIds.length,
                total: skills.data?.specs.length ?? 0,
              })}
              hint={t("agents.field.skillsHint")}
            >
              {skills.isLoading ? (
                <p className="text-xs text-zinc-500">{t("common.loading")}</p>
              ) : (skills.data?.specs ?? []).length === 0 ? (
                <p className="text-xs text-zinc-500">
                  {t("agents.field.skills.empty")}
                </p>
              ) : (
                <div className="rounded-md border p-2 max-h-52 overflow-y-auto space-y-1 border-zinc-200 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/50">
                  {(skills.data?.specs ?? []).map((s) => {
                    const checked = skillIds.includes(s.id);
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
                          onChange={() => toggleSkill(s.id)}
                        />
                        <span className="flex-1 truncate">{s.name}</span>
                        <span className="text-xs text-zinc-500 mono">
                          {(s.content.length / 1024).toFixed(1)}KB
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </Field>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {t("agents.section.config")}
              </div>
              {selectedManifest.docsUrl ? (
                <a
                  href={selectedManifest.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-sky-600 hover:underline dark:text-sky-300"
                >
                  {t("agents.docsLink")} ↗
                </a>
              ) : null}
            </div>
            <div className="space-y-4">
              {fieldsBasic.map((field) => (
                <ConfigFieldBinder
                  key={field.key}
                  field={field}
                  config={config}
                  setConfig={setConfig}
                  manifest={selectedManifest}
                />
              ))}
            </div>
            <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800">
              <AdapterTestButton
                kind={selectedManifest.kind}
                config={stripUndefined(config)}
                cwd={defaultCwd || undefined}
              />
            </div>
            {fieldsAdvanced.length > 0 ? (
              <div className="border-t border-zinc-200 dark:border-zinc-800 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((s) => !s)}
                  className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  {showAdvanced ? "▼" : "▶"} {t("agents.section.advanced")}
                </button>
                {showAdvanced ? (
                  <div className="mt-3 space-y-4">
                    {fieldsAdvanced.map((field) => (
                      <ConfigFieldBinder
                        key={field.key}
                        field={field}
                        config={config}
                        setConfig={setConfig}
                        manifest={selectedManifest}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      {error ? (
        <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-zinc-200 dark:border-zinc-800 pt-4">
        <Button variant="ghost" size="md" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          disabled={!selectedManifest || !name || !projectId || submitting}
          onClick={handleSubmit}
        >
          {submitting
            ? isEdit
              ? t("common.saving")
              : t("common.creating")
            : isEdit
              ? t("common.save")
              : t("common.create")}
        </Button>
      </div>
    </Card>
  );
}

function SelectedAdapterPanel({
  manifest,
  command,
}: {
  manifest: AdapterManifest;
  command: string | undefined;
}) {
  const { t } = useI18n();
  const probe = useQuery({
    queryKey: ["probe", manifest.kind, command ?? ""],
    queryFn: () => api.probeAdapter(manifest.kind, { command }),
    staleTime: 30_000,
  });

  const ready =
    probe.data?.probe.binary.available &&
    probe.data.probe.auth.state === "authenticated";
  const tone = ready
    ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30"
    : "border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20";

  return (
    <section className={`rounded-md border p-3 ${tone}`}>
      <div className="flex items-start gap-3">
        <AdapterIcon manifest={manifest} size={28} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{manifest.displayName}</span>
            <AdapterStatusLive kind={manifest.kind} command={command} />
            <AdapterRefreshButton kind={manifest.kind} command={command} />
            {manifest.docsUrl ? (
              <a
                href={manifest.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-auto text-xs text-sky-700 hover:underline dark:text-sky-300"
              >
                {t("agents.docsLink")} ↗
              </a>
            ) : null}
          </div>
          <div className="mt-2">
            <AdapterStatusDetails probe={probe.data?.probe} />
          </div>
        </div>
      </div>
    </section>
  );
}

function AdapterCard({
  manifest,
  selected,
  onSelect,
}: {
  manifest: AdapterManifest;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={
        "text-left rounded-lg border p-3 transition-all " +
        (selected
          ? "border-sky-500 bg-sky-50 ring-2 ring-sky-300 dark:border-sky-600 dark:bg-sky-900/20 dark:ring-sky-700"
          : "border-zinc-200 bg-zinc-50/50 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/50 dark:hover:border-zinc-600")
      }
    >
      <div className="flex items-center gap-3">
        <AdapterIcon manifest={manifest} size={32} />
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{manifest.displayName}</div>
          <div className="text-xs text-zinc-500 mono truncate">
            {manifest.kind} · {manifest.defaultCommand}
          </div>
        </div>
        <AdapterStatusLive kind={manifest.kind} showLabel={false} />
      </div>
      <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2">
        {manifest.description}
      </p>
    </button>
  );
}

/** Binds a single AdapterField to the config dict, applying live model overrides for the `model` field. */
function ConfigFieldBinder({
  field,
  config,
  setConfig,
  manifest,
}: {
  field: AdapterField;
  config: Record<string, unknown>;
  setConfig: (next: Record<string, unknown>) => void;
  manifest: AdapterManifest;
}) {
  const { t } = useI18n();
  const isModelField = field.kind === "select" && field.key === "model";
  const command = config.command as string | undefined;

  const liveModels = useQuery({
    queryKey: ["models", manifest.kind, command ?? ""],
    queryFn: () => api.listAdapterModels(manifest.kind, { command }),
    enabled: isModelField,
    staleTime: 5 * 60_000,
  });

  const optionsOverride: AdapterSelectOption[] | undefined =
    isModelField && liveModels.data?.models.models?.length
      ? liveModels.data.models.models
      : undefined;

  const adornment = isModelField ? (
    <ModelSourceBadge
      source={liveModels.data?.models.source}
      hint={liveModels.data?.models.hint}
      isLoading={liveModels.isLoading}
    />
  ) : undefined;

  return (
    <AdapterFieldInput
      field={field}
      adapterKind={manifest.kind}
      value={config[field.key]}
      onChange={(next) => setConfig({ ...config, [field.key]: next })}
      optionsOverride={optionsOverride}
      labelAdornment={adornment}
    />
  );
  // unused: silence linter for unused t when no live model
  void t;
}

function ModelSourceBadge({
  source,
  hint,
  isLoading,
}: {
  source: "live" | "presets" | "error" | undefined;
  hint?: string;
  isLoading: boolean;
}) {
  const { t } = useI18n();
  if (isLoading) {
    return (
      <span className="text-xs text-zinc-500" title={t("adapter.models.checking")}>
        ⟳ {t("adapter.models.checking")}
      </span>
    );
  }
  if (!source) return null;
  const palette = {
    live: "text-emerald-700 dark:text-emerald-400",
    presets: "text-zinc-500",
    error: "text-amber-700 dark:text-amber-400",
  } as const;
  const label =
    source === "live"
      ? t("adapter.models.live")
      : source === "presets"
        ? t("adapter.models.presets")
        : t("adapter.models.error");
  return (
    <span className={`text-xs ${palette[source]}`} title={hint}>
      {source === "live" ? "● " : source === "error" ? "⚠ " : ""}
      {label}
    </span>
  );
}

function stripUndefined(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === "") continue;
    out[k] = v;
  }
  return out;
}
