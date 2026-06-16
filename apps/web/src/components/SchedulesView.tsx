// 스케줄 뷰 — 이 프로젝트에서 cron 으로 반복 실행할 에이전트 run 을 관리.
// 정의가 아니라 머신-로컬 기록(data/sqlite) — 프로젝트가 이 머신의 경로라서.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Play, Plus, Sunrise, Trash2, Workflow as WorkflowIcon } from "lucide-react";
import type { Project, Schedule } from "@loom/core";
import { api } from "../api/client.js";
import { AgentAvatar } from "./AgentAvatar.js";
import { Markdown } from "./Markdown.js";
import { Button } from "./ui.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

const PRESETS = [
  { key: "hourly", cron: "0 * * * *" },
  { key: "daily9", cron: "0 9 * * *" },
  { key: "weekly", cron: "0 9 * * 1" },
  { key: "custom", cron: "" },
] as const;

export function SchedulesView({ project }: { project: Project }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const agentsQ = useQuery({ queryKey: ["office"], queryFn: api.getOffice });
  const agents = agentsQ.data?.office.agents ?? [];
  const schedules = useQuery({
    queryKey: ["schedules", project.id],
    queryFn: () => api.listSchedules(project.id),
    refetchInterval: 30_000, // next/last run 갱신
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["schedules", project.id] });

  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const onErr = (e: unknown) => setErr(e instanceof Error ? e.message : String(e));

  const create = useMutation({
    mutationFn: (body: { name: string; agent: string; prompt: string; cron: string; workflow: string | null; feature?: "standup" | null }) =>
      api.createSchedule({ ...body, projectId: project.id }),
    onSuccess: () => { setAdding(false); setErr(null); invalidate(); },
    onError: onErr,
  });
  const toggle = useMutation({
    mutationFn: (s: Schedule) => api.patchSchedule(s.id, { enabled: !s.enabled }),
    onSuccess: invalidate,
    onError: onErr,
  });
  const del = useMutation({ mutationFn: (id: string) => api.deleteSchedule(id), onSuccess: invalidate, onError: onErr });
  const runNow = useMutation({ mutationFn: (id: string) => api.runScheduleNow(id), onSuccess: invalidate, onError: onErr });

  const list = schedules.data?.schedules ?? [];
  const fmt = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString(lang === "ko" ? "ko-KR" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  // 다음 실행까지 상대시간 — "3시간 후" 가 절대시각보다 빨리 읽힌다.
  const rel = (iso: string | null | undefined) => {
    if (!iso) return null;
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return null;
    const rtf = new Intl.RelativeTimeFormat(lang === "ko" ? "ko" : "en", { numeric: "always" });
    const min = Math.round(ms / 60_000);
    if (min < 60) return rtf.format(min, "minute");
    const hr = Math.round(min / 60);
    if (hr < 48) return rtf.format(hr, "hour");
    return rtf.format(Math.round(hr / 24), "day");
  };

  return (
    <div className="min-w-0 flex-1 overflow-y-auto py-4">
      <div className="flex items-center gap-2">
        <CalendarClock className="size-4 text-primary" />
        <h2 className="font-display text-sm font-semibold">{t("sched.title")}</h2>
        <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setAdding((v) => !v)}>
          <Plus className="size-3.5" />
          {t("sched.new")}
        </Button>
      </div>
      {err ? <p className="mt-2 text-xs text-destructive">{err}</p> : null}

      <StandupCard
        project={project}
        agents={agents.map((a) => a.name)}
        hasSchedule={list.some((s) => s.feature === "standup")}
        onSchedule={(agent) =>
          create.mutate({ name: "daily-standup", agent, prompt: "", cron: "0 9 * * *", workflow: null, feature: "standup" })
        }
      />

      {adding ? (
        <ScheduleForm
          agents={agents.map((a) => a.name)}
          workflows={(agentsQ.data?.office.workflows ?? []).map((w) => w.name)}
          pending={create.isPending}
          onSubmit={(body) => create.mutate(body)}
          onCancel={() => setAdding(false)}
        />
      ) : null}

      {list.length === 0 && !adding ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-accent text-white shadow-[var(--shadow-glow)]">
            <CalendarClock className="size-6" />
          </span>
          <h3 className="font-display text-base font-semibold">{t("sched.emptyTitle")}</h3>
          <p className="max-w-sm text-sm text-muted-foreground">{t("sched.emptySub")}</p>
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        {list.map((s) => {
          const adapter = agents.find((a) => a.name === s.agent)?.adapter;
          return (
            <div key={s.id} className={cn("rounded-xl border bg-card p-3.5", s.enabled ? "border-border" : "border-border/50 opacity-60")}>
              <div className="flex items-center gap-2.5">
                {s.feature === "standup" ? (
                  <span className="flex size-[22px] shrink-0 items-center justify-center rounded-md bg-warning/10 text-warning"><Sunrise className="size-3.5" /></span>
                ) : s.workflow ? (
                  <span className="flex size-[22px] shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><WorkflowIcon className="size-3.5" /></span>
                ) : adapter ? (
                  <AgentAvatar adapter={adapter} size={22} className="rounded-md" />
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{s.name}</span>
                    <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{s.cron}</code>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {s.feature === "standup" ? `${t("standup.title")} · @${s.agent}` : `${s.workflow ? `▶ ${s.workflow}` : `@${s.agent}`} · ${s.prompt}`}
                  </span>
                </span>
                {/* enabled 토글 */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={s.enabled}
                  onClick={() => toggle.mutate(s)}
                  className={cn(
                    "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                    s.enabled ? "bg-primary" : "bg-muted",
                  )}
                >
                  <span className={cn("absolute top-0.5 size-4 rounded-full bg-white transition-all", s.enabled ? "left-4.5" : "left-0.5")} />
                </button>
                <button
                  type="button"
                  title={t("sched.runNow")}
                  onClick={() => runNow.mutate(s.id)}
                  className="shrink-0 rounded-md border border-primary/40 p-1.5 text-primary transition-colors hover:bg-primary/10"
                >
                  <Play className="size-3.5" />
                </button>
                <button
                  type="button"
                  title={t("sched.delete")}
                  onClick={() => del.mutate(s.id)}
                  className="shrink-0 p-1.5 text-muted-foreground transition-colors hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <div className="mt-2 flex items-center gap-4 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  {t("sched.next")}: <span className="font-mono">{s.enabled ? fmt(s.nextRunAt) : t("sched.paused")}</span>
                  {s.enabled && rel(s.nextRunAt) ? (
                    <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{rel(s.nextRunAt)}</span>
                  ) : null}
                </span>
                <span>{t("sched.last")}: <span className="font-mono">{fmt(s.lastRunAt)}</span></span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 데일리 스탠드업 — 지난 24h run 기록 + git log 로 에이전트가 쓰는 리포트.
// 수동 생성 버튼 + "매일 9시 자동" 원클릭 스케줄(feature:"standup").
function StandupCard({
  project, agents, hasSchedule, onSchedule,
}: {
  project: Project;
  agents: string[];
  hasSchedule: boolean;
  onSchedule: (agent: string) => void;
}) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [agent, setAgent] = useState("");
  const [open, setOpen] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const standup = useQuery({ queryKey: ["standup", project.id], queryFn: () => api.getStandup(project.id) });
  const gen = useMutation({
    mutationFn: (a: string) => api.runStandup(project.id, a, lang === "ko" ? "ko" : "en"),
    onSuccess: () => { setErr(null); void qc.invalidateQueries({ queryKey: ["standup", project.id] }); },
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });
  const picked = agent || agents[0] || "";
  const latest = standup.data?.standup ?? null;
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(lang === "ko" ? "ko-KR" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="mt-3 rounded-xl border border-warning/30 bg-warning/5 p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <Sunrise className="size-4 text-warning" />
        <span className="text-sm font-semibold">{t("standup.title")}</span>
        {latest ? (
          <span className="text-[10px] text-muted-foreground">{t("standup.last")}: {fmt(latest.generatedAt)} · @{latest.agent}</span>
        ) : null}
        <span className="ml-auto flex items-center gap-1.5">
          <select
            value={picked}
            onChange={(e) => setAgent(e.target.value)}
            className="h-7 rounded-md border border-input bg-background px-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {agents.map((a) => <option key={a} value={a}>@{a}</option>)}
          </select>
          <button
            type="button"
            disabled={!picked || gen.isPending}
            onClick={() => gen.mutate(picked)}
            className="flex h-8 items-center gap-1.5 rounded-md bg-gradient-accent px-3 text-xs font-medium text-white shadow-[var(--shadow-glow-sm)] transition-all hover:opacity-90 disabled:opacity-40 disabled:shadow-none"
          >
            <Sunrise className={cn("size-3.5", gen.isPending && "animate-pulse")} />
            {gen.isPending ? "…" : t("standup.run")}
          </button>
          {!hasSchedule ? (
            <Button size="sm" variant="secondary" disabled={!picked} onClick={() => onSchedule(picked)}>
              <CalendarClock className="size-3.5" />
              {t("standup.schedule")}
            </Button>
          ) : null}
        </span>
      </div>
      {err ? <p className="mt-2 text-xs text-destructive">{err}</p> : null}
      {latest ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-[10px] text-muted-foreground transition-colors hover:text-primary"
          >
            {open ? t("standup.hide") : t("standup.show")}
          </button>
          {open ? (
            <div className="mt-1.5 rounded-lg border border-border/60 bg-card px-3 py-2 text-sm">
              <Markdown>{latest.report}</Markdown>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">{t("standup.empty")}</p>
      )}
    </div>
  );
}

function ScheduleForm({
  agents, workflows, pending, onSubmit, onCancel,
}: {
  agents: string[];
  workflows: string[];
  pending: boolean;
  onSubmit: (body: { name: string; agent: string; prompt: string; cron: string; workflow: string | null }) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  // 대상 — 에이전트 1회 run 또는 워크플로우 시작(prompt 가 {{input}} 이 된다).
  const [target, setTarget] = useState<"agent" | "workflow">("agent");
  const [agent, setAgent] = useState(agents[0] ?? "");
  const [workflow, setWorkflow] = useState(workflows[0] ?? "");
  const [prompt, setPrompt] = useState("");
  const [preset, setPreset] = useState<(typeof PRESETS)[number]["key"]>("daily9");
  const [customCron, setCustomCron] = useState("");
  const cron = preset === "custom" ? customCron : PRESETS.find((p) => p.key === preset)!.cron;
  const inputCls = "rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
  const targetOk = target === "agent" ? !!agent : !!workflow;

  return (
    <div className="mt-3 space-y-2.5 rounded-xl border border-primary/30 bg-card p-4">
      <div className="flex flex-wrap gap-2">
        <input className={cn(inputCls, "min-w-40 flex-1")} placeholder={t("sched.namePh")} value={name} onChange={(e) => setName(e.target.value)} />
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
          {(["agent", "workflow"] as const).map((k) => (
            <button
              key={k}
              type="button"
              disabled={k === "workflow" && workflows.length === 0}
              onClick={() => setTarget(k)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-all disabled:opacity-40",
                target === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`sched.target.${k}`)}
            </button>
          ))}
        </div>
        {target === "agent" ? (
          <select className={cn(inputCls, "h-9")} value={agent} onChange={(e) => setAgent(e.target.value)}>
            {agents.map((a) => <option key={a} value={a}>@{a}</option>)}
          </select>
        ) : (
          <select className={cn(inputCls, "h-9")} value={workflow} onChange={(e) => setWorkflow(e.target.value)}>
            {workflows.map((w) => <option key={w} value={w}>▶ {w}</option>)}
          </select>
        )}
      </div>
      <textarea
        className={cn(inputCls, "min-h-16 w-full")}
        placeholder={target === "agent" ? t("sched.promptPh") : t("sched.inputPh")}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPreset(p.key)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              preset === p.key ? "border-primary/50 bg-primary/15" : "border-border text-muted-foreground hover:bg-muted/60",
            )}
          >
            {t(`sched.preset.${p.key}`)}
          </button>
        ))}
        {preset === "custom" ? (
          <input
            className={cn(inputCls, "w-36 font-mono text-xs")}
            placeholder="*/30 * * * *"
            value={customCron}
            onChange={(e) => setCustomCron(e.target.value)}
          />
        ) : (
          <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{cron}</code>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>{t("common.cancel")}</Button>
        <Button
          size="sm"
          disabled={!name.trim() || !targetOk || !prompt.trim() || !cron.trim() || pending}
          onClick={() =>
            onSubmit({
              name: name.trim(),
              agent: target === "agent" ? agent : "",
              workflow: target === "workflow" ? workflow : null,
              prompt: prompt.trim(),
              cron: cron.trim(),
            })
          }
        >
          {pending ? "…" : t("sched.create")}
        </Button>
      </div>
    </div>
  );
}
