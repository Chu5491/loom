// Office 좌측 트리 — 6개 그룹(Agents/Rules/Skills/MCP/Workflows/Functions) + 검색 +
// 크로스레퍼런스. OfficePage 가 렌더하는 사이드바.

import { useMemo, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  FileText,
  Plug,
  Plus,
  Search,
  Sparkles,
  Upload,
  Workflow,
  Wrench,
} from "lucide-react";
import type { Office } from "@loom/core";
import { api } from "../../api/client.js";
import { AgentAvatar } from "../AgentAvatar.js";
import { useI18n } from "../../context/I18nContext.js";
import { useAlert } from "../../context/DialogContext.js";
import { cn } from "../../lib/utils.js";
import type { Kind, Selection } from "./shared.js";
import { firstLine } from "./shared.js";
import { useInvalidate } from "./guards.js";

export function OfficeTree({
  office,
  selection,
  onSelect,
  search,
  setSearch,
  expanded,
  toggleGroup,
}: {
  office: Office;
  selection: Selection;
  onSelect: (s: Selection) => void;
  search: string;
  setSearch: (v: string) => void;
  expanded: Record<Kind, boolean>;
  toggleGroup: (k: Kind) => void;
}) {
  const { t } = useI18n();
  const alert = useAlert();
  const invalidate = useInvalidate();

  // 크로스 레퍼런스 — 어떤 에이전트가 rule/skill/mcp 를 쓰는지(이름→에이전트 목록).
  const usedBy = useMemo(() => {
    const r = new Map<string, string[]>();
    const s = new Map<string, string[]>();
    const m = new Map<string, string[]>();
    for (const a of office.agents) {
      for (const x of a.rules ?? []) r.set(x, [...(r.get(x) ?? []), a.name]);
      for (const x of a.skills ?? []) s.set(x, [...(s.get(x) ?? []), a.name]);
      for (const x of a.mcp ?? []) m.set(x, [...(m.get(x) ?? []), a.name]);
    }
    return { rule: r, skill: s, mcp: m };
  }, [office.agents]);

  // 에이전트 30일 실적.
  const statsQ = useQuery({ queryKey: ["agentStats"], queryFn: () => api.agentStats(30), staleTime: 60_000 });
  const statOf = (name: string) => statsQ.data?.stats.find((x) => x.agent === name);

  const q = search.trim().toLowerCase();
  const match = (...fields: (string | undefined | null)[]) =>
    !q || fields.some((f) => (f ?? "").toLowerCase().includes(q));

  const agents = office.agents.filter((a) => match(a.name, a.label, a.adapter, a.model));
  const rules = office.rules.filter((r) => match(r.name, r.body));
  const skills = office.skills.filter((s) => match(s.name, s.description, s.body));
  const mcps = office.mcp.filter((m) => match(m.name, m.description, m.kind, m.command, m.url));
  const workflows = office.workflows.filter((w) => match(w.name, w.description));
  // 모든 feature 프롬프트가 곧 기능(모델+프롬프트) — 'Functions' 한 섹션으로 끝.
  const functions = office.functions.filter((f) => match(f.name, f.prompt, f.adapter, f.model));

  // 가져오기 (rules/skills 아카이브). 서버 검증 실패(zip-slip·용량·SKILL.md 누락)가
  // 무음이면 "아무 일도 안 일어난" 것처럼 보인다 — alert 로 표면화.
  const onImportError = (e: unknown) => void alert(e instanceof Error ? e.message : String(e));
  const impRules = useMutation({ mutationFn: (f: File) => api.importRulesArchive(f), onSuccess: invalidate, onError: onImportError });
  const impSkills = useMutation({ mutationFn: (f: File) => api.importSkillArchive(f), onSuccess: invalidate, onError: onImportError });

  return (
    <aside className="flex min-h-0 flex-1 flex-col">
      {/* 검색 — aside 상단 고정. 슬림(32px) */}
      <div className="relative shrink-0 pb-1.5">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("office.tree.search")}
          className="w-full rounded-lg border border-border/60 bg-background py-1.5 pl-7 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      {/* 그룹 + Overview 핀 — 내부 스크롤. pt-1 로 첫 항목 active 바 클리핑 방지. */}
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pb-1 pr-1 pt-1">

      {/* Overview 핀 — 슬림 진입점 */}
      <button
        type="button"
        onClick={() => onSelect({ kind: "overview" })}
        className={cn(
          "flex items-center gap-2 rounded-lg border px-2 py-1 text-left text-[11px] font-medium transition-colors",
          selection.kind === "overview"
            ? "border-primary/40 bg-primary/10 text-foreground"
            : "border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground",
        )}
      >
        <span className="flex size-4 items-center justify-center rounded bg-primary/15 text-[10px] text-primary">●</span>
        <span>{t("office.overview.title")}</span>
      </button>

      <TreeGroup
        icon={<Bot className="size-3.5" />}
        label={t("office.section.agents")}
        total={office.agents.length}
        matched={agents.length}
        expanded={expanded.agent}
        onToggle={() => toggleGroup("agent")}
        onAdd={() => onSelect({ kind: "agent-new" })}
      >
        {agents.map((a) => {
          const stat = statOf(a.name);
          return (
            <TreeItem
              key={a.name}
              active={selection.kind === "agent" && selection.name === a.name}
              onClick={() => onSelect({ kind: "agent", name: a.name })}
              avatar={<AgentAvatar adapter={a.adapter} size={18} className="shrink-0 rounded" />}
              label={a.label || a.name}
              sub={`${a.adapter}${a.model ? " · " + a.model : ""}`}
              tail={<AgentStatMini stat={stat} />}
              badges={[
                ...(a.delegate ? [{ tone: "info" as const, text: t("office.agent.card.delegate") }] : []),
                ...(!a.model ? [{ tone: "warn" as const, text: t("office.agent.noModel") }] : []),
              ]}
            />
          );
        })}
      </TreeGroup>

      <TreeGroup
        icon={<FileText className="size-3.5" />}
        label={t("office.section.rules")}
        total={office.rules.length}
        matched={rules.length}
        expanded={expanded.rule}
        onToggle={() => toggleGroup("rule")}
        onAdd={() => onSelect({ kind: "rule-new" })}
        onImport={(f) => impRules.mutate(f)}
      >
        {rules.map((r) => (
          <TreeItem
            key={r.name}
            active={selection.kind === "rule" && selection.name === r.name}
            onClick={() => onSelect({ kind: "rule", name: r.name })}
            avatar={<TreeIcon><FileText className="size-3.5" /></TreeIcon>}
            label={r.name}
            sub={firstLine(r.body)}
            tail={<UsedByDot count={usedBy.rule.get(r.name)?.length ?? 0} />}
          />
        ))}
      </TreeGroup>

      <TreeGroup
        icon={<Sparkles className="size-3.5" />}
        label={t("office.section.skills")}
        total={office.skills.length}
        matched={skills.length}
        expanded={expanded.skill}
        onToggle={() => toggleGroup("skill")}
        onAdd={() => onSelect({ kind: "skill-new" })}
        onImport={(f) => impSkills.mutate(f)}
        onDiscover={() => onSelect({ kind: "skill-discover" })}
      >
        {skills.map((s) => (
          <TreeItem
            key={s.name}
            active={selection.kind === "skill" && selection.name === s.name}
            onClick={() => onSelect({ kind: "skill", name: s.name })}
            avatar={<TreeIcon><Sparkles className="size-3.5" /></TreeIcon>}
            label={s.name}
            sub={s.description || firstLine(s.body)}
            tail={<UsedByDot count={usedBy.skill.get(s.name)?.length ?? 0} />}
          />
        ))}
      </TreeGroup>

      <TreeGroup
        icon={<Plug className="size-3.5" />}
        label={t("office.section.mcp")}
        total={office.mcp.length}
        matched={mcps.length}
        expanded={expanded.mcp}
        onToggle={() => toggleGroup("mcp")}
        onAdd={() => onSelect({ kind: "mcp-new" })}
      >
        {mcps.map((s) => (
          <TreeItem
            key={s.name}
            active={selection.kind === "mcp" && selection.name === s.name}
            onClick={() => onSelect({ kind: "mcp", name: s.name })}
            avatar={<TreeIcon><Plug className="size-3.5" /></TreeIcon>}
            label={s.name}
            sub={s.kind === "stdio" ? s.command || "" : s.url || ""}
            badges={[{ tone: "neutral" as const, text: s.kind }]}
            tail={<UsedByDot count={usedBy.mcp.get(s.name)?.length ?? 0} />}
          />
        ))}
      </TreeGroup>

      <TreeGroup
        icon={<Workflow className="size-3.5" />}
        label={t("office.section.workflows")}
        total={office.workflows.length}
        matched={workflows.length}
        expanded={expanded.workflow}
        onToggle={() => toggleGroup("workflow")}
        onAdd={() => onSelect({ kind: "workflow" })}
      >
        {workflows.map((w) => (
          <TreeItem
            key={w.name}
            active={selection.kind === "workflow" && selection.name === w.name}
            onClick={() => onSelect({ kind: "workflow", name: w.name })}
            avatar={<TreeIcon><Workflow className="size-3.5" /></TreeIcon>}
            label={w.name}
            sub={t("talk.workflow.steps", { n: String(w.nodes.length) })}
          />
        ))}
      </TreeGroup>

      <TreeGroup
        icon={<Wrench className="size-3.5" />}
        label={t("office.section.functions")}
        total={office.functions.length}
        matched={functions.length}
        expanded={expanded.function}
        onToggle={() => toggleGroup("function")}
      >
        {functions.map((f) => (
          <TreeItem
            key={f.name}
            active={selection.kind === "function" && selection.name === f.name}
            onClick={() => onSelect({ kind: "function", name: f.name })}
            avatar={<TreeIcon><Wrench className="size-3.5" /></TreeIcon>}
            label={t(`office.fp.${f.name}`)}
            sub={`${f.adapter}${f.model ? ` · ${f.model}` : ""}`}
          />
        ))}
      </TreeGroup>
      </div>
    </aside>
  );
}

function TreeIcon({ children }: { children: React.ReactNode }) {
  return <span className="flex size-4 shrink-0 items-center justify-center rounded bg-muted/60 text-muted-foreground [&>svg]:size-3">{children}</span>;
}

function TreeGroup({
  icon,
  label,
  total,
  matched,
  expanded,
  onToggle,
  onAdd,
  onImport,
  onDiscover,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  total: number;
  matched: number;
  expanded: boolean;
  onToggle: () => void;
  onAdd?: () => void;
  onImport?: (f: File) => void;
  onDiscover?: () => void;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const hidden = matched < total;
  const items = useMemo(() => {
    if (Array.isArray(children)) return children.filter(Boolean);
    return children ? [children] : [];
  }, [children]);
  const empty = items.length === 0;

  return (
    <div className="rounded-lg border border-border/40 bg-card/40">
      {/* 그룹 헤더 — 24px 컴팩트 */}
      <div className="flex items-center gap-0.5 px-1 py-0.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-center gap-1 rounded px-1 py-0.5 text-left text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          <span className="text-primary [&>svg]:size-3">{icon}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
          <span className="ml-1 rounded-full bg-muted/60 px-1.5 text-[9px] tabular-nums">
            {hidden ? `${matched}/${total}` : total}
          </span>
        </button>
        {onImport ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".md,.zip"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onImport(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              aria-label={t("office.import")}
              title={t("office.import")}
            >
              <Upload className="size-3" />
            </button>
          </>
        ) : null}
        {onDiscover ? (
          <button
            type="button"
            onClick={onDiscover}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
            aria-label={t("office.skill.discover")}
            title={t("office.skill.discover")}
          >
            <Search className="size-3" />
          </button>
        ) : null}
        {onAdd ? (
          <button
            type="button"
            onClick={onAdd}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
            aria-label={t("office.tree.add")}
            title={t("office.tree.add")}
          >
            <Plus className="size-3" />
          </button>
        ) : null}
      </div>
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-0.5 px-1 pb-1">
              {empty ? (
                <span className="px-2 py-1 text-[11px] text-muted-foreground/70">
                  {total === 0 ? t("office.tree.empty") : t("office.tree.noMatch")}
                </span>
              ) : (
                items
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function TreeItem({
  active,
  onClick,
  avatar,
  label,
  sub,
  tail,
  badges,
}: {
  active: boolean;
  onClick: () => void;
  avatar: React.ReactNode;
  label: string;
  sub?: string;
  tail?: React.ReactNode;
  badges?: { tone: "info" | "warn" | "success" | "neutral"; text: string }[];
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors",
        active
          ? "bg-primary/10 text-foreground"
          : "hover:bg-muted/50 text-foreground/90",
      )}
    >
      {active ? (
        <motion.span layoutId="office-tree-active" className="absolute inset-y-0.5 left-0 w-0.5 rounded-r-full bg-primary" />
      ) : null}
      {avatar}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className="truncate text-xs font-medium">{label}</span>
          {(badges ?? []).map((b, i) => (
            <span
              key={i}
              className={cn(
                "shrink-0 rounded px-1 text-[8px] font-medium uppercase tracking-wide tabular-nums",
                b.tone === "info" && "bg-info/10 text-info",
                b.tone === "warn" && "bg-warning/10 text-warning",
                b.tone === "success" && "bg-success/10 text-success",
                b.tone === "neutral" && "bg-muted/70 text-muted-foreground",
              )}
            >
              {b.text}
            </span>
          ))}
        </span>
        {sub ? <span className="block truncate text-[9px] text-muted-foreground">{sub}</span> : null}
      </span>
      {tail ? <span className="shrink-0">{tail}</span> : null}
    </button>
  );
}

// 트리 아이템 우측 — 에이전트 30일 미니 바.
function AgentStatMini({ stat }: { stat?: { runs: number; succeeded: number; failed: number; thumbsUp: number; thumbsDown: number } }) {
  if (!stat || stat.runs === 0) return null;
  const done = stat.succeeded + stat.failed;
  const pct = done > 0 ? Math.round((stat.succeeded / done) * 100) : null;
  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
      {pct !== null ? (
        <span className="h-1 w-6 overflow-hidden rounded-full bg-muted/60">
          <span
            className={cn("block h-full rounded-full", pct >= 80 ? "bg-success" : pct >= 50 ? "bg-warning" : "bg-destructive")}
            style={{ width: `${pct}%` }}
          />
        </span>
      ) : null}
      <span className="font-mono tabular-nums">×{stat.runs}</span>
    </span>
  );
}

// 트리 아이템 우측 — 쓰는 에이전트 개수 점.
function UsedByDot({ count }: { count: number }) {
  const { t } = useI18n();
  if (count === 0) {
    return <span className="size-1.5 rounded-full bg-muted-foreground/20" title={t("office.usedBy.none")} />;
  }
  return (
    <span
      className="rounded-full bg-primary/15 px-1.5 text-[10px] font-medium tabular-nums text-primary"
      title={t("office.usedBy", { n: String(count) })}
    >
      ·{count}
    </span>
  );
}
