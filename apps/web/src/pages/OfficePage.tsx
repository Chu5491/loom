// Office 화면 — office/ 파일들을 UI로 편집. 정의의 원천은 파일, 여긴 그 뷰.
// 4섹션: Agents / Rules / Skills / MCP. 모든 변경은 PUT → 파일 저장 → 재조회.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Sparkles, Trash2, Bot, Plug, AlertTriangle, Workflow } from "lucide-react";
import type { AdapterKind, AgentSpec, HarnessEdge, HarnessTrigger, Office } from "@loom/core";
import { api } from "../api/client.js";
import { Badge, Button } from "../components/ui.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

const ADAPTERS: AdapterKind[] = ["claude-code", "antigravity", "codex", "opencode", "devin"];
const MCP_UNSUPPORTED: AdapterKind[] = ["antigravity"];

const inputCls =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring";
const areaCls = inputCls + " font-mono text-xs leading-relaxed";

// 에이전트 아바타 색 — 이름 해시로 안정적으로 배정.
const AVATAR = [
  "from-sky-500/80 to-indigo-500/80",
  "from-emerald-500/80 to-teal-500/80",
  "from-fuchsia-500/80 to-purple-500/80",
  "from-amber-500/80 to-orange-500/80",
  "from-rose-500/80 to-pink-500/80",
  "from-cyan-500/80 to-blue-500/80",
];
function avatarFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR[h % AVATAR.length]!;
}

type Section = "agents" | "rules" | "skills" | "mcp" | "harness";

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
    { key: "harness", icon: <Workflow className="size-4" />, count: data?.edges.length ?? 0 },
  ];

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{t("office.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("office.subtitle")}</p>
      </header>

      <div className="mt-7 grid gap-6 md:grid-cols-[220px_1fr]">
        {/* 사이드 레일 */}
        <nav className="flex gap-1.5 md:flex-col">
          {tabs.map((tb) => (
            <button
              key={tb.key}
              type="button"
              onClick={() => setSection(tb.key)}
              className={cn(
                "group flex flex-1 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm transition-all md:flex-none",
                section === tb.key
                  ? "border-primary/40 bg-primary/10 text-foreground shadow-[var(--shadow-glow-sm)]"
                  : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors",
                  section === tb.key ? "bg-primary/15 text-primary" : "bg-muted/60 text-muted-foreground group-hover:text-foreground",
                )}
              >
                {tb.icon}
              </span>
              <span className="flex-1 font-medium">{t(`office.section.${tb.key}`)}</span>
              <span className="rounded-full bg-muted/70 px-1.5 text-xs tabular-nums text-muted-foreground">{tb.count}</span>
            </button>
          ))}
        </nav>

        {/* 콘텐츠 */}
        <div className="min-w-0">
          <div className="mb-4">
            <h2 className="font-display text-lg font-semibold">{t(`office.section.${section}`)}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{t(`office.section.${section}.desc`)}</p>
          </div>
          {!data ? (
            <p className="text-sm text-muted-foreground">{t("common.checking")}</p>
          ) : section === "rules" ? (
            <RulesSection office={data} />
          ) : section === "skills" ? (
            <SkillsSection office={data} />
          ) : section === "agents" ? (
            <AgentsSection office={data} />
          ) : section === "harness" ? (
            <HarnessSection office={data} />
          ) : (
            <McpSection office={data} />
          )}
        </div>
      </div>
    </main>
  );
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ["office"] });
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">{children}</div>;
}

function SectionHead({ onAdd, label }: { onAdd: () => void; label: string }) {
  return (
    <div className="mb-4 flex justify-end">
      <Button size="sm" onClick={onAdd}>
        <Plus className="size-3.5" />
        {label}
      </Button>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{children}</span>;
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | undefined;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-medium transition-colors",
            value === o.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
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
        label={t("office.new.agent")}
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
  const setAdapter = (adapter: AdapterKind) =>
    setA((p) => ({ ...p, adapter, ...(MCP_UNSUPPORTED.includes(adapter) ? { mcp: [] } : {}) }));

  const mcpBlocked = MCP_UNSUPPORTED.includes(a.adapter);
  const label = (a.name || "?").trim() || "?";

  return (
    <Card>
      {/* 헤더: 아바타 + 이름 + 어댑터 배지 + 삭제 */}
      <div className="flex items-center gap-3">
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br font-display text-base font-semibold text-white shadow-sm", avatarFor(label))}>
          {label.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          {isNew ? (
            <input
              className={cn(inputCls, "max-w-64 font-mono")}
              value={a.name}
              autoFocus
              placeholder={t("office.namePlaceholder")}
              onChange={(e) => setA((p) => ({ ...p, name: e.target.value.replace(/[^a-zA-Z0-9_-]/g, "") }))}
            />
          ) : (
            <div className="flex items-center gap-2">
              <span className="font-display text-base font-semibold">{a.name}</span>
              <Badge tone="neutral">{a.adapter}</Badge>
            </div>
          )}
        </div>
        {onDelete ? (
          <button type="button" onClick={onDelete} className="text-muted-foreground transition-colors hover:text-destructive" aria-label="delete">
            <Trash2 className="size-4" />
          </button>
        ) : null}
      </div>

      {/* Identity: 어댑터 + 모델 */}
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel>{t("office.agent.adapter")}</FieldLabel>
          <select className={inputCls} value={a.adapter} onChange={(e) => setAdapter(e.target.value as AdapterKind)}>
            {ADAPTERS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>
        <div>
          <FieldLabel>{t("office.agent.model")}</FieldLabel>
          <ModelField adapter={a.adapter} value={a.model} onChange={(v) => setA((p) => ({ ...p, model: v }))} />
        </div>
      </div>

      {/* Behavior: 성능 + 권한 */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel>{t("office.agent.reasoning")}</FieldLabel>
          <Segmented
            value={a.reasoning}
            onChange={(v) => setA((p) => ({ ...p, reasoning: v }))}
            options={[
              { value: "low", label: t("office.agent.reasoning.low") },
              { value: "medium", label: t("office.agent.reasoning.medium") },
              { value: "high", label: t("office.agent.reasoning.high") },
            ]}
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground">{t("office.agent.reasoning.hint")}</p>
        </div>
        <div>
          <FieldLabel>{t("office.agent.permission")}</FieldLabel>
          <Segmented
            value={a.permission ?? "default"}
            onChange={(v) => setA((p) => ({ ...p, permission: v === "default" ? undefined : v }))}
            options={[
              { value: "default", label: t("office.agent.permission.default") },
              { value: "acceptEdits", label: t("office.agent.permission.acceptEdits") },
              { value: "bypass", label: t("office.agent.permission.bypass") },
            ]}
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground">{t("office.agent.permission.hint")}</p>
        </div>
      </div>

      {/* 지시 프롬프트 */}
      <div className="mt-4">
        <FieldLabel>{t("office.agent.prompt")}</FieldLabel>
        <textarea
          className={cn(areaCls, "min-h-20")}
          value={a.prompt ?? ""}
          placeholder="You are a backend engineer…"
          onChange={(e) => setA((p) => ({ ...p, prompt: e.target.value || undefined }))}
        />
      </div>

      {/* Context & tools */}
      <div className="mt-5 border-t border-border/60 pt-4">
        <Chips label={t("office.agent.rules")} all={office.rules.map((r) => r.name)} selected={a.rules ?? []} onToggle={(n) => toggle("rules", n)} />
        <Chips label={t("office.agent.skills")} all={office.skills.map((s) => s.name)} selected={a.skills ?? []} onToggle={(n) => toggle("skills", n)} />
        {mcpBlocked ? (
          <div className="mt-3">
            <span className="text-xs font-medium text-muted-foreground">{t("office.agent.mcp")}</span>
            <div className="mt-1.5 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
              <span>{t("office.agent.mcpUnsupported")}</span>
            </div>
          </div>
        ) : (
          <Chips label={t("office.agent.mcp")} all={office.mcp.map((m) => m.name)} selected={a.mcp ?? []} onToggle={(n) => toggle("mcp", n)} />
        )}
      </div>

      <SaveRow onSave={() => onSave(a)} pending={pending} />
    </Card>
  );
}

// 모델 선택 — 어댑터별 라이브/프리셋 목록을 드롭다운으로, custom 은 직접 입력.
function ModelField({ adapter, value, onChange }: { adapter: AdapterKind; value?: string; onChange: (v: string | undefined) => void }) {
  const { t } = useI18n();
  const models = useQuery({
    queryKey: ["models", adapter],
    queryFn: () => api.listAdapterModels(adapter),
    staleTime: 5 * 60_000,
  });
  const list = models.data?.models.models ?? [];
  const known = new Set(list.map((m) => m.value));
  const [custom, setCustom] = useState(!!value && !known.has(value) && list.length > 0);

  const grouped = new Map<string, typeof list>();
  for (const m of list) {
    const g = m.category ?? "";
    if (!grouped.has(g)) grouped.set(g, []);
    grouped.get(g)!.push(m);
  }

  if (custom || (value && !known.has(value) && list.length === 0)) {
    return (
      <div className="flex gap-1.5">
        <input
          className={cn(inputCls, "font-mono")}
          value={value ?? ""}
          placeholder="claude-fable-5"
          onChange={(e) => onChange(e.target.value || undefined)}
        />
        {list.length > 0 ? (
          <button type="button" onClick={() => { setCustom(false); onChange(undefined); }} className="shrink-0 rounded-lg border border-border px-2 text-xs text-muted-foreground hover:bg-muted/60">
            ↩
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <select
      className={cn(inputCls, "font-mono")}
      value={value ?? ""}
      onChange={(e) => {
        if (e.target.value === "__custom") { setCustom(true); return; }
        onChange(e.target.value || undefined);
      }}
    >
      <option value="">{t("office.agent.model.default")}</option>
      {[...grouped.entries()].map(([g, items]) =>
        g ? (
          <optgroup key={g} label={g}>
            {items.map((m) => <option key={m.value} value={m.value}>{m.value}</option>)}
          </optgroup>
        ) : (
          items.map((m) => <option key={m.value} value={m.value}>{m.value}</option>)
        ),
      )}
      <option value="__custom">{t("office.agent.model.custom")}</option>
    </select>
  );
}

function Chips({ label, all, selected, onToggle }: { label: string; all: string[]; selected: string[]; onToggle: (n: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="mt-3 first:mt-0">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {all.length === 0 ? (
          <span className="text-xs text-muted-foreground/70">{t("office.empty")}</span>
        ) : (
          all.map((n) => {
            const on = selected.includes(n);
            return (
              <button
                key={n}
                type="button"
                onClick={() => onToggle(n)}
                className={cn(
                  "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                  on ? "border-primary/50 bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:bg-muted/60",
                )}
              >
                {on ? "✓ " : ""}{n}
              </button>
            );
          })
        )}
      </div>
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
      <SectionHead label={t("office.new.rule")} onAdd={() => setDrafts((d) => [...d, { name: "", body: "" }])} />
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
            className={cn(areaCls, "mt-3 min-h-28")}
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
      <SectionHead label={t("office.new.skill")} onAdd={() => setDrafts((d) => [...d, { name: "" }])} />
      {items.length === 0 ? <Empty /> : null}
      {items.map((s, i) => (
        <Card key={s.isNew ? `new-${i}` : s.name}>
          <RowHead
            name={s.name}
            editable={s.isNew}
            onName={(v) => s.isNew && setDrafts((d) => d.map((x, j) => (j === i - office.skills.length ? { name: v } : x)))}
            onDelete={s.isNew ? undefined : () => confirm(t("office.deleteConfirm", { name: s.name })) && del.mutate(s.name)}
          />
          <input className={cn(inputCls, "mt-3")} defaultValue={s.description} id={`skill-desc-${i}`} placeholder={t("office.skill.desc")} />
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
        className={cn(areaCls, "mt-3 min-h-64")}
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

// ── Harness (에이전트 간 핸드오프 규칙 — 단일 파일 edges.json) ──────────────────
const TRIGGERS: HarnessTrigger[] = ["on_success", "on_fail", "on_changes", "manual"];

function HarnessSection({ office }: { office: Office }) {
  const { t } = useI18n();
  const invalidate = useInvalidate();
  const [rows, setRows] = useState<HarnessEdge[]>(office.edges);
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (edges: HarnessEdge[]) => api.putHarness(edges),
    onSuccess: invalidate,
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });

  const names = office.agents.map((a) => a.name);
  const patch = (i: number, next: Partial<HarnessEdge>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...next } : r)));
  const addEdge = () =>
    setRows((rs) => [
      ...rs,
      { from: names[0] ?? "", to: names[1] ?? names[0] ?? "", trigger: "on_success", mode: "ask" },
    ]);

  if (office.agents.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{t("office.harness.needAgents")}</p>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <HarnessGraph agents={office.agents} edges={rows} />
      </Card>

      <div className="flex justify-end">
        <Button size="sm" onClick={addEdge}>
          <Plus className="size-3.5" />
          {t("office.harness.add")}
        </Button>
      </div>

      {rows.length === 0 ? <Empty /> : null}
      {rows.map((e, i) => (
        <Card key={i}>
          <div className="flex items-center gap-2">
            <select className={cn(inputCls, "max-w-40")} value={e.from} onChange={(ev) => patch(i, { from: ev.target.value })}>
              {names.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span className="text-muted-foreground">→</span>
            <select className={cn(inputCls, "max-w-40")} value={e.to} onChange={(ev) => patch(i, { to: ev.target.value })}>
              {names.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="ml-auto text-muted-foreground hover:text-destructive" aria-label="delete">
              <Trash2 className="size-4" />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel>{t("office.harness.trigger")}</FieldLabel>
              <Segmented
                value={e.trigger}
                onChange={(v) => patch(i, { trigger: v })}
                options={TRIGGERS.map((tr) => ({ value: tr, label: t(`office.harness.trigger.${tr}`) }))}
              />
            </div>
            <div>
              <FieldLabel>{t("office.harness.mode")}</FieldLabel>
              <Segmented
                value={e.mode}
                onChange={(v) => patch(i, { mode: v })}
                options={[
                  { value: "auto", label: t("office.harness.mode.auto") },
                  { value: "ask", label: t("office.harness.mode.ask") },
                ]}
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">{t("office.harness.mode.hint")}</p>
            </div>
          </div>

          <div className="mt-4">
            <FieldLabel>{t("office.harness.prompt")}</FieldLabel>
            <textarea
              className={cn(areaCls, "min-h-16")}
              value={e.prompt ?? ""}
              placeholder={t("office.harness.promptPlaceholder")}
              onChange={(ev) => patch(i, { prompt: ev.target.value || undefined })}
            />
          </div>

          <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={!!e.carryResult} onChange={(ev) => patch(i, { carryResult: ev.target.checked })} />
            {t("office.harness.carry")}
          </label>
        </Card>
      ))}

      {err ? <p className="text-xs text-destructive">{err}</p> : null}
      <SaveRow
        onSave={() => {
          setErr(null);
          const bad = rows.find((e) => !e.from || !e.to || e.from === e.to);
          if (bad) { setErr(t("office.harness.invalid")); return; }
          save.mutate(rows);
        }}
        pending={save.isPending}
      />
    </div>
  );
}

// 에이전트 노드를 원형 배치하고 엣지를 화살표로. auto=실선/violet, ask=점선.
function HarnessGraph({ agents, edges }: { agents: AgentSpec[]; edges: HarnessEdge[] }) {
  const W = 520, H = 260, cx = W / 2, cy = H / 2;
  const r = agents.length <= 1 ? 0 : Math.min(W, H) / 2 - 52;
  const NR = 22;
  const pos = new Map<string, { x: number; y: number }>();
  agents.forEach((a, i) => {
    const ang = (2 * Math.PI * i) / agents.length - Math.PI / 2;
    pos.set(a.name, { x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) });
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 260 }}>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--muted-foreground)" />
        </marker>
      </defs>
      {edges.map((e, i) => {
        const a = pos.get(e.from), b = pos.get(e.to);
        if (!a || !b || e.from === e.to) return null;
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        const sx = a.x + ux * NR, sy = a.y + uy * NR;
        const ex = b.x - ux * (NR + 8), ey = b.y - uy * (NR + 8);
        const mx = (sx + ex) / 2, my = (sy + ey) / 2;
        return (
          <g key={i}>
            <line
              x1={sx} y1={sy} x2={ex} y2={ey}
              stroke={e.mode === "auto" ? "var(--primary)" : "var(--muted-foreground)"}
              strokeWidth={e.mode === "auto" ? 2 : 1.5}
              strokeDasharray={e.mode === "auto" ? undefined : "5 4"}
              markerEnd="url(#arrow)"
              opacity={0.85}
            />
            <text x={mx} y={my - 4} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 9 }}>
              {e.trigger.replace("on_", "")}
            </text>
          </g>
        );
      })}
      {agents.map((a) => {
        const p = pos.get(a.name)!;
        return (
          <g key={a.name}>
            <circle cx={p.x} cy={p.y} r={NR} fill="var(--card)" stroke="var(--primary)" strokeWidth={1.5} opacity={0.95} />
            <text x={p.x} y={p.y + 4} textAnchor="middle" className="fill-foreground font-display" style={{ fontSize: 13, fontWeight: 600 }}>
              {(a.name.charAt(0) || "?").toUpperCase()}
            </text>
            <text x={p.x} y={p.y + NR + 13} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 10 }}>
              {a.label || a.name}
            </text>
          </g>
        );
      })}
    </svg>
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
    <div className="mt-4 flex justify-end">
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
