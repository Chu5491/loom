// Office 화면 — IDE 스타일. 좌측 트리(검색 + 그룹) + 우측 디테일 편집기.
// office/ 파일이 진실의 원천. 여긴 그 뷰 + 안전한 편집기.
//
// 트리는 6개 그룹(Agents/Rules/Skills/MCP/Workflows/Prompts)을 한눈에 보여주고,
// 각 항목 옆에 "쓰는 에이전트 N" 같은 크로스레퍼런스를 표시한다. 검색은 모든 그룹에
// 적용된다. 편집은 우측 패널에서 — 항목을 바꾸면 패널이 그 항목으로 스왑된다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  FileText,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  Workflow,
} from "lucide-react";
import type { AdapterKind, AgentSpec, McpServer, McpServerKind, Office } from "@loom/core";
import { api } from "../api/client.js";
import { AgentAvatar } from "../components/AgentAvatar.js";
import { Markdown } from "../components/Markdown.js";
import { WorkflowEditor } from "../components/WorkflowEditor.js";
import { Badge, Button, PageShell, Panel } from "../components/ui.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

const ADAPTERS: AdapterKind[] = ["claude-code", "antigravity", "codex", "opencode", "devin"];
const MCP_UNSUPPORTED: AdapterKind[] = ["antigravity"];

const inputCls =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring";
const areaCls = inputCls + " font-mono text-xs leading-relaxed";

type Kind = "agent" | "rule" | "skill" | "mcp" | "workflow" | "prompt";

type Selection =
  | { kind: "overview" }
  | { kind: "agent"; name: string }
  | { kind: "agent-new" }
  | { kind: "rule"; name: string }
  | { kind: "rule-new" }
  | { kind: "skill"; name: string }
  | { kind: "skill-new" }
  | { kind: "skill-discover" }
  | { kind: "mcp"; name: string }
  | { kind: "mcp-new" }
  | { kind: "workflow"; name?: string }
  | { kind: "prompt"; name: string };

// ─────────────────────────────────────────────────────────────────────────────
// Entry
// ─────────────────────────────────────────────────────────────────────────────

export function OfficePage() {
  const { t } = useI18n();
  const office = useQuery({ queryKey: ["office"], queryFn: api.getOffice });
  const data = office.data?.office;
  const [selection, setSelection] = useState<Selection>({ kind: "overview" });
  // 미저장 draft 가드 — 활성 디테일이 dirty 체크 함수를 등록하고, 트리에서 다른
  // 항목으로 전환할 때 확인을 거친다(디테일은 전부 로컬 draft 라 전환 = 소실).
  const dirtyCheck = useRef<() => boolean>(() => false);
  const registerDirty = useCallback((fn: () => boolean) => {
    dirtyCheck.current = fn;
  }, []);
  const guardedSelect = useCallback(
    (s: Selection) => {
      if (dirtyCheck.current() && !confirm(t("office.unsavedConfirm"))) return;
      dirtyCheck.current = () => false;
      setSelection(s);
    },
    [t],
  );
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyCheck.current()) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<Kind, boolean>>({
    agent: true,
    rule: true,
    skill: true,
    mcp: true,
    workflow: true,
    prompt: true,
  });
  const toggleGroup = (k: Kind) => setExpanded((s) => ({ ...s, [k]: !s[k] }));
  // 사이드바 열기/닫기 — 디테일에 집중하고 싶을 때. localStorage 영속.
  const [treeOpen, setTreeOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("loom.office.tree") !== "0";
  });
  const toggleTree = () => {
    setTreeOpen((v) => {
      const next = !v;
      try { window.localStorage.setItem("loom.office.tree", next ? "1" : "0"); } catch {}
      return next;
    });
  };

  // 사이드바 너비 — 드래그로 조절(200~480), localStorage 영속.
  const [treeWidth, setTreeWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 320;
    const v = parseInt(window.localStorage.getItem("loom.office.tree.w") ?? "", 10);
    return Number.isFinite(v) ? Math.max(220, Math.min(480, v)) : 320;
  });
  const widthRef = useRef(treeWidth);
  widthRef.current = treeWidth;
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widthRef.current;
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(220, Math.min(480, startW + (ev.clientX - startX)));
      setTreeWidth(next);
    };
    const onUp = () => {
      try { window.localStorage.setItem("loom.office.tree.w", String(widthRef.current)); } catch {}
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <PageShell
      title={t("office.title")}
      subtitle={t("office.subtitle")}
      scrollable={false}
      actions={
        <button
          type="button"
          onClick={toggleTree}
          aria-label={treeOpen ? t("office.tree.close") : t("office.tree.open")}
          title={treeOpen ? t("office.tree.close") : t("office.tree.open")}
          className="flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          {treeOpen ? <PanelLeftClose className="size-3.5" /> : <PanelLeftOpen className="size-3.5" />}
          <span className="hidden sm:inline">{treeOpen ? t("office.tree.close") : t("office.tree.open")}</span>
        </button>
      }
    >
      {/* IDE 풀하이트 — 3컬럼(트리 / 핸들 / 디테일). 핸들 컬럼이 시각적 간격. */}
      <div
        className="grid min-h-0 flex-1"
        style={{
          gridTemplateColumns: treeOpen ? `${treeWidth}px 12px 1fr` : "0px 0px 1fr",
        }}
      >
        {data && treeOpen ? (
          <OfficeTree
            office={data}
            selection={selection}
            onSelect={guardedSelect}
            search={search}
            setSearch={setSearch}
            expanded={expanded}
            toggleGroup={toggleGroup}
          />
        ) : (
          <aside className="overflow-hidden" />
        )}
        {/* 드래그 핸들 — 12px 폭 그립 영역, 1px 라인 중앙 + 호버 강조 */}
        {treeOpen ? (
          <div
            onMouseDown={startResize}
            className="group hidden cursor-col-resize items-stretch justify-center lg:flex"
            aria-label={t("office.tree.resize")}
            title={t("office.tree.resize")}
          >
            <span className="w-px self-stretch bg-border/40 transition-colors group-hover:bg-primary/60" />
          </div>
        ) : (
          <div />
        )}
        <Panel className="min-h-0" noPad>
          {!data ? (
            <p className="p-6 text-sm text-muted-foreground">{t("common.checking")}</p>
          ) : (
            <DetailView office={data} selection={selection} onSelect={setSelection} registerDirty={registerDirty} />
          )}
        </Panel>
      </div>
    </PageShell>
  );
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ["office"] });
}

/** 미저장 가드 등록 — 매 렌더 최신 클로저로 갱신, 언마운트 시 해제(스테일 체커 방지). */
function useDirtyGuard(register: ((fn: () => boolean) => void) | undefined, isDirty: () => boolean) {
  useEffect(() => {
    register?.(isDirty);
  });
  useEffect(() => () => register?.(() => false), [register]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Left: tree
// ─────────────────────────────────────────────────────────────────────────────

function OfficeTree({
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
  const prompts = office.prompts.filter((p) => match(p.name, p.body));

  // 가져오기 (rules/skills 아카이브). 서버 검증 실패(zip-slip·용량·SKILL.md 누락)가
  // 무음이면 "아무 일도 안 일어난" 것처럼 보인다 — alert 로 표면화.
  const onImportError = (e: unknown) => alert(e instanceof Error ? e.message : String(e));
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
                ...(a.roles ?? []).map((r) => ({ tone: "success" as const, text: r })),
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
        icon={<SlidersHorizontal className="size-3.5" />}
        label={t("office.section.prompts")}
        total={office.prompts.length}
        matched={prompts.length}
        expanded={expanded.prompt}
        onToggle={() => toggleGroup("prompt")}
      >
        {prompts.map((p) => (
          <TreeItem
            key={p.name}
            active={selection.kind === "prompt" && selection.name === p.name}
            onClick={() => onSelect({ kind: "prompt", name: p.name })}
            avatar={<TreeIcon><SlidersHorizontal className="size-3.5" /></TreeIcon>}
            label={t(`office.fp.${p.name}`)}
            sub={p.name}
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

// ─────────────────────────────────────────────────────────────────────────────
// Right: detail dispatcher
// ─────────────────────────────────────────────────────────────────────────────

function DetailView({
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
  }
}

function t_workflows() {
  // 짧은 헬퍼 — switch 내부에서 hook 을 호출할 수 없어서 분리.
  // (workflow.name 이 있으면 그 이름을 쓰므로 여긴 fallback 일 뿐.)
  return "Workflows";
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
  const invalidate = useInvalidate();
  const [a, setA] = useState<AgentSpec>(agent);
  const [err, setErr] = useState<string | null>(null);
  const [genWarnings, setGenWarnings] = useState<string[]>([]);
  useDirtyGuard(registerDirty, () => JSON.stringify(a) !== JSON.stringify(agent));

  const save = useMutation({
    mutationFn: (next: AgentSpec) => api.putAgent(next.name, next),
    onSuccess: (_d, v) => {
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
          {(a.roles ?? []).map((r) => (
            <Badge key={r} tone="success">
              {r}
            </Badge>
          ))}
        </>
      }
      actions={
        !isNew ? (
          <button
            type="button"
            onClick={() => confirm(t("office.deleteConfirm", { name: a.name })) && del.mutate(a.name)}
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

      {/* 이름 (신규만 — 이름이 식별자) */}
      {isNew ? (
        <div className="mb-5">
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

      {/* 전담 역할 */}
      <div className="mt-4">
        <FieldLabel>{t("office.agent.roles")}</FieldLabel>
        <div className="flex flex-wrap gap-1.5">
          {(["git", "analyst", "author"] as const).map((role) => {
            const on = a.roles?.includes(role) ?? false;
            return (
              <button
                key={role}
                type="button"
                onClick={() =>
                  setA((p) => {
                    const next = on ? (p.roles ?? []).filter((r) => r !== role) : [...(p.roles ?? []), role];
                    return { ...p, roles: next.length ? next : undefined };
                  })
                }
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                  on ? "border-primary/50 bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:bg-muted/60",
                )}
              >
                {t(`office.agent.role.${role}`)}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">{t("office.agent.roles.hint")}</p>
      </div>

      <div className="mt-6">
        <FieldLabel>{t("office.agent.prompt")}</FieldLabel>
        <textarea
          className={cn(areaCls, "min-h-[300px] resize-y")}
          value={a.prompt ?? ""}
          placeholder="You are a backend engineer…"
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
        <SaveRow onSave={submit} pending={save.isPending} />
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
  const invalidate = useInvalidate();
  const [name, setName] = useState(rule.name);
  const [body, setBody] = useState(rule.body);
  const [err, setErr] = useState<string | null>(null);
  useDirtyGuard(registerDirty, () => name !== rule.name || body !== rule.body);
  const save = useMutation({
    mutationFn: (r: { name: string; body: string }) => api.putRule(r.name, r.body),
    onSuccess: (_d, v) => {
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
            onClick={() => confirm(t("office.deleteConfirm", { name: rule.name })) && del.mutate(rule.name)}
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

// 공식 출처 강조 — 서버 isOfficialSource 와 동일 목록(품질 신호).
function isOfficialSourceWeb(owner: string): boolean {
  return ["vercel-labs", "anthropics", "microsoft", "openai"].includes(owner.toLowerCase());
}
function formatInstalls(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
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
  const invalidate = useInvalidate();
  const [name, setName] = useState(skill.name);
  const [desc, setDesc] = useState(skill.description);
  const [body, setBody] = useState(skill.body);
  // 신규 스킬은 본문 저장 후 딸린 파일을 이어서 기록 — 로컬 스테이징.
  const [draftFiles, setDraftFiles] = useState<{ path: string; content: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useDirtyGuard(
    registerDirty,
    () => name !== skill.name || desc !== skill.description || body !== skill.body || draftFiles.length > 0,
  );

  const save = useMutation({
    mutationFn: async (s: { name: string; description: string; body: string; files: { path: string; content: string }[] }) => {
      await api.putSkill(s.name, s.description, s.body);
      for (const f of s.files) await api.putSkillFile(s.name, f.path, f.content);
    },
    onSuccess: (_d, v) => {
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
            onClick={() => confirm(t("office.deleteConfirm", { name: skill.name })) && del.mutate(skill.name)}
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
      />
    </DetailShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP detail — 단일 서버 폼. 저장 시 office.mcp 배열에 머지해 putMcp.
// ─────────────────────────────────────────────────────────────────────────────

const MCP_KINDS: McpServerKind[] = ["stdio", "http", "sse"];

function emptyServer(): McpServer {
  return {
    name: "",
    description: null,
    kind: "stdio",
    command: null,
    args: [],
    env: {},
    url: null,
    headers: {},
  };
}

function kvToText(o: Record<string, string>): string {
  return Object.entries(o)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

function textToKv(s: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const line of s.split(/\r?\n/)) {
    const m = line.match(/^([^=]+)=(.*)$/);
    if (m) o[m[1]!.trim()] = m[2]!;
  }
  return o;
}

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
  const invalidate = useInvalidate();
  const [s, setS] = useState<McpServer>(server);
  // args/env/headers 는 편집용 raw 문자열을 따로 든다 — 매 키입력마다 parse→재직렬화
  // 라운드트립을 돌리면 개행·후행 공백·미완성 줄이 즉시 지워져 타이핑이 불가능해진다.
  const [argsText, setArgsText] = useState(server.args.join(" "));
  const [envText, setEnvText] = useState(kvToText(server.env));
  const [headersText, setHeadersText] = useState(kvToText(server.headers));
  const [err, setErr] = useState<string | null>(null);
  const patch = (next: Partial<McpServer>) => setS((p) => ({ ...p, ...next }));
  useDirtyGuard(
    registerDirty,
    () =>
      JSON.stringify({ ...s, args: argsText.split(/\s+/).filter(Boolean), env: textToKv(envText), headers: textToKv(headersText) }) !==
      JSON.stringify(server),
  );

  const save = useMutation({
    mutationFn: (servers: McpServer[]) => api.putMcp(servers),
    onSuccess: (_d, _v) => {
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

  const remove = () => {
    if (!confirm(t("office.deleteConfirm", { name: server.name }))) return;
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
      <SaveRow onSave={submit} pending={save.isPending} />
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
  useDirtyGuard(registerDirty, () => body !== prompt.body);
  const save = useMutation({
    mutationFn: () => api.putFeaturePrompt(prompt.name, body),
    onSuccess: () => {
      setErr(null);
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
      <SaveRow onSave={() => save.mutate()} pending={save.isPending} />
    </DetailShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-reference bar — "이 자산을 쓰는 에이전트들" 칩
// ─────────────────────────────────────────────────────────────────────────────

function UsedByBar({
  kind,
  name,
  office,
  onSelect,
}: {
  kind: "rule" | "skill" | "mcp";
  name: string;
  office: Office;
  onSelect: (s: Selection) => void;
}) {
  const { t } = useI18n();
  const users = office.agents.filter((a) => (a[kind === "rule" ? "rules" : kind === "skill" ? "skills" : "mcp"] ?? []).includes(name));
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-border/40 bg-muted/20 px-3 py-2">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t("office.usedBy.label")}</span>
      {users.length === 0 ? (
        <span className="text-xs text-muted-foreground/70">{t("office.usedBy.none")}</span>
      ) : (
        users.map((u) => (
          <button
            key={u.name}
            type="button"
            onClick={() => onSelect({ kind: "agent", name: u.name })}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-2 py-0.5 text-xs transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            <AgentAvatar adapter={u.adapter} size={14} className="rounded-full" />
            <span className="font-medium">{u.label || u.name}</span>
          </button>
        ))
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reused primitives
// ─────────────────────────────────────────────────────────────────────────────

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

function SaveRow({ onSave, pending }: { onSave: () => void; pending: boolean }) {
  const { t } = useI18n();
  return (
    <div className="mt-6 flex justify-end">
      <Button size="sm" onClick={onSave} disabled={pending}>
        {pending ? t("office.saving") : t("office.save")}
      </Button>
    </div>
  );
}

// 합성 프롬프트 프리뷰 — run 시작 시 CLI 에 실제 들어갈 텍스트(규약 + 지침 + loadout 인덱스).
function PromptPreview({ agent }: { agent: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["runPreview", agent],
    queryFn: () => api.previewRun({ agent }),
    enabled: open,
    staleTime: 0,
  });
  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
      >
        <Eye className="size-3" />
        {open ? t("office.agent.previewHide") : t("office.agent.preview")}
      </button>
      {open ? (
        q.isLoading ? (
          <p className="mt-2 text-xs text-muted-foreground">…</p>
        ) : q.isError ? (
          <p className="mt-2 text-xs text-destructive">{q.error instanceof Error ? q.error.message : String(q.error)}</p>
        ) : (
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-muted/30 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {q.data?.prompt}
          </pre>
        )
      ) : null}
    </div>
  );
}

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
        <input className={cn(inputCls, "font-mono")} value={value ?? ""} placeholder="claude-fable-5" onChange={(e) => onChange(e.target.value || undefined)} />
        {list.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              setCustom(false);
              onChange(undefined);
            }}
            className="shrink-0 rounded-lg border border-border px-2 text-xs text-muted-foreground hover:bg-muted/60"
          >
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
        if (e.target.value === "__custom") {
          setCustom(true);
          return;
        }
        onChange(e.target.value || undefined);
      }}
    >
      <option value="">{t("office.agent.model.default")}</option>
      {[...grouped.entries()].map(([g, items]) =>
        g ? (
          <optgroup key={g} label={g}>
            {items.map((m) => (
              <option key={m.value} value={m.value}>
                {m.value}
              </option>
            ))}
          </optgroup>
        ) : (
          items.map((m) => (
            <option key={m.value} value={m.value}>
              {m.value}
            </option>
          ))
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
                {on ? "✓ " : ""}
                {n}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// 마크다운 본문 편집기 — Edit/Preview 토글. value/onChange 로 제어되며,
// 부모가 저장 시점에 value 를 그대로 보낸다(기존 textarea#id 패턴 폐기).
function MarkdownField({
  value,
  onChange,
  placeholder,
  minH = "min-h-32",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minH?: string;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"edit" | "preview">(value.trim() ? "preview" : "edit");
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
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(areaCls, minH, mode === "preview" && "hidden")}
      />
      {mode === "preview" ? (
        value.trim() ? (
          <div className="rounded-lg border border-border bg-background px-3.5 py-2.5">
            <Markdown>{value}</Markdown>
          </div>
        ) : (
          <p className="py-2 text-xs text-muted-foreground">{t("office.md.empty")}</p>
        )
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Skill files editor (ops 로 저장소 추상화)
// ─────────────────────────────────────────────────────────────────────────────

interface SkillFileOps {
  list: string[];
  read: (path: string) => Promise<string>;
  write: (path: string, content: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
}

function SkillFiles({ ops }: { ops: SkillFileOps }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<string | null>(null);
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
          onClick={() => {
            setEditing("__new");
            setPathInput("");
            setContent("");
            setErr(null);
          }}
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
          <textarea className={cn(areaCls, "mt-2 min-h-32")} value={content} placeholder="# File contents" onChange={(e) => setContent(e.target.value)} />
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
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setEditing(null);
                setErr(null);
              }}
            >
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function firstLine(body: string): string {
  for (const l of body.split(/\r?\n/)) {
    const t = l.replace(/^#+\s*/, "").trim();
    if (t) return t.slice(0, 90);
  }
  return "";
}
