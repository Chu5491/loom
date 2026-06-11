// Office 화면 — office/ 파일들을 UI로 편집. 정의의 원천은 파일, 여긴 그 뷰.
// 4섹션: Agents / Rules / Skills / MCP. 모든 변경은 PUT → 파일 저장 → 재조회.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Sparkles, Trash2, Bot, Plug, AlertTriangle, Workflow, ChevronDown } from "lucide-react";
import type { AdapterKind, AgentSpec, HarnessEdge, HarnessTrigger, McpServer, McpServerKind, Office } from "@loom/core";
import { api } from "../api/client.js";
import { AgentAvatar } from "../components/AgentAvatar.js";
import { Markdown } from "../components/Markdown.js";
import { Badge, Button } from "../components/ui.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

const ADAPTERS: AdapterKind[] = ["claude-code", "antigravity", "codex", "opencode", "devin"];
const MCP_UNSUPPORTED: AdapterKind[] = ["antigravity"];

const inputCls =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring";
const areaCls = inputCls + " font-mono text-xs leading-relaxed";

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

// 압축 행 — 헤더만 보이고, 클릭하면 본문이 펼쳐진다(리스트가 길어도 한눈에).
function CollapsibleCard({
  open,
  onToggle,
  avatar,
  title,
  subtitle,
  meta,
  onDelete,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  avatar?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  meta?: React.ReactNode;
  onDelete?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card transition-colors", open ? "border-primary/30" : "border-border")}>
      <div className="flex items-center gap-3 px-3.5 py-2.5">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          {avatar}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate font-display text-sm font-semibold">{title}</span>
              {meta}
            </span>
            {subtitle ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{subtitle}</span> : null}
          </span>
          <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
        {onDelete ? (
          <button type="button" onClick={onDelete} className="shrink-0 text-muted-foreground transition-colors hover:text-destructive" aria-label="delete">
            <Trash2 className="size-4" />
          </button>
        ) : null}
      </div>
      {open ? <div className="border-t border-border p-4">{children}</div> : null}
    </div>
  );
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
  const [open, setOpen] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (a: AgentSpec) => api.putAgent(a.name, a),
    onSuccess: (_d, v) => { invalidate(); setDrafts((d) => d.filter((x) => x.name !== v.name)); },
  });
  const del = useMutation({ mutationFn: api.deleteAgent, onSuccess: invalidate });

  const items = [...office.agents, ...drafts];

  return (
    <div className="space-y-2.5">
      <SectionHead
        label={t("office.new.agent")}
        onAdd={() => { setDrafts((d) => [...d, { name: "", adapter: "claude-code" }]); setOpen(`new-${drafts.length}`); }}
      />
      {items.length === 0 ? <Empty /> : null}
      {items.map((a, i) => {
        const isNew = i >= office.agents.length;
        const key = isNew ? `new-${i - office.agents.length}` : a.name;
        return (
          <AgentCard
            key={key}
            agent={a}
            isNew={isNew}
            office={office}
            open={open === key}
            onToggle={() => setOpen((o) => (o === key ? null : key))}
            onSave={(next) => save.mutate(next)}
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
  open,
  onToggle,
  onSave,
  onDelete,
  pending,
}: {
  agent: AgentSpec;
  isNew: boolean;
  office: Office;
  open: boolean;
  onToggle: () => void;
  onSave: (a: AgentSpec) => void;
  onDelete?: () => void;
  pending: boolean;
}) {
  const { t } = useI18n();
  const [a, setA] = useState<AgentSpec>(agent);
  const [err, setErr] = useState<string | null>(null);
  const toggle = (key: "rules" | "skills" | "mcp", name: string) =>
    setA((p) => {
      const set = new Set(p[key] ?? []);
      set.has(name) ? set.delete(name) : set.add(name);
      return { ...p, [key]: [...set] };
    });
  const setAdapter = (adapter: AdapterKind) =>
    setA((p) => ({ ...p, adapter, ...(MCP_UNSUPPORTED.includes(adapter) ? { mcp: [] } : {}) }));

  const mcpBlocked = MCP_UNSUPPORTED.includes(a.adapter);
  // 이름·모델 필수.
  const submit = () => {
    if (!a.name.trim()) { setErr(t("office.agent.needName")); return; }
    if (!a.model) { setErr(t("office.agent.needModel")); return; }
    setErr(null);
    onSave(a);
  };

  return (
    <CollapsibleCard
      open={open}
      onToggle={onToggle}
      avatar={<AgentAvatar adapter={a.adapter} size={36} />}
      title={a.name || t("office.untitled")}
      meta={
        <>
          <Badge tone="neutral">{a.adapter}</Badge>
          {a.model ? (
            <span className="truncate font-mono text-[11px] text-muted-foreground">{a.model}</span>
          ) : (
            <Badge tone="warn">{t("office.agent.noModel")}</Badge>
          )}
        </>
      }
      onDelete={onDelete}
    >
      {/* 이름 (신규만 — 이름이 식별자) */}
      {isNew ? (
        <div className="mb-4">
          <FieldLabel>{t("office.agent.name")}</FieldLabel>
          <input
            className={cn(inputCls, "max-w-72 font-mono")}
            value={a.name}
            autoFocus
            placeholder={t("office.namePlaceholder")}
            onChange={(e) => setA((p) => ({ ...p, name: e.target.value.replace(/[^a-zA-Z0-9_-]/g, "") }))}
          />
        </div>
      ) : null}

      {/* Identity: 어댑터 + 모델 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

      {err ? <p className="mt-3 text-xs text-destructive">{err}</p> : null}
      <SaveRow onSave={submit} pending={pending} />
    </CollapsibleCard>
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
// 마크다운 본문 편집기 — Edit/Preview 토글. textarea 는 항상 마운트(숨김)돼서
// 기존 저장 로직(getElementById(id).value)이 그대로 동작한다.
function MarkdownField({ id, defaultValue, placeholder, minH = "min-h-32" }: { id: string; defaultValue: string; placeholder?: string; minH?: string }) {
  const { t } = useI18n();
  const [val, setVal] = useState(defaultValue);
  const [mode, setMode] = useState<"edit" | "preview">(defaultValue.trim() ? "preview" : "edit");
  return (
    <div>
      <div className="mb-1.5 inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
        {(["preview", "edit"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "rounded-md px-2.5 py-0.5 text-xs font-medium transition-colors",
              mode === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`office.md.${m}`)}
          </button>
        ))}
      </div>
      <textarea
        id={id}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder={placeholder}
        className={cn(areaCls, minH, mode === "preview" && "hidden")}
      />
      {mode === "preview" ? (
        val.trim() ? (
          <div className="rounded-lg border border-border bg-background px-3.5 py-2.5">
            <Markdown>{val}</Markdown>
          </div>
        ) : (
          <p className="py-2 text-xs text-muted-foreground">{t("office.md.empty")}</p>
        )
      ) : null}
    </div>
  );
}

function firstLine(body: string): string {
  for (const l of body.split(/\r?\n/)) {
    const t = l.replace(/^#+\s*/, "").trim();
    if (t) return t.slice(0, 90);
  }
  return "";
}

function RulesSection({ office }: { office: Office }) {
  const { t } = useI18n();
  const invalidate = useInvalidate();
  const [drafts, setDrafts] = useState<{ name: string; body: string }[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (r: { name: string; body: string }) => api.putRule(r.name, r.body),
    onSuccess: (_d, v) => { invalidate(); setDrafts((d) => d.filter((x) => x.name !== v.name)); },
  });
  const del = useMutation({ mutationFn: api.deleteRule, onSuccess: invalidate });

  const items = [...office.rules.map((r) => ({ ...r, isNew: false })), ...drafts.map((d) => ({ ...d, isNew: true }))];

  return (
    <div className="space-y-2.5">
      <SectionHead label={t("office.new.rule")} onAdd={() => { setDrafts((d) => [...d, { name: "", body: "" }]); setOpen(`new-${drafts.length}`); }} />
      {items.length === 0 ? <Empty /> : null}
      {items.map((r, i) => {
        const di = i - office.rules.length;
        const key = r.isNew ? `new-${di}` : r.name;
        return (
          <CollapsibleCard
            key={key}
            open={open === key}
            onToggle={() => setOpen((o) => (o === key ? null : key))}
            avatar={<span className="flex size-8 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground"><FileText className="size-4" /></span>}
            title={r.name || t("office.untitled")}
            subtitle={r.isNew ? undefined : firstLine(r.body)}
            onDelete={r.isNew ? undefined : () => confirm(t("office.deleteConfirm", { name: r.name })) && del.mutate(r.name)}
          >
            {r.isNew ? (
              <input
                className={cn(inputCls, "mb-2 max-w-72 font-mono")}
                value={r.name}
                autoFocus
                placeholder={t("office.namePlaceholder")}
                onChange={(e) => setDrafts((d) => d.map((x, j) => (j === di ? { ...x, name: e.target.value.replace(/[^a-zA-Z0-9_-]/g, "") } : x)))}
              />
            ) : null}
            <MarkdownField id={`rule-${key}`} defaultValue={r.body} placeholder="# Markdown rule body" minH="min-h-32" />
            <SaveRow
              onSave={() => {
                const name = r.name.trim();
                const body = (document.getElementById(`rule-${key}`) as HTMLTextAreaElement).value;
                if (name) save.mutate({ name, body });
              }}
              pending={save.isPending}
            />
          </CollapsibleCard>
        );
      })}
    </div>
  );
}

// ── Skills ───────────────────────────────────────────────────────────────────
function SkillsSection({ office }: { office: Office }) {
  const { t } = useI18n();
  const invalidate = useInvalidate();
  const [drafts, setDrafts] = useState<{ name: string; files: { path: string; content: string }[] }[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const save = useMutation({
    // 신규 스킬은 본문 저장 후 스테이징된 딸린 파일들을 이어서 기록 — 한 번의 "저장"으로.
    mutationFn: async (s: { name: string; description: string; body: string; files: { path: string; content: string }[] }) => {
      await api.putSkill(s.name, s.description, s.body);
      for (const f of s.files) await api.putSkillFile(s.name, f.path, f.content);
    },
    onSuccess: (_d, v) => { invalidate(); setDrafts((d) => d.filter((x) => x.name !== v.name)); },
  });
  const del = useMutation({ mutationFn: api.deleteSkill, onSuccess: invalidate });

  const items = [
    ...office.skills.map((s) => ({ ...s, isNew: false })),
    ...drafts.map((d) => ({ name: d.name, description: "", body: "", isNew: true })),
  ];

  return (
    <div className="space-y-2.5">
      <SectionHead label={t("office.new.skill")} onAdd={() => { setDrafts((d) => [...d, { name: "", files: [] }]); setOpen(`new-${drafts.length}`); }} />
      {items.length === 0 ? <Empty /> : null}
      {items.map((s, i) => {
        const di = i - office.skills.length;
        const key = s.isNew ? `new-${di}` : s.name;
        return (
          <CollapsibleCard
            key={key}
            open={open === key}
            onToggle={() => setOpen((o) => (o === key ? null : key))}
            avatar={<span className="flex size-8 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground"><Sparkles className="size-4" /></span>}
            title={s.name || t("office.untitled")}
            subtitle={s.isNew ? undefined : s.description || undefined}
            onDelete={s.isNew ? undefined : () => confirm(t("office.deleteConfirm", { name: s.name })) && del.mutate(s.name)}
          >
            {s.isNew ? (
              <input
                className={cn(inputCls, "mb-2 max-w-72 font-mono")}
                value={s.name}
                autoFocus
                placeholder={t("office.namePlaceholder")}
                onChange={(e) => setDrafts((d) => d.map((x, j) => (j === di ? { ...x, name: e.target.value.replace(/[^a-zA-Z0-9_-]/g, "") } : x)))}
              />
            ) : null}
            <input className={cn(inputCls, "mb-2")} defaultValue={s.description} id={`skill-desc-${key}`} placeholder={t("office.skill.desc")} />
            <MarkdownField id={`skill-body-${key}`} defaultValue={s.body} placeholder="# Markdown skill body" minH="min-h-24" />
            {/* 딸린 파일 — 기존 스킬은 API 직결(폴더 자동 승격), 신규는 로컬 스테이징 */}
            <SkillFiles
              ops={
                s.isNew
                  ? {
                      list: (drafts[di]?.files ?? []).map((f) => f.path),
                      read: async (p) => drafts[di]?.files.find((f) => f.path === p)?.content ?? "",
                      write: async (p, content) =>
                        setDrafts((d) => d.map((x, j) =>
                          j === di ? { ...x, files: [...x.files.filter((f) => f.path !== p), { path: p, content }] } : x,
                        )),
                      remove: async (p) =>
                        setDrafts((d) => d.map((x, j) => (j === di ? { ...x, files: x.files.filter((f) => f.path !== p) } : x))),
                    }
                  : {
                      list: (s as { files?: string[] }).files ?? [],
                      read: async (p) => (await api.getSkillFile(s.name, p)).content,
                      write: async (p, content) => { await api.putSkillFile(s.name, p, content); invalidate(); },
                      remove: async (p) => { await api.deleteSkillFile(s.name, p); invalidate(); },
                    }
              }
            />
            <SaveRow
              onSave={() => {
                const name = s.name.trim();
                const description = (document.getElementById(`skill-desc-${key}`) as HTMLInputElement).value;
                const body = (document.getElementById(`skill-body-${key}`) as HTMLTextAreaElement).value;
                if (name) save.mutate({ name, description, body, files: s.isNew ? (drafts[di]?.files ?? []) : [] });
              }}
              pending={save.isPending}
            />
          </CollapsibleCard>
        );
      })}
    </div>
  );
}

// ── 스킬 딸린 파일 편집기 ──────────────────────────────────────────────────────
// 칩 클릭 → 내용 로드해 인라인 편집, "파일 추가" → 경로+내용 입력.
// ops 로 저장소를 추상화 — 기존 스킬은 office API(폴더 자동 승격), 신규 드래프트는
// 로컬 스테이징(스킬 저장 시 한꺼번에 기록). UI 는 양쪽이 완전히 동일.
interface SkillFileOps {
  list: string[];
  read: (path: string) => Promise<string>;
  write: (path: string, content: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
}

function SkillFiles({ ops }: { ops: SkillFileOps }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<string | null>(null); // 파일 경로 or "__new"
  const [pathInput, setPathInput] = useState("");
  const [content, setContent] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run(fn: () => Promise<void>) {
    setPending(true);
    setErr(null);
    try {
      await fn();
      setEditing(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  async function openFile(f: string) {
    setErr(null);
    setPathInput(f);
    try {
      setContent(await ops.read(f));
      setEditing(f);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="mt-3">
      <span className="text-xs font-medium text-muted-foreground">{t("office.skill.files")}</span>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {ops.list.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => void openFile(f)}
            className={cn(
              "rounded-md border px-1.5 py-0.5 font-mono text-[11px] transition-colors",
              editing === f ? "border-primary/50 bg-primary/10 text-foreground" : "border-border bg-muted/40 text-muted-foreground hover:text-foreground",
            )}
          >
            {f}
          </button>
        ))}
        <button
          type="button"
          onClick={() => { setEditing("__new"); setPathInput(""); setContent(""); setErr(null); }}
          className="rounded-md border border-dashed border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
        >
          + {t("office.skill.file.add")}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{t("office.skill.files.hint")}</p>

      {editing ? (
        <div className="mt-2 rounded-lg border border-border bg-background p-3">
          <input
            className={cn(inputCls, "max-w-72 font-mono text-xs")}
            value={pathInput}
            placeholder="reference.md · docs/guide.md"
            readOnly={editing !== "__new"}
            autoFocus={editing === "__new"}
            onChange={(e) => setPathInput(e.target.value.replace(/[^a-zA-Z0-9._/-]/g, ""))}
          />
          <textarea
            className={cn(areaCls, "mt-2 min-h-32")}
            value={content}
            placeholder="# File contents"
            onChange={(e) => setContent(e.target.value)}
          />
          {err ? <p className="mt-1 text-xs text-destructive">{err}</p> : null}
          <div className="mt-2 flex items-center justify-end gap-2">
            {editing !== "__new" ? (
              <button
                type="button"
                onClick={() => confirm(t("office.deleteConfirm", { name: editing })) && void run(() => ops.remove(editing))}
                className="text-xs text-muted-foreground transition-colors hover:text-destructive"
              >
                {t("office.skill.file.delete")}
              </button>
            ) : null}
            <Button size="sm" variant="secondary" onClick={() => { setEditing(null); setErr(null); }}>
              {t("office.skill.file.cancel")}
            </Button>
            <Button size="sm" disabled={!pathInput.trim() || pending} onClick={() => void run(() => ops.write(pathInput.trim(), content))}>
              {pending ? t("office.saving") : t("office.save")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── MCP (폼) ──────────────────────────────────────────────────────────────────
const MCP_KINDS: McpServerKind[] = ["stdio", "http", "sse"];
function emptyServer(): McpServer {
  return { name: "", description: null, kind: "stdio", command: null, args: [], env: {}, url: null, headers: {} };
}
function kvToText(o: Record<string, string>): string {
  return Object.entries(o).map(([k, v]) => `${k}=${v}`).join("\n");
}
function textToKv(s: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const line of s.split(/\r?\n/)) {
    const m = line.match(/^([^=]+)=(.*)$/);
    if (m) o[m[1]!.trim()] = m[2]!;
  }
  return o;
}

function McpSection({ office }: { office: Office }) {
  const { t } = useI18n();
  const invalidate = useInvalidate();
  const [rows, setRows] = useState<McpServer[]>(office.mcp);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (servers: McpServer[]) => api.putMcp(servers),
    onSuccess: invalidate,
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });
  const patch = (i: number, next: Partial<McpServer>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...next } : r)));

  return (
    <div className="space-y-2.5">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => { setRows((rs) => [...rs, emptyServer()]); setOpen(`r${rows.length}`); }}>
          <Plus className="size-3.5" />
          {t("office.mcp.add")}
        </Button>
      </div>
      {rows.length === 0 ? <Empty /> : null}
      {rows.map((s, i) => (
        <CollapsibleCard
          key={i}
          open={open === `r${i}`}
          onToggle={() => setOpen((o) => (o === `r${i}` ? null : `r${i}`))}
          avatar={<span className="flex size-8 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground"><Plug className="size-4" /></span>}
          title={s.name || t("office.untitled")}
          subtitle={s.kind === "stdio" ? s.command || undefined : s.url || undefined}
          meta={<Badge tone="neutral">{s.kind}</Badge>}
          onDelete={() => setRows((rs) => rs.filter((_, j) => j !== i))}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel>{t("office.mcp.field.name")}</FieldLabel>
              <input className={cn(inputCls, "font-mono")} value={s.name} placeholder="my-server"
                onChange={(e) => patch(i, { name: e.target.value.replace(/[^a-zA-Z0-9_-]/g, "") })} />
            </div>
            <div>
              <FieldLabel>{t("office.mcp.field.kind")}</FieldLabel>
              <Segmented value={s.kind} onChange={(v) => patch(i, { kind: v })} options={MCP_KINDS.map((k) => ({ value: k, label: k }))} />
            </div>
          </div>

          {s.kind === "stdio" ? (
            <>
              <div className="mt-4">
                <FieldLabel>{t("office.mcp.field.command")}</FieldLabel>
                <input className={cn(inputCls, "font-mono")} value={s.command ?? ""} placeholder="npx" onChange={(e) => patch(i, { command: e.target.value || null })} />
              </div>
              <div className="mt-4">
                <FieldLabel>{t("office.mcp.field.args")}</FieldLabel>
                <input className={cn(inputCls, "font-mono")} value={s.args.join(" ")} placeholder="-y @scope/server" onChange={(e) => patch(i, { args: e.target.value.split(/\s+/).filter(Boolean) })} />
              </div>
              <div className="mt-4">
                <FieldLabel>{t("office.mcp.field.env")}</FieldLabel>
                <textarea className={cn(areaCls, "min-h-16")} value={kvToText(s.env)} placeholder={"API_KEY=${MY_KEY}"} onChange={(e) => patch(i, { env: textToKv(e.target.value) })} />
              </div>
            </>
          ) : (
            <>
              <div className="mt-4">
                <FieldLabel>{t("office.mcp.field.url")}</FieldLabel>
                <input className={cn(inputCls, "font-mono")} value={s.url ?? ""} placeholder="https://…" onChange={(e) => patch(i, { url: e.target.value || null })} />
              </div>
              <div className="mt-4">
                <FieldLabel>{t("office.mcp.field.headers")}</FieldLabel>
                <textarea className={cn(areaCls, "min-h-16")} value={kvToText(s.headers)} placeholder={"Authorization=Bearer ${TOKEN}"} onChange={(e) => patch(i, { headers: textToKv(e.target.value) })} />
              </div>
            </>
          )}

          <div className="mt-4">
            <FieldLabel>{t("office.mcp.field.description")}</FieldLabel>
            <input className={inputCls} value={s.description ?? ""} onChange={(e) => patch(i, { description: e.target.value || null })} />
          </div>
        </CollapsibleCard>
      ))}

      {err ? <p className="text-xs text-destructive">{err}</p> : null}
      <SaveRow
        onSave={() => {
          if (rows.some((s) => !s.name.trim())) { setErr(t("office.mcp.invalid")); return; }
          setErr(null);
          save.mutate(rows);
        }}
        pending={save.isPending}
      />
    </div>
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
