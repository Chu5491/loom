// Office 화면 — office/ 파일들을 UI로 편집. 정의의 원천은 파일, 여긴 그 뷰.
// 4섹션: Rules / Skills / Agents / MCP. 모든 변경은 PUT → 파일 저장 → 재조회.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Sparkles, Trash2, Bot, Plug } from "lucide-react";
import type { AdapterKind, AgentSpec, Office } from "@loom/core";
import { api } from "../api/client.js";
import { Badge, Button } from "../components/ui.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

const ADAPTERS: AdapterKind[] = ["claude-code", "antigravity", "codex", "opencode", "devin"];
const inputCls =
  "w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
const areaCls = inputCls + " font-mono text-xs leading-relaxed";

type Section = "rules" | "skills" | "agents" | "mcp";

export function OfficePage() {
  const { t } = useI18n();
  const [section, setSection] = useState<Section>("agents");
  const office = useQuery({ queryKey: ["office"], queryFn: api.getOffice });
  const data = office.data?.office;

  const tabs: { key: Section; icon: React.ReactNode; count: number }[] = [
    { key: "agents", icon: <Bot className="size-4" />, count: data?.agents.length ?? 0 },
    { key: "rules", icon: <FileText className="size-4" />, count: data?.rules.length ?? 0 },
    { key: "skills", icon: <Sparkles className="size-4" />, count: data?.skills.length ?? 0 },
    { key: "mcp", icon: <Plug className="size-4" />, count: data?.mcp.length ?? 0 },
  ];

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight">{t("office.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("office.subtitle")}</p>

      <div className="mt-5 flex flex-wrap gap-1.5">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            type="button"
            onClick={() => setSection(tb.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors",
              section === tb.key
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-muted/60",
            )}
          >
            {tb.icon}
            {t(`office.section.${tb.key}`)}
            <span className="text-xs opacity-60">{tb.count}</span>
          </button>
        ))}
      </div>

      <div className="mt-5">
        {!data ? (
          <p className="text-sm text-muted-foreground">{t("common.checking")}</p>
        ) : section === "rules" ? (
          <RulesSection office={data} />
        ) : section === "skills" ? (
          <SkillsSection office={data} />
        ) : section === "agents" ? (
          <AgentsSection office={data} />
        ) : (
          <McpSection office={data} />
        )}
      </div>
    </main>
  );
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ["office"] });
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-border bg-card p-4">{children}</div>;
}

function SectionHead({ onAdd, label }: { onAdd: () => void; label: string }) {
  return (
    <div className="mb-3 flex justify-end">
      <Button size="sm" onClick={onAdd}>
        <Plus className="size-3.5" />
        {label}
      </Button>
    </div>
  );
}

// ── Rules ────────────────────────────────────────────────────────────────────
function RulesSection({ office }: { office: Office }) {
  const { t } = useI18n();
  const invalidate = useInvalidate();
  const [drafts, setDrafts] = useState<{ name: string; body: string }[]>([]);
  const save = useMutation({
    mutationFn: (r: { name: string; body: string }) => api.putRule(r.name, r.body),
    onSuccess: invalidate,
  });
  const del = useMutation({ mutationFn: api.deleteRule, onSuccess: invalidate });

  const items = [...office.rules.map((r) => ({ ...r, isNew: false })), ...drafts.map((d) => ({ ...d, isNew: true }))];

  return (
    <div className="space-y-3">
      <SectionHead label={t("office.new")} onAdd={() => setDrafts((d) => [...d, { name: "", body: "" }])} />
      {items.length === 0 ? <Empty /> : null}
      {items.map((r, i) => (
        <Card key={r.isNew ? `new-${i}` : r.name}>
          <RowHead
            name={r.name}
            editable={r.isNew}
            onName={(v) => r.isNew && setDrafts((d) => d.map((x, j) => (j === i - office.rules.length ? { ...x, name: v } : x)))}
            onDelete={r.isNew ? undefined : () => confirm(t("office.deleteConfirm", { name: r.name })) && del.mutate(r.name)}
          />
          <textarea
            className={cn(areaCls, "mt-2 min-h-28")}
            defaultValue={r.body}
            id={`rule-${i}`}
            placeholder="# Markdown rule body"
          />
          <SaveRow
            onSave={() => {
              const name = r.name.trim();
              const body = (document.getElementById(`rule-${i}`) as HTMLTextAreaElement).value;
              if (name) save.mutate({ name, body });
            }}
            pending={save.isPending}
          />
        </Card>
      ))}
    </div>
  );
}

// ── Skills ───────────────────────────────────────────────────────────────────
function SkillsSection({ office }: { office: Office }) {
  const { t } = useI18n();
  const invalidate = useInvalidate();
  const [drafts, setDrafts] = useState<{ name: string }[]>([]);
  const save = useMutation({
    mutationFn: (s: { name: string; description: string; body: string }) =>
      api.putSkill(s.name, s.description, s.body),
    onSuccess: invalidate,
  });
  const del = useMutation({ mutationFn: api.deleteSkill, onSuccess: invalidate });

  const items = [
    ...office.skills.map((s) => ({ ...s, isNew: false })),
    ...drafts.map((d) => ({ name: d.name, description: "", body: "", isNew: true })),
  ];

  return (
    <div className="space-y-3">
      <SectionHead label={t("office.new")} onAdd={() => setDrafts((d) => [...d, { name: "" }])} />
      {items.length === 0 ? <Empty /> : null}
      {items.map((s, i) => (
        <Card key={s.isNew ? `new-${i}` : s.name}>
          <RowHead
            name={s.name}
            editable={s.isNew}
            onName={(v) => s.isNew && setDrafts((d) => d.map((x, j) => (j === i - office.skills.length ? { name: v } : x)))}
            onDelete={s.isNew ? undefined : () => confirm(t("office.deleteConfirm", { name: s.name })) && del.mutate(s.name)}
          />
          <input className={cn(inputCls, "mt-2")} defaultValue={s.description} id={`skill-desc-${i}`} placeholder={t("office.skill.desc")} />
          <textarea className={cn(areaCls, "mt-2 min-h-24")} defaultValue={s.body} id={`skill-body-${i}`} placeholder="# Markdown skill body" />
          <SaveRow
            onSave={() => {
              const name = s.name.trim();
              const description = (document.getElementById(`skill-desc-${i}`) as HTMLInputElement).value;
              const body = (document.getElementById(`skill-body-${i}`) as HTMLTextAreaElement).value;
              if (name) save.mutate({ name, description, body });
            }}
            pending={save.isPending}
          />
        </Card>
      ))}
    </div>
  );
}

// ── Agents ───────────────────────────────────────────────────────────────────
function AgentsSection({ office }: { office: Office }) {
  const { t } = useI18n();
  const invalidate = useInvalidate();
  const [drafts, setDrafts] = useState<AgentSpec[]>([]);
  const save = useMutation({
    mutationFn: (a: AgentSpec) => api.putAgent(a.name, a),
    onSuccess: invalidate,
  });
  const del = useMutation({ mutationFn: api.deleteAgent, onSuccess: invalidate });

  const items = [...office.agents, ...drafts];

  return (
    <div className="space-y-3">
      <SectionHead
        label={t("office.new")}
        onAdd={() => setDrafts((d) => [...d, { name: "", adapter: "claude-code" }])}
      />
      {items.length === 0 ? <Empty /> : null}
      {items.map((a, i) => {
        const isNew = i >= office.agents.length;
        return (
          <AgentCard
            key={isNew ? `new-${i}` : a.name}
            agent={a}
            isNew={isNew}
            office={office}
            onSave={(next) => next.name.trim() && save.mutate(next)}
            onDelete={isNew ? undefined : () => confirm(t("office.deleteConfirm", { name: a.name })) && del.mutate(a.name)}
            pending={save.isPending}
          />
        );
      })}
    </div>
  );
}

function AgentCard({
  agent,
  isNew,
  office,
  onSave,
  onDelete,
  pending,
}: {
  agent: AgentSpec;
  isNew: boolean;
  office: Office;
  onSave: (a: AgentSpec) => void;
  onDelete?: () => void;
  pending: boolean;
}) {
  const { t } = useI18n();
  const [a, setA] = useState<AgentSpec>(agent);
  const toggle = (key: "rules" | "skills" | "mcp", name: string) =>
    setA((p) => {
      const set = new Set(p[key] ?? []);
      set.has(name) ? set.delete(name) : set.add(name);
      return { ...p, [key]: [...set] };
    });

  return (
    <Card>
      <RowHead name={a.name} editable={isNew} onName={(v) => setA((p) => ({ ...p, name: v }))} onDelete={onDelete} />
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs text-muted-foreground">
          {t("office.agent.adapter")}
          <select className={cn(inputCls, "mt-1")} value={a.adapter} onChange={(e) => setA((p) => ({ ...p, adapter: e.target.value as AdapterKind }))}>
            {ADAPTERS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          {t("office.agent.model")}
          <input className={cn(inputCls, "mt-1 font-mono")} value={a.model ?? ""} placeholder="claude-fable-5" onChange={(e) => setA((p) => ({ ...p, model: e.target.value || undefined }))} />
        </label>
      </div>
      <label className="mt-2 block text-xs text-muted-foreground">
        {t("office.agent.prompt")}
        <textarea className={cn(areaCls, "mt-1 min-h-20")} value={a.prompt ?? ""} placeholder="You are a backend engineer…" onChange={(e) => setA((p) => ({ ...p, prompt: e.target.value || undefined }))} />
      </label>
      <Chips label={t("office.agent.rules")} all={office.rules.map((r) => r.name)} selected={a.rules ?? []} onToggle={(n) => toggle("rules", n)} />
      <Chips label={t("office.agent.skills")} all={office.skills.map((s) => s.name)} selected={a.skills ?? []} onToggle={(n) => toggle("skills", n)} />
      <Chips label={t("office.agent.mcp")} all={office.mcp.map((m) => m.name)} selected={a.mcp ?? []} onToggle={(n) => toggle("mcp", n)} />
      <SaveRow onSave={() => onSave(a)} pending={pending} />
    </Card>
  );
}

function Chips({ label, all, selected, onToggle }: { label: string; all: string[]; selected: string[]; onToggle: (n: string) => void }) {
  if (all.length === 0) return null;
  return (
    <div className="mt-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {all.map((n) => {
          const on = selected.includes(n);
          return (
            <button
              key={n}
              type="button"
              onClick={() => onToggle(n)}
              className={cn(
                "rounded-md border px-2 py-0.5 text-xs transition-colors",
                on ? "border-primary/50 bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:bg-muted/60",
              )}
            >
              {on ? "✓ " : ""}{n}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── MCP (raw JSON for v1 — 파워유저 친화, 추후 폼) ─────────────────────────────
function McpSection({ office }: { office: Office }) {
  const { t } = useI18n();
  const invalidate = useInvalidate();
  const [text, setText] = useState(() => JSON.stringify(office.mcp, null, 2));
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (servers: Office["mcp"]) => api.putMcp(servers),
    onSuccess: invalidate,
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });

  return (
    <Card>
      <p className="text-xs text-muted-foreground">{t("office.mcp.hint")}</p>
      <textarea
        className={cn(areaCls, "mt-2 min-h-64")}
        value={text}
        onChange={(e) => { setText(e.target.value); setErr(null); }}
      />
      {err ? <p className="mt-1 text-xs text-destructive">{err}</p> : null}
      <SaveRow
        onSave={() => {
          try {
            const parsed = JSON.parse(text);
            if (!Array.isArray(parsed)) throw new Error("Expected a JSON array of servers");
            save.mutate(parsed);
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
          }
        }}
        pending={save.isPending}
      />
    </Card>
  );
}

// ── 공통 작은 조각 ────────────────────────────────────────────────────────────
function RowHead({ name, editable, onName, onDelete }: { name: string; editable: boolean; onName: (v: string) => void; onDelete?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2">
      {editable ? (
        <input
          className={cn(inputCls, "max-w-56 font-mono")}
          value={name}
          autoFocus
          placeholder={t("office.namePlaceholder")}
          onChange={(e) => onName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
        />
      ) : (
        <Badge tone="neutral">{name}</Badge>
      )}
      {onDelete ? (
        <button type="button" onClick={onDelete} className="ml-auto text-muted-foreground hover:text-destructive" aria-label="delete">
          <Trash2 className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

function SaveRow({ onSave, pending }: { onSave: () => void; pending: boolean }) {
  const { t } = useI18n();
  return (
    <div className="mt-2 flex justify-end">
      <Button size="sm" onClick={onSave} disabled={pending}>
        {pending ? t("office.saving") : t("office.save")}
      </Button>
    </div>
  );
}

function Empty() {
  const { t } = useI18n();
  return <p className="py-6 text-center text-sm text-muted-foreground">{t("office.empty")}</p>;
}
