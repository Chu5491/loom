// 에이전트 생성/편집 폼. 어댑터 카드 그리드 → 정체성/자율성/프롬프트/스킬/설정 5개 섹션.
// 섹션별 등장 애니메이션은 motion으로.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import type { AdapterManifest, Agent, Project } from "@loom/core";
import { api, type CreateAgentBody } from "../../api/client.js";
import { Button, Card, Field, Input, Textarea } from "../../components/ui.js";
import { AdapterTestButton } from "../../components/AdapterTest.js";
import { useConfirm } from "../../components/ConfirmDialog.js";
import { useI18n } from "../../context/I18nContext.js";
import {
  type AgentColor,
  agentColorOf,
  isAgentColor,
} from "../../components/agentColor.js";
import { AdapterCard } from "./AdapterCard.js";
import { AutonomySlider } from "./Autonomy.js";
import { ColorPicker } from "./ColorPicker.js";
import { ConfigFieldBinder } from "./ConfigFieldBinder.js";
import { SelectedAdapterPanel } from "./SelectedAdapterPanel.js";
import {
  ROLE_OPTIONS,
  readAutonomy,
  stripUndefined,
  type Autonomy,
  type FormMode,
} from "./types.js";

const sectionVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
};

export function AgentForm({
  state,
  manifests,
  loadingManifests,
  projects,
  defaultProjectId,
  onSubmit,
  submitting,
  onCancel,
}: {
  state: FormMode;
  manifests: AdapterManifest[];
  loadingManifests: boolean;
  projects: Project[];
  defaultProjectId?: string;
  onSubmit: (body: CreateAgentBody) => void;
  submitting: boolean;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const isEdit = state.mode === "edit";
  const editingAgent: Agent | null = isEdit ? state.agent : null;

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
  const [autonomy, setAutonomy] = useState<Autonomy>(
    readAutonomy(editingAgent?.adapterConfig),
  );
  const [color, setColor] = useState<AgentColor | null>(() => {
    const stored = editingAgent?.adapterConfig?.color;
    return isAgentColor(stored) ? stored : null;
  });
  const [showAdvanced, setShowAdvanced] = useState(isEdit);

  const skills = useQuery({
    queryKey: ["specs"],
    queryFn: () => api.listSpecs(),
  });

  const toggleSkill = (id: string) => {
    setSkillIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const selectedManifest = useMemo(
    () => manifests.find((m) => m.kind === adapterKind) ?? null,
    [manifests, adapterKind],
  );

  // CREATE 모드에서 어댑터 변경 시 config + name을 default로 시드. EDIT 모드는 절대 덮어쓰지 않음.
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
      adapterConfig: stripUndefined({
        ...config,
        autonomy,
        color: color ?? undefined,
      }),
    });
  };

  return (
    <Card className="space-y-6">
      <h2 className="font-medium">
        {isEdit ? t("agents.edit") : t("agents.new")}
      </h2>

      <motion.section
        initial="hidden"
        animate="visible"
        variants={sectionVariants}
        transition={{ duration: 0.18 }}
        className="space-y-3"
      >
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {t("agents.section.adapter")}
        </div>
        {loadingManifests ? (
          <p className="text-muted-foreground text-sm">{t("common.loading")}</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {manifests.map((m) => (
              <AdapterCard
                key={m.kind}
                manifest={m}
                selected={adapterKind === m.kind}
                onSelect={async () => {
                  if (isEdit && m.kind !== editingAgent!.adapterKind) {
                    const ok = await confirm({
                      title: t("agents.confirm.switchAdapter"),
                      destructive: true,
                    });
                    if (!ok) return;
                    setConfig({ ...m.defaultConfig });
                  }
                  setAdapterKind(m.kind);
                }}
              />
            ))}
          </div>
        )}
      </motion.section>

      {selectedManifest ? (
        <motion.div
          initial="hidden"
          animate="visible"
          variants={sectionVariants}
          transition={{ duration: 0.22, delay: 0.05 }}
          className="space-y-6"
        >
          <SelectedAdapterPanel
            manifest={selectedManifest}
            command={config.command as string | undefined}
          />

          <section className="space-y-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
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
                  <option value="">{t("agents.role.none")}</option>
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {t(`agents.role.${r}`)}
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
              <Field
                label={t("agents.field.color")}
                hint={t("agents.field.colorHint")}
              >
                <ColorPicker
                  value={color}
                  fallback={
                    editingAgent ? agentColorOf(editingAgent) : "sky"
                  }
                  onChange={setColor}
                />
              </Field>
            </div>
          </section>

          <section className="space-y-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("agents.section.autonomy")}
            </div>
            <AutonomySlider value={autonomy} onChange={setAutonomy} />
          </section>

          <section className="space-y-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
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
                <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
              ) : (skills.data?.specs ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">
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
                            ? "bg-muted/60"
                            : "hover:bg-zinc-100 dark:hover:bg-zinc-800/40")
                        }
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSkill(s.id)}
                        />
                        <span className="flex-1 truncate">{s.name}</span>
                        <span className="text-xs text-muted-foreground mono">
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
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
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
            <div className="pt-3 border-t border-border">
              <AdapterTestButton
                kind={selectedManifest.kind}
                config={stripUndefined(config)}
                cwd={defaultCwd || undefined}
              />
            </div>
            {fieldsAdvanced.length > 0 ? (
              <div className="border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((s) => !s)}
                  className="text-sm text-muted-foreground hover:text-zinc-900 dark:text-muted-foreground/80 dark:hover:text-zinc-100"
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
        </motion.div>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
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
