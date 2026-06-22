// Office 우측 디테일 — 항목 종류별 편집기 + 디스패처(DetailView).
// OfficePage 가 selection 에 따라 DetailView 를 렌더하고, DetailView 가 각 편집기로 분기한다.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Bot,
  ExternalLink,
  FileText,
  Plug,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Workflow,
  Wrench,
} from "lucide-react";
import type { AdapterKind, AgentSpec, FunctionSpec, McpServer, McpServerKind, Office } from "@loom/core";
import { api } from "../../api/client.js";
import { AgentAvatar } from "../AgentAvatar.js";
import { WorkflowEditor } from "../WorkflowEditor.js";
import { Badge, Button } from "../ui.js";
import { useI18n } from "../../context/I18nContext.js";
import { useConfirm } from "../../context/DialogContext.js";
import { cn } from "../../lib/utils.js";
import type { Kind, Selection } from "./shared.js";
import {
  ADAPTERS,
  MCP_UNSUPPORTED,
  inputCls,
  areaCls,
  t_workflows,
  isOfficialSourceWeb,
  formatInstalls,
  emptyServer,
  kvToText,
  textToKv,
} from "./shared.js";
import { useInvalidate, useEditorGuard } from "./guards.js";
import {
  UsedByBar,
  FieldLabel,
  Segmented,
  SaveRow,
  PromptPreview,
  ModelField,
  Chips,
  MarkdownField,
  SkillFiles,
} from "./fields.js";

export function DetailView({
  office,
  selection,
  onSelect,
  registerDirty,
}: {
  office: Office;
  selection: Selection;
  onSelect: (s: Selection) => void;
  registerDirty: (fn: () => boolean) => void;
}) {
  switch (selection.kind) {
    case "overview":
      return <Overview office={office} onSelect={onSelect} />;
    case "agent": {
      const a = office.agents.find((x) => x.name === selection.name);
      if (!a) return <NotFound onBack={() => onSelect({ kind: "overview" })} />;
      return <AgentDetail key={a.name} office={office} agent={a} isNew={false} onSelect={onSelect} registerDirty={registerDirty} />;
    }
    case "agent-new":
      return (
        <AgentDetail
          key="agent-new"
          office={office}
          agent={{ name: "", adapter: "claude-code" }}
          isNew
          onSelect={onSelect}
          registerDirty={registerDirty}
        />
      );
    case "rule": {
      const r = office.rules.find((x) => x.name === selection.name);
      if (!r) return <NotFound onBack={() => onSelect({ kind: "overview" })} />;
      return <RuleDetail key={r.name} office={office} rule={r} isNew={false} onSelect={onSelect} registerDirty={registerDirty} />;
    }
    case "rule-new":
      return <RuleDetail key="rule-new" office={office} rule={{ name: "", body: "" }} isNew onSelect={onSelect} registerDirty={registerDirty} />;
    case "skill": {
      const s = office.skills.find((x) => x.name === selection.name);
      if (!s) return <NotFound onBack={() => onSelect({ kind: "overview" })} />;
      return <SkillDetail key={s.name} office={office} skill={s} isNew={false} onSelect={onSelect} registerDirty={registerDirty} />;
    }
    case "skill-new":
      return (
        <SkillDetail
          key="skill-new"
          office={office}
          skill={{ name: "", description: "", body: "" }}
          isNew
          onSelect={onSelect}
          registerDirty={registerDirty}
        />
      );
    case "skill-discover":
      return <SkillDiscover key="skill-discover" onSelect={onSelect} />;
    case "mcp": {
      const m = office.mcp.find((x) => x.name === selection.name);
      if (!m) return <NotFound onBack={() => onSelect({ kind: "overview" })} />;
      return <McpDetail key={m.name} office={office} server={m} isNew={false} onSelect={onSelect} registerDirty={registerDirty} />;
    }
    case "mcp-new":
      return <McpDetail key="mcp-new" office={office} server={emptyServer()} isNew onSelect={onSelect} registerDirty={registerDirty} />;
    case "workflow":
      return (
        <DetailShell icon={<Workflow className="size-4" />} title={selection.name || t_workflows()}>
          <WorkflowEditor agents={office.agents} initialName={selection.name} registerDirty={registerDirty} />
        </DetailShell>
      );
    case "prompt": {
      const p = office.prompts.find((x) => x.name === selection.name);
      if (!p) return <NotFound onBack={() => onSelect({ kind: "overview" })} />;
      return <PromptDetail key={p.name} prompt={p} registerDirty={registerDirty} />;
    }
    case "function": {
      const f = office.functions.find((x) => x.name === selection.name);
      if (!f) return <NotFound onBack={() => onSelect({ kind: "overview" })} />;
      return <FunctionDetail key={f.name} fn={f} registerDirty={registerDirty} />;
    }
  }
}

function NotFound({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <AlertTriangle className="size-6 text-warning" />
      <p className="text-sm text-muted-foreground">{t("office.detail.empty")}</p>
      <Button size="sm" variant="secondary" onClick={onBack}>
        {t("office.overview.title")}
      </Button>
    </div>
  );
}

function DetailShell({
  icon,
  title,
  subtitle,
  badges,
  actions,
  children,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 컴팩트 헤더 — 한 줄에 아이콘·타이틀·서브·배지·액션 모두 수용. shrink-0 으로 절대 안 줄어듦. */}
      <header className="flex shrink-0 items-center gap-2.5 border-b border-border/40 px-5 py-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&>svg]:size-3.5">
          {icon}
        </span>
        <h2 className="truncate font-display text-sm font-semibold">{title}</h2>
        {subtitle ? <span className="truncate font-mono text-[11px] text-muted-foreground">{subtitle}</span> : null}
        {badges ? <span className="flex shrink-0 flex-wrap items-center gap-1">{badges}</span> : null}
        {actions ? <span className="ml-auto flex shrink-0 items-center gap-1">{actions}</span> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview — 우측 디폴트. 양식 사용 현황 한눈에, 빈 자리 메우는 가이드.
// ─────────────────────────────────────────────────────────────────────────────

function Overview({ office, onSelect }: { office: Office; onSelect: (s: Selection) => void }) {
  const { t } = useI18n();
  const cards: { key: Kind | "workflow"; icon: React.ReactNode; label: string; desc: string; count: number; onAdd?: () => void; onOpenWorkflows?: () => void }[] = [
    { key: "agent", icon: <Bot className="size-5" />, label: t("office.section.agents"), desc: t("office.section.agents.desc"), count: office.agents.length, onAdd: () => onSelect({ kind: "agent-new" }) },
    { key: "rule", icon: <FileText className="size-5" />, label: t("office.section.rules"), desc: t("office.section.rules.desc"), count: office.rules.length, onAdd: () => onSelect({ kind: "rule-new" }) },
    { key: "skill", icon: <Sparkles className="size-5" />, label: t("office.section.skills"), desc: t("office.section.skills.desc"), count: office.skills.length, onAdd: () => onSelect({ kind: "skill-new" }) },
    { key: "mcp", icon: <Plug className="size-5" />, label: t("office.section.mcp"), desc: t("office.section.mcp.desc"), count: office.mcp.length, onAdd: () => onSelect({ kind: "mcp-new" }) },
    { key: "workflow", icon: <Workflow className="size-5" />, label: t("office.section.workflows"), desc: t("office.section.workflows.desc"), count: office.workflows.length, onOpenWorkflows: () => onSelect({ kind: "workflow" }) },
    { key: "prompt", icon: <SlidersHorizontal className="size-5" />, label: t("office.section.prompts"), desc: t("office.section.prompts.desc"), count: office.prompts.length },
  ];
  return (
    <DetailShell
      icon={<Sparkles className="size-5" />}
      title={t("office.overview.title")}
      subtitle={t("office.overview.hint")}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <motion.button
            key={c.key}
            type="button"
            whileHover={{ y: -2 }}
            onClick={() => {
              if (c.onAdd) c.onAdd();
              else if (c.onOpenWorkflows) c.onOpenWorkflows();
            }}
            className="group flex flex-col gap-2 rounded-xl border border-border/60 bg-card/60 p-4 text-left transition-colors hover:border-primary/40 hover:shadow-[var(--shadow-glow-sm)]"
          >
            <span className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">{c.icon}</span>
              <span className="font-display text-sm font-semibold">{c.label}</span>
              <span className="ml-auto rounded-full bg-muted/60 px-2 text-[11px] tabular-nums text-muted-foreground">{c.count}</span>
            </span>
            <span className="text-xs leading-relaxed text-muted-foreground">{c.desc}</span>
            <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary opacity-70 transition-opacity group-hover:opacity-100">
              {c.onOpenWorkflows ? t("office.overview.openWorkflows") : t("office.tree.add")} →
            </span>
          </motion.button>
        ))}
      </div>
    </DetailShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent detail
// ─────────────────────────────────────────────────────────────────────────────

// 프롬프트로 에이전트 초안 생성 — 신규 작성 폼 상단. 결과로 폼을 프리필.
function AgentGenerateBox({ onDraft }: { onDraft: (draft: AgentSpec, warnings: string[]) => void }) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState("");
  const gen = useMutation({
    mutationFn: (p: string) => api.generateAgent(p),
    onSuccess: (r) => onDraft(r.draft, r.warnings),
  });
  return (
    <div className="mb-5 rounded-xl border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        <Sparkles className="size-3.5 text-primary" />
        {t("office.agent.gen.title")}
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{t("office.agent.gen.hint")}</p>
      <textarea
        className={cn(inputCls, "mt-2 min-h-16 resize-y")}
        value={prompt}
        placeholder={t("office.agent.gen.placeholder")}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={!prompt.trim() || gen.isPending}
          onClick={() => gen.mutate(prompt.trim())}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {gen.isPending ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Sparkles className="size-3.5" />}
          {gen.isPending ? t("office.agent.gen.running") : t("office.agent.gen.button")}
        </button>
        {gen.isError ? <span className="text-xs text-destructive">{gen.error instanceof Error ? gen.error.message : String(gen.error)}</span> : null}
      </div>
    </div>
  );
}

function AgentDetail({
  office,
  agent,
  isNew,
  onSelect,
  registerDirty,
}: {
  office: Office;
  agent: AgentSpec;
  isNew: boolean;
  onSelect: (s: Selection) => void;
  registerDirty?: (fn: () => boolean) => void;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const [a, setA] = useState<AgentSpec>(agent);
  const [err, setErr] = useState<string | null>(null);
  const [genWarnings, setGenWarnings] = useState<string[]>([]);
  const { saved, markSaved } = useEditorGuard(registerDirty, JSON.stringify(a), JSON.stringify(agent));

  const save = useMutation({
    mutationFn: (next: AgentSpec) => api.putAgent(next.name, next),
    onSuccess: (_d, v) => {
      markSaved();
      invalidate();
      onSelect({ kind: "agent", name: v.name });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });
  const del = useMutation({
    mutationFn: (name: string) => api.deleteAgent(name),
    onSuccess: () => {
      invalidate();
      onSelect({ kind: "overview" });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });

  const toggle = (key: "rules" | "skills" | "mcp", name: string) =>
    setA((p) => {
      const set = new Set(p[key] ?? []);
      set.has(name) ? set.delete(name) : set.add(name);
      return { ...p, [key]: [...set] };
    });

  const setAdapter = (adapter: AdapterKind) =>
    setA((p) => ({ ...p, adapter, ...(MCP_UNSUPPORTED.includes(adapter) ? { mcp: [] } : {}) }));

  const mcpBlocked = MCP_UNSUPPORTED.includes(a.adapter);

  const submit = () => {
    if (!a.name.trim()) {
      setErr(t("office.agent.needName"));
      return;
    }
    if (!a.model) {
      setErr(t("office.agent.needModel"));
      return;
    }
    setErr(null);
    save.mutate(a);
  };

  return (
    <DetailShell
      icon={<AgentAvatar adapter={a.adapter} size={28} className="rounded-lg" />}
      title={a.label || a.name || t("office.untitled")}
      subtitle={isNew ? t("office.detail.new") : a.name}
      badges={
        <>
          <Badge tone="neutral">{a.adapter}</Badge>
          {a.model ? (
            <span className="truncate font-mono text-[11px] text-muted-foreground">{a.model}</span>
          ) : (
            <Badge tone="warn">{t("office.agent.noModel")}</Badge>
          )}
          {a.delegate ? <Badge tone="info">{t("office.agent.card.delegate")}</Badge> : null}
        </>
      }
      actions={
        !isNew ? (
          <button
            type="button"
            onClick={async () => { if (await confirm({ body: t("office.deleteConfirm", { name: a.name }), tone: "danger", confirmLabel: t("common.delete") })) del.mutate(a.name); }}
            className="rounded-xl p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            aria-label={t("office.delete")}
          >
            <Trash2 className="size-4" />
          </button>
        ) : null
      }
    >
      {/* 프롬프트로 생성 (신규만) — LLM 이 실재 스킬·mcp·어댑터만 골라 폼을 채운다. */}
      {isNew ? <AgentGenerateBox onDraft={(d, warnings) => { setA((p) => ({ ...d, name: p.name || d.name })); setGenWarnings(warnings); }} /> : null}
      {genWarnings.length ? (
        <div className="mb-5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          <p className="font-medium">{t("office.agent.gen.warnings")}</p>
          <ul className="mt-1 list-disc pl-4">{genWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      ) : null}

      {/* 표시 이름(label) — 사람이 보는 이름. 공백·한글 자유, 언제든 수정. 식별자(name)와 분리. */}
      <div className="mb-5">
        <FieldLabel>{t("office.agent.label")}</FieldLabel>
        <input
          className={inputCls}
          value={a.label ?? ""}
          autoFocus={!isNew}
          placeholder={t("office.agent.label.placeholder")}
          onChange={(e) => setA((p) => ({ ...p, label: e.target.value || undefined }))}
        />
        <p className="mt-1.5 text-[11px] text-muted-foreground">{t("office.agent.label.hint")}</p>
      </div>

      {/* 식별자(name) — git 파일명. 신규에만 입력 가능, 이후 고정(참조 깨짐 방지). */}
      <div className="mb-5">
        <FieldLabel>{t("office.agent.name")}</FieldLabel>
        <input
          className={cn(inputCls, "max-w-72 font-mono", !isNew && "text-muted-foreground")}
          value={a.name}
          autoFocus={isNew}
          readOnly={!isNew}
          placeholder={t("office.namePlaceholder")}
          onChange={(e) => setA((p) => ({ ...p, name: e.target.value.replace(/[^a-zA-Z0-9_-]/g, "") }))}
        />
        <p className="mt-1.5 text-[11px] text-muted-foreground">{t("office.agent.name.hint")}</p>
      </div>

      {/* Identity: 어댑터 + 모델 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel>{t("office.agent.adapter")}</FieldLabel>
          <select className={inputCls} value={a.adapter} onChange={(e) => setAdapter(e.target.value as AdapterKind)}>
            {ADAPTERS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
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

      {/* 팀원 위임 */}
      <label className="mt-4 flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={!!a.delegate}
          onChange={(e) => setA((p) => ({ ...p, delegate: e.target.checked || undefined }))}
        />
        <span>
          <span className="font-medium">{t("office.agent.delegate")}</span>
          <span className="block text-[11px] text-muted-foreground">{t("office.agent.delegate.hint")}</span>
        </span>
      </label>

      <div className="mt-6">
        <FieldLabel>{t("office.agent.prompt")}</FieldLabel>
        <textarea
          className={cn(areaCls, "min-h-[300px] resize-y")}
          value={a.prompt ?? ""}
          placeholder={t("office.agent.prompt.ph")}
          onChange={(e) => setA((p) => ({ ...p, prompt: e.target.value || undefined }))}
        />
      </div>

      {/* Context & tools */}
      <div className="mt-5 border-t border-border/40 pt-4">
        <Chips
          label={t("office.agent.rules")}
          all={office.rules.map((r) => r.name)}
          selected={a.rules ?? []}
          onToggle={(n) => toggle("rules", n)}
        />
        <Chips
          label={t("office.agent.skills")}
          all={office.skills.map((s) => s.name)}
          selected={a.skills ?? []}
          onToggle={(n) => toggle("skills", n)}
        />
        {mcpBlocked ? (
          <div className="mt-3">
            <span className="text-xs font-medium text-muted-foreground">{t("office.agent.mcp")}</span>
            <div className="mt-1.5 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
              <span>{t("office.agent.mcpUnsupported")}</span>
            </div>
          </div>
        ) : (
          <Chips
            label={t("office.agent.mcp")}
            all={office.mcp.map((m) => m.name)}
            selected={a.mcp ?? []}
            onToggle={(n) => toggle("mcp", n)}
          />
        )}
      </div>

      <div className="mt-8 border-t border-border/40 pt-5">
        {err ? <p className="mb-3 text-xs text-destructive">{err}</p> : null}
        {!isNew ? <PromptPreview agent={agent.name} /> : null}
        <SaveRow onSave={submit} pending={save.isPending} saved={saved} />
      </div>
    </DetailShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule detail
// ─────────────────────────────────────────────────────────────────────────────

function RuleDetail({
  office,
  rule,
  isNew,
  onSelect,
  registerDirty,
}: {
  office: Office;
  rule: { name: string; body: string };
  isNew: boolean;
  onSelect: (s: Selection) => void;
  registerDirty?: (fn: () => boolean) => void;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const [name, setName] = useState(rule.name);
  const [body, setBody] = useState(rule.body);
  const [err, setErr] = useState<string | null>(null);
  const { saved, markSaved } = useEditorGuard(
    registerDirty,
    JSON.stringify({ name, body }),
    JSON.stringify({ name: rule.name, body: rule.body }),
  );
  const save = useMutation({
    mutationFn: (r: { name: string; body: string }) => api.putRule(r.name, r.body),
    onSuccess: (_d, v) => {
      markSaved();
      invalidate();
      onSelect({ kind: "rule", name: v.name });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });
  const del = useMutation({
    mutationFn: (n: string) => api.deleteRule(n),
    onSuccess: () => {
      invalidate();
      onSelect({ kind: "overview" });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });

  return (
    <DetailShell
      icon={<FileText className="size-5" />}
      title={name || t("office.untitled")}
      subtitle={isNew ? t("office.detail.new") : `rules/${rule.name}.md`}
      actions={
        !isNew ? (
          <button
            type="button"
            onClick={async () => { if (await confirm({ body: t("office.deleteConfirm", { name: rule.name }), tone: "danger", confirmLabel: t("common.delete") })) del.mutate(rule.name); }}
            className="rounded-xl p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            aria-label={t("office.delete")}
          >
            <Trash2 className="size-4" />
          </button>
        ) : null
      }
    >
      {!isNew ? (
        <UsedByBar kind="rule" name={rule.name} office={office} onSelect={onSelect} />
      ) : null}
      {isNew ? (
        <div className="mb-3">
          <FieldLabel>{t("office.agent.name")}</FieldLabel>
          <input
            className={cn(inputCls, "max-w-72 font-mono")}
            autoFocus
            value={name}
            placeholder={t("office.namePlaceholder")}
            onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
          />
        </div>
      ) : null}
      <MarkdownField value={body} onChange={setBody} placeholder="# Markdown rule body" minH="min-h-[400px]" />
      {err ? <p className="mt-3 text-xs text-destructive">{err}</p> : null}
      <SaveRow
        onSave={() => {
          const n = name.trim();
          if (!n) {
            setErr(t("office.needName")); // 무반응 Save 버튼은 죽은 것처럼 보인다
            return;
          }
          setErr(null);
          save.mutate({ name: n, body });
        }}
        pending={save.isPending}
        saved={saved}
      />
    </DetailShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Skill detail
// ─────────────────────────────────────────────────────────────────────────────

// 스킬 생태계(skills.sh) 검색·가져오기 — 설치수·출처를 보여 사용자가 판단(라우팅,
// 주입 아님). 가져오면 LLM 이 loom 스타일로 다듬어 office/skills 에 기록 후 해당 스킬로 이동.
function SkillDiscover({ onSelect }: { onSelect: (s: Selection) => void }) {
  const { t } = useI18n();
  const invalidate = useInvalidate();
  const [query, setQuery] = useState("");
  const find = useMutation({ mutationFn: (q: string) => api.discoverSkills(q) });
  const install = useMutation({
    mutationFn: (pkg: string) => api.installSkill(pkg),
    onSuccess: (r) => {
      invalidate();
      onSelect({ kind: "skill", name: r.skill.name });
    },
  });
  const candidates = find.data?.candidates ?? [];
  return (
    <DetailShell icon={<Search className="size-4" />} title={t("office.skill.discover")} subtitle={t("office.skill.discover.sub")}>
      <form
        className="flex gap-2"
        onSubmit={(e) => { e.preventDefault(); if (query.trim()) find.mutate(query.trim()); }}
      >
        <input
          className={cn(inputCls, "flex-1")}
          value={query}
          autoFocus
          placeholder={t("office.skill.discover.placeholder")}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="submit"
          disabled={!query.trim() || find.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {find.isPending ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Search className="size-3.5" />}
          {t("office.skill.discover.search")}
        </button>
      </form>
      <p className="mt-2 text-[11px] text-muted-foreground">{t("office.skill.discover.hint")}</p>

      {find.isError ? <p className="mt-4 text-sm text-destructive">{find.error instanceof Error ? find.error.message : String(find.error)}</p> : null}
      {install.isError ? <p className="mt-4 text-sm text-destructive">{install.error instanceof Error ? install.error.message : String(install.error)}</p> : null}

      <div className="mt-4 space-y-2">
        {find.isSuccess && candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("office.skill.discover.none")}</p>
        ) : null}
        {candidates.map((c) => (
          <div key={c.pkg} className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/40 p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-mono text-sm">{c.pkg}</span>
                {isOfficialSourceWeb(c.source) ? <Badge tone="success">{t("office.skill.discover.official")}</Badge> : null}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                {c.installs != null ? <span>{formatInstalls(c.installs)} {t("office.skill.discover.installs")}</span> : null}
                {c.url ? <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-foreground hover:underline">skills.sh <ExternalLink className="size-2.5" /></a> : null}
              </div>
            </div>
            <button
              type="button"
              disabled={install.isPending}
              onClick={() => install.mutate(c.pkg)}
              className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
            >
              {install.isPending && install.variables === c.pkg ? t("office.skill.discover.importing") : t("office.skill.discover.import")}
            </button>
          </div>
        ))}
      </div>
    </DetailShell>
  );
}

function SkillDetail({
  office,
  skill,
  isNew,
  onSelect,
  registerDirty,
}: {
  office: Office;
  skill: { name: string; description: string; body: string; files?: string[] };
  isNew: boolean;
  onSelect: (s: Selection) => void;
  registerDirty?: (fn: () => boolean) => void;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const [name, setName] = useState(skill.name);
  const [desc, setDesc] = useState(skill.description);
  const [body, setBody] = useState(skill.body);
  // 신규 스킬은 본문 저장 후 딸린 파일을 이어서 기록 — 로컬 스테이징.
  const [draftFiles, setDraftFiles] = useState<{ path: string; content: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const { saved, markSaved } = useEditorGuard(
    registerDirty,
    JSON.stringify({ name, desc, body, files: draftFiles }),
    JSON.stringify({ name: skill.name, desc: skill.description, body: skill.body, files: [] }),
  );

  const save = useMutation({
    mutationFn: async (s: { name: string; description: string; body: string; files: { path: string; content: string }[] }) => {
      await api.putSkill(s.name, s.description, s.body);
      for (const f of s.files) await api.putSkillFile(s.name, f.path, f.content);
    },
    onSuccess: (_d, v) => {
      markSaved();
      invalidate();
      onSelect({ kind: "skill", name: v.name });
    },
    // 파일 루프 중간 실패면 스킬이 부분 생성된 상태 — 무음이면 알 길이 없다.
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });
  const del = useMutation({
    mutationFn: (n: string) => api.deleteSkill(n),
    onSuccess: () => {
      invalidate();
      onSelect({ kind: "overview" });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });

  return (
    <DetailShell
      icon={<Sparkles className="size-5" />}
      title={name || t("office.untitled")}
      subtitle={isNew ? t("office.detail.new") : `skills/${skill.name}`}
      actions={
        !isNew ? (
          <button
            type="button"
            onClick={async () => { if (await confirm({ body: t("office.deleteConfirm", { name: skill.name }), tone: "danger", confirmLabel: t("common.delete") })) del.mutate(skill.name); }}
            className="rounded-xl p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            aria-label={t("office.delete")}
          >
            <Trash2 className="size-4" />
          </button>
        ) : null
      }
    >
      {!isNew ? <UsedByBar kind="skill" name={skill.name} office={office} onSelect={onSelect} /> : null}
      {isNew ? (
        <div className="mb-3">
          <FieldLabel>{t("office.agent.name")}</FieldLabel>
          <input
            className={cn(inputCls, "max-w-72 font-mono")}
            autoFocus
            value={name}
            placeholder={t("office.namePlaceholder")}
            onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
          />
        </div>
      ) : null}
      <div className="mb-3">
        <FieldLabel>{t("office.skill.desc")}</FieldLabel>
        <input className={inputCls} value={desc} placeholder={t("office.skill.desc")} onChange={(e) => setDesc(e.target.value)} />
      </div>
      <MarkdownField value={body} onChange={setBody} placeholder="# Markdown skill body" minH="min-h-[300px]" />
      <div className="mt-4">
        <SkillFiles
          ops={
            isNew
              ? {
                  list: draftFiles.map((f) => f.path),
                  read: async (p) => draftFiles.find((f) => f.path === p)?.content ?? "",
                  write: async (p, content) =>
                    setDraftFiles((d) => [...d.filter((f) => f.path !== p), { path: p, content }]),
                  remove: async (p) => setDraftFiles((d) => d.filter((f) => f.path !== p)),
                }
              : {
                  list: skill.files ?? [],
                  read: async (p) => (await api.getSkillFile(skill.name, p)).content,
                  write: async (p, content) => {
                    await api.putSkillFile(skill.name, p, content);
                    invalidate();
                  },
                  remove: async (p) => {
                    await api.deleteSkillFile(skill.name, p);
                    invalidate();
                  },
                }
          }
        />
      </div>
      {err ? <p className="mt-3 text-xs text-destructive">{err}</p> : null}
      <SaveRow
        onSave={() => {
          const n = name.trim();
          if (!n) {
            setErr(t("office.needName"));
            return;
          }
          setErr(null);
          save.mutate({ name: n, description: desc, body, files: isNew ? draftFiles : [] });
        }}
        pending={save.isPending}
        saved={saved}
      />
    </DetailShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP detail — 단일 서버 폼. 저장 시 office.mcp 배열에 머지해 putMcp.
// ─────────────────────────────────────────────────────────────────────────────

const MCP_KINDS: McpServerKind[] = ["stdio", "http", "sse"];

function McpDetail({
  office,
  server,
  isNew,
  onSelect,
  registerDirty,
}: {
  office: Office;
  server: McpServer;
  isNew: boolean;
  onSelect: (s: Selection) => void;
  registerDirty?: (fn: () => boolean) => void;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const [s, setS] = useState<McpServer>(server);
  // args/env/headers 는 편집용 raw 문자열을 따로 든다 — 매 키입력마다 parse→재직렬화
  // 라운드트립을 돌리면 개행·후행 공백·미완성 줄이 즉시 지워져 타이핑이 불가능해진다.
  const [argsText, setArgsText] = useState(server.args.join(" "));
  const [envText, setEnvText] = useState(kvToText(server.env));
  const [headersText, setHeadersText] = useState(kvToText(server.headers));
  const [err, setErr] = useState<string | null>(null);
  const patch = (next: Partial<McpServer>) => setS((p) => ({ ...p, ...next }));
  const { saved, markSaved } = useEditorGuard(
    registerDirty,
    JSON.stringify({ ...s, args: argsText.split(/\s+/).filter(Boolean), env: textToKv(envText), headers: textToKv(headersText) }),
    JSON.stringify(server),
  );

  const save = useMutation({
    mutationFn: (servers: McpServer[]) => api.putMcp(servers),
    onSuccess: (_d, _v) => {
      markSaved();
      invalidate();
      onSelect({ kind: "mcp", name: s.name });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });
  const del = useMutation({
    mutationFn: (servers: McpServer[]) => api.putMcp(servers),
    onSuccess: () => {
      invalidate();
      onSelect({ kind: "overview" });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });

  const submit = () => {
    const name = s.name.trim();
    if (!name) {
      setErr(t("office.mcp.invalid"));
      return;
    }
    // 신규 생성은 server.name 이 "" 라 아래 filter 가 아무것도 안 걸러낸다 —
    // 동명 서버가 이미 있으면 servers.json 에 중복 엔트리가 생기므로 거부.
    if (isNew && office.mcp.some((x) => x.name === name)) {
      setErr(t("office.mcp.duplicate"));
      return;
    }
    setErr(null);
    const parsed: McpServer = {
      ...s,
      name,
      args: argsText.split(/\s+/).filter(Boolean),
      env: textToKv(envText),
      headers: textToKv(headersText),
    };
    const others = office.mcp.filter((x) => x.name !== server.name);
    save.mutate([...others, parsed]);
  };

  const remove = async () => {
    if (!(await confirm({ body: t("office.deleteConfirm", { name: server.name }), tone: "danger", confirmLabel: t("common.delete") }))) return;
    del.mutate(office.mcp.filter((x) => x.name !== server.name));
  };

  return (
    <DetailShell
      icon={<Plug className="size-5" />}
      title={s.name || t("office.untitled")}
      subtitle={isNew ? t("office.detail.new") : `mcp/servers.json · ${server.name}`}
      badges={<Badge tone="neutral">{s.kind}</Badge>}
      actions={
        !isNew ? (
          <button
            type="button"
            onClick={remove}
            className="rounded-xl p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            aria-label={t("office.delete")}
          >
            <Trash2 className="size-4" />
          </button>
        ) : null
      }
    >
      {!isNew ? <UsedByBar kind="mcp" name={server.name} office={office} onSelect={onSelect} /> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel>{t("office.mcp.field.name")}</FieldLabel>
          <input
            className={cn(inputCls, "font-mono")}
            value={s.name}
            placeholder="my-server"
            readOnly={!isNew}
            onChange={(e) => patch({ name: e.target.value.replace(/[^a-zA-Z0-9_-]/g, "") })}
          />
        </div>
        <div>
          <FieldLabel>{t("office.mcp.field.kind")}</FieldLabel>
          <Segmented value={s.kind} onChange={(v) => patch({ kind: v })} options={MCP_KINDS.map((k) => ({ value: k, label: k }))} />
        </div>
      </div>

      {s.kind === "stdio" ? (
        <>
          <div className="mt-4">
            <FieldLabel>{t("office.mcp.field.command")}</FieldLabel>
            <input
              className={cn(inputCls, "font-mono")}
              value={s.command ?? ""}
              placeholder="npx"
              onChange={(e) => patch({ command: e.target.value || null })}
            />
          </div>
          <div className="mt-4">
            <FieldLabel>{t("office.mcp.field.args")}</FieldLabel>
            <input
              className={cn(inputCls, "font-mono")}
              value={argsText}
              placeholder="-y @scope/server"
              onChange={(e) => setArgsText(e.target.value)}
            />
          </div>
          <div className="mt-4">
            <FieldLabel>{t("office.mcp.field.env")}</FieldLabel>
            <textarea
              className={cn(areaCls, "min-h-16")}
              value={envText}
              placeholder={"API_KEY=${MY_KEY}"}
              onChange={(e) => setEnvText(e.target.value)}
            />
          </div>
        </>
      ) : (
        <>
          <div className="mt-4">
            <FieldLabel>{t("office.mcp.field.url")}</FieldLabel>
            <input
              className={cn(inputCls, "font-mono")}
              value={s.url ?? ""}
              placeholder="https://…"
              onChange={(e) => patch({ url: e.target.value || null })}
            />
          </div>
          <div className="mt-4">
            <FieldLabel>{t("office.mcp.field.headers")}</FieldLabel>
            <textarea
              className={cn(areaCls, "min-h-16")}
              value={headersText}
              placeholder={"Authorization=Bearer ${TOKEN}"}
              onChange={(e) => setHeadersText(e.target.value)}
            />
          </div>
        </>
      )}

      <div className="mt-4">
        <FieldLabel>{t("office.mcp.field.description")}</FieldLabel>
        <input className={inputCls} value={s.description ?? ""} onChange={(e) => patch({ description: e.target.value || null })} />
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-lg border border-border/40 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
        <span>{t("office.mcp.hint")}</span>
      </div>

      {err ? <p className="mt-3 text-xs text-destructive">{err}</p> : null}
      <SaveRow onSave={submit} pending={save.isPending} saved={saved} />
    </DetailShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt detail
// ─────────────────────────────────────────────────────────────────────────────

function PromptDetail({
  prompt,
  registerDirty,
}: {
  prompt: { name: string; body: string };
  registerDirty?: (fn: () => boolean) => void;
}) {
  const { t } = useI18n();
  const invalidate = useInvalidate();
  const [body, setBody] = useState(prompt.body);
  const [err, setErr] = useState<string | null>(null);
  const { saved, markSaved } = useEditorGuard(registerDirty, body, prompt.body);
  const save = useMutation({
    mutationFn: () => api.putFeaturePrompt(prompt.name, body),
    onSuccess: () => {
      setErr(null);
      markSaved();
      invalidate();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });
  return (
    <DetailShell
      icon={<SlidersHorizontal className="size-5" />}
      title={t(`office.fp.${prompt.name}`)}
      subtitle={prompt.name}
    >
      <p className="mb-3 text-xs text-muted-foreground">{t("office.fp.hint")}</p>
      <MarkdownField value={body} onChange={setBody} placeholder="…" minH="min-h-[400px]" />
      {err ? <p className="mt-3 text-xs text-destructive">{err}</p> : null}
      <SaveRow onSave={() => save.mutate()} pending={save.isPending} saved={saved} />
    </DetailShell>
  );
}

// 기능(Function) 편집 — 지침(prompt) + 어댑터 + 모델. 에이전트가 아니라 '쓰는 기능'.
function FunctionDetail({
  fn,
  registerDirty,
}: {
  fn: FunctionSpec;
  registerDirty?: (fn: () => boolean) => void;
}) {
  const { t } = useI18n();
  const invalidate = useInvalidate();
  const [adapter, setAdapter] = useState<AdapterKind>(fn.adapter);
  const [model, setModel] = useState<string | undefined>(fn.model);
  const [body, setBody] = useState(fn.prompt);
  const [err, setErr] = useState<string | null>(null);
  const snapshot = `${adapter} ${model ?? ""} ${body}`;
  const initial = `${fn.adapter} ${fn.model ?? ""} ${fn.prompt}`;
  const { saved, markSaved } = useEditorGuard(registerDirty, snapshot, initial);
  const save = useMutation({
    mutationFn: () => api.putFunction(fn.name, { prompt: body, adapter, model }),
    onSuccess: () => { setErr(null); markSaved(); invalidate(); },
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });
  return (
    <DetailShell
      icon={<Wrench className="size-5" />}
      title={t(`office.fp.${fn.name}`)}
      subtitle={fn.name}
    >
      <p className="mb-3 text-xs text-muted-foreground">{t("office.fn.hint")}</p>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">{t("office.agent.adapter")}</span>
          <select
            className={inputCls}
            value={adapter}
            onChange={(e) => { setAdapter(e.target.value as AdapterKind); setModel(undefined); }}
          >
            {ADAPTERS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">{t("office.agent.model")}</span>
          <ModelField adapter={adapter} value={model} onChange={setModel} />
        </label>
      </div>
      <MarkdownField value={body} onChange={setBody} placeholder="…" minH="min-h-[320px]" />
      {err ? <p className="mt-3 text-xs text-destructive">{err}</p> : null}
      <SaveRow onSave={() => save.mutate()} pending={save.isPending} saved={saved} />
    </DetailShell>
  );
}
