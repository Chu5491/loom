// 스케줄 관리 — cron 으로 도는 run. 프로젝트의 에이전트에 "이 프롬프트를 이
// 주기로" 를 걸고, enable 토글 / 삭제. nextFireAt 은 서버가 계산해 돌려준다.

import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent, ScheduledRun } from "@loom/core";
import { PageScroll } from "../components/PageScroll.js";
import { PageHeader } from "../components/PageHeader.js";
import { Button, Card, Field, Input, Textarea, Badge } from "../components/ui.js";
import { agentColorOf, classesFor } from "../components/agentColor.js";
import { useI18n } from "../context/I18nContext.js";
import { api, type CreateScheduleBody } from "../api/client.js";
import { cn } from "../lib/utils.js";

const CRON_PRESETS: ReadonlyArray<{ key: string; cron: string }> = [
  { key: "schedules.preset.hourly", cron: "0 * * * *" },
  { key: "schedules.preset.daily9", cron: "0 9 * * *" },
  { key: "schedules.preset.weekday9", cron: "0 9 * * 1-5" },
  { key: "schedules.preset.weekly", cron: "0 9 * * 1" },
];

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

interface FormState {
  id: string | null;
  agentId: string;
  name: string;
  prompt: string;
  cron: string;
  timezone: string;
}

const emptyForm = (agentId: string): FormState => ({
  id: null,
  agentId,
  name: "",
  prompt: "",
  cron: "0 9 * * *",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
});

export function SchedulesPage() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState | null>(null);

  const agentsQuery = useQuery({
    queryKey: ["agents", { projectId }],
    queryFn: () => api.listAgents({ projectId }),
    enabled: !!projectId,
  });
  const schedulesQuery = useQuery({
    queryKey: ["schedules"],
    queryFn: () => api.listSchedules(),
  });

  const agents = agentsQuery.data?.agents ?? [];
  const agentById = useMemo(
    () => new Map(agents.map((a) => [a.id, a])),
    [agents],
  );
  const projectAgentIds = useMemo(() => new Set(agents.map((a) => a.id)), [agents]);
  const schedules = (schedulesQuery.data?.schedules ?? []).filter((s) =>
    projectAgentIds.has(s.agentId),
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["schedules"] });
  };

  const save = useMutation({
    mutationFn: (f: FormState) => {
      const body: CreateScheduleBody = {
        agentId: f.agentId,
        name: f.name.trim(),
        prompt: f.prompt.trim(),
        cron: f.cron.trim(),
        timezone: f.timezone.trim() || null,
      };
      return f.id
        ? api.updateSchedule(f.id, {
            name: body.name,
            prompt: body.prompt,
            cron: body.cron,
            timezone: body.timezone,
          })
        : api.createSchedule(body);
    },
    onSuccess: () => {
      invalidate();
      setForm(null);
    },
  });

  const toggle = useMutation({
    mutationFn: (s: ScheduledRun) =>
      api.updateSchedule(s.id, { enabled: !s.enabled }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteSchedule(id),
    onSuccess: invalidate,
  });

  const canSave =
    form &&
    form.agentId &&
    form.name.trim() &&
    form.prompt.trim() &&
    form.cron.trim();

  return (
    <PageScroll className="space-y-4">
      <PageHeader
        title={t("schedules.title")}
        description={t("schedules.subtitle")}
        action={
          <Button
            onClick={() => setForm(emptyForm(agents[0]?.id ?? ""))}
            disabled={agents.length === 0}
          >
            {t("schedules.new")}
          </Button>
        }
      />

      {form ? (
        <ScheduleForm
          form={form}
          agents={agents}
          onChange={setForm}
          onCancel={() => setForm(null)}
          onSave={() => form && save.mutate(form)}
          saving={save.isPending}
          error={save.error?.message ?? null}
          canSave={!!canSave}
        />
      ) : null}

      {schedulesQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : schedules.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            {agents.length === 0 ? t("schedules.noAgents") : t("schedules.empty")}
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {schedules.map((s) => (
            <ScheduleRow
              key={s.id}
              schedule={s}
              agent={agentById.get(s.agentId)}
              onEdit={() =>
                setForm({
                  id: s.id,
                  agentId: s.agentId,
                  name: s.name,
                  prompt: s.prompt,
                  cron: s.cron,
                  timezone: s.timezone ?? "",
                })
              }
              onToggle={() => toggle.mutate(s)}
              onDelete={() => {
                if (confirm(t("schedules.deleteConfirm", { name: s.name }))) {
                  remove.mutate(s.id);
                }
              }}
            />
          ))}
        </div>
      )}
    </PageScroll>
  );
}

function ScheduleForm({
  form,
  agents,
  onChange,
  onCancel,
  onSave,
  saving,
  error,
  canSave,
}: {
  form: FormState;
  agents: Agent[];
  onChange: (f: FormState) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
  canSave: boolean;
}) {
  const { t } = useI18n();
  return (
    <Card className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("schedules.field.agent")}>
          <select
            className={selectClass}
            value={form.agentId}
            disabled={!!form.id}
            onChange={(e) => onChange({ ...form, agentId: e.target.value })}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("schedules.field.name")}>
          <Input
            value={form.name}
            placeholder={t("schedules.field.namePlaceholder")}
            onChange={(e) => onChange({ ...form, name: e.target.value })}
          />
        </Field>
      </div>

      <Field label={t("schedules.field.prompt")} hint={t("schedules.field.promptHint")}>
        <Textarea
          rows={3}
          value={form.prompt}
          onChange={(e) => onChange({ ...form, prompt: e.target.value })}
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("schedules.field.cron")} hint={t("schedules.field.cronHint")}>
          <Input
            value={form.cron}
            className="font-mono"
            onChange={(e) => onChange({ ...form, cron: e.target.value })}
          />
        </Field>
        <Field label={t("schedules.field.timezone")} hint={t("schedules.field.timezoneHint")}>
          <Input
            value={form.timezone}
            className="font-mono"
            placeholder="Asia/Seoul"
            onChange={(e) => onChange({ ...form, timezone: e.target.value })}
          />
        </Field>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {CRON_PRESETS.map((p) => (
          <button
            key={p.cron}
            type="button"
            onClick={() => onChange({ ...form, cron: p.cron })}
            className={cn(
              "rounded-md border px-2 py-1 text-xs transition-colors",
              form.cron === p.cron
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {t(p.key)}
            <span className="ml-1.5 font-mono opacity-60">{p.cron}</span>
          </button>
        ))}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button onClick={onSave} disabled={!canSave || saving}>
          {saving ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </Card>
  );
}

function ScheduleRow({
  schedule,
  agent,
  onEdit,
  onToggle,
  onDelete,
}: {
  schedule: ScheduledRun;
  agent: Agent | undefined;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const cls = agent ? classesFor(agentColorOf(agent)) : null;
  const next = schedule.nextFireAt
    ? new Date(schedule.nextFireAt).toLocaleString()
    : "—";

  return (
    <Card className={cn("flex items-center gap-3", !schedule.enabled && "opacity-60")}>
      <span
        className={cn("size-2.5 shrink-0 rounded-full", cls?.dot ?? "bg-muted")}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{schedule.name}</span>
          <Badge tone={schedule.enabled ? "success" : "neutral"}>
            {schedule.enabled ? t("schedules.on") : t("schedules.off")}
          </Badge>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className={cn("font-medium", cls?.text)}>@{agent?.name ?? "—"}</span>
          <span className="font-mono">{schedule.cron}</span>
          {schedule.timezone ? <span>{schedule.timezone}</span> : null}
          <span>{t("schedules.next", { time: next })}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onToggle}>
          {schedule.enabled ? t("schedules.pause") : t("schedules.resume")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          {t("common.edit")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDelete}>
          {t("common.delete")}
        </Button>
      </div>
    </Card>
  );
}
