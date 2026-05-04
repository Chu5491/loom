// "사무실" 뷰 — 캐릭터들이 사무실 안을 자유롭게 돌아다니다 일이 들어오면
// 자기 자리로 가서 작업하는 애니메이션 디오라마. 자세한 활동 내역(파일/도구/
// MCP/스킬)은 캐릭터를 클릭하면 하단 detail strip에 표시.
//
// 구조:
//   ┌── Whiteboard ─────────────────────┐  ← thread + 작업중 인원
//   │                                    │
//   │      🏢 OfficeFloor (애니)         │  ← 캐릭터/책상/말풍선
//   │                                    │
//   ├── AgentDetail (선택된 1명) ────────┤  ← 활동 + 도구 + MCP + 스킬
//   └────────────────────────────────────┘

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Coffee,
  FileEdit,
  FileText,
  Pencil,
  Plug,
  Sparkles,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import type {
  ActiveTool,
  ActiveTouch,
  ActiveToolsForAgent,
  Agent,
  Run,
  Spec,
  Thread,
} from "@loom/core";
import { api } from "../../api/client.js";
import { AgentInitialBadge } from "../../components/AgentInitialBadge.js";
import { agentColorOf, classesFor } from "../../components/agentColor.js";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";
import { basename } from "../../lib/path.js";
import { OfficeFloor } from "./OfficeFloor.js";

export function Office({
  projectId,
  agents,
  runs,
  workingIds,
  touchingIds,
  activeTouches,
  activeTools,
  activeThread,
  onPickFile,
  onPickAgent,
}: {
  projectId: string;
  agents: Agent[];
  runs: Run[];
  workingIds: Set<string>;
  touchingIds: Set<string>;
  activeTouches: ActiveTouch[];
  activeTools: ActiveToolsForAgent[];
  activeThread: Thread | null;
  onPickFile: (path: string) => void;
  onPickAgent: (id: string) => void;
}) {
  const { t } = useI18n();
  // 캐릭터를 클릭하면 그 에이전트의 detail이 하단에 펴짐. composer 타깃은
  // 의도적으로 분리 — detail은 "구경", composer는 "말걸기".
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 사라진 에이전트(삭제된 경우)는 selection 초기화.
  useEffect(() => {
    if (selectedId && !agents.find((a) => a.id === selectedId)) {
      setSelectedId(null);
    }
  }, [agents, selectedId]);

  const touchByAgent = useMemo(() => {
    const m = new Map<string, ActiveTouch>();
    for (const tch of activeTouches) {
      if (!m.has(tch.agentId)) m.set(tch.agentId, tch);
    }
    return m;
  }, [activeTouches]);
  const toolsByAgent = useMemo(() => {
    const m = new Map<string, ActiveToolsForAgent>();
    for (const x of activeTools) {
      if (!m.has(x.agentId)) m.set(x.agentId, x);
    }
    return m;
  }, [activeTools]);
  const lastRunByAgent = useMemo(() => {
    const m = new Map<string, Run>();
    for (const r of runs) {
      const prev = m.get(r.agentId);
      if (
        !prev ||
        new Date(r.createdAt).getTime() > new Date(prev.createdAt).getTime()
      ) {
        m.set(r.agentId, r);
      }
    }
    return m;
  }, [runs]);

  const workingCount = workingIds.size;
  const selected = selectedId
    ? (agents.find((a) => a.id === selectedId) ?? null)
    : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col office-floor">
      {/* 화이트보드 — 사무실 상단 공유 정보판. */}
      <header className="shrink-0 border-b-2 border-foreground/10 bg-card/60 backdrop-blur-sm">
        <div className="mx-auto max-w-5xl px-6 py-3 flex items-center gap-3">
          <span
            aria-hidden
            className="inline-flex size-7 items-center justify-center rounded bg-foreground/[0.06] text-muted-foreground"
          >
            <Pencil className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-semibold truncate">
                {activeThread
                  ? activeThread.name
                  : t("office.whiteboard.noThread")}
              </h2>
              <span className="text-[11px] text-muted-foreground/70 mono">
                {t("office.whiteboard.agents", { n: agents.length })}
              </span>
              {workingCount > 0 ? (
                <span className="inline-flex items-center gap-1 px-1.5 h-5 rounded-full text-[10px] mono text-emerald-700 dark:text-emerald-300 bg-emerald-500/10">
                  <span
                    aria-hidden
                    className="size-1.5 rounded-full bg-emerald-500 animate-pulse"
                  />
                  {t("office.whiteboard.working", { n: workingCount })}
                </span>
              ) : null}
            </div>
            <p className="text-[11px] text-muted-foreground/80 mt-0.5">
              {t("office.whiteboard.subtitle")}
            </p>
          </div>
        </div>
      </header>

      {/* 메인 캔버스 — 캐릭터/책상이 노는 곳. */}
      <div className="flex-1 min-h-0 flex flex-col">
        <OfficeFloor
          agents={agents}
          workingIds={workingIds}
          touchingIds={touchingIds}
          activeTouches={activeTouches}
          activeTools={activeTools}
          onPickAgent={(id) => setSelectedId(id)}
        />
      </div>

      {/* 선택된 에이전트 detail strip — 클릭한 캐릭터의 활동 상세. */}
      {selected ? (
        <AgentDetail
          projectId={projectId}
          agent={selected}
          working={workingIds.has(selected.id)}
          touching={touchingIds.has(selected.id)}
          activeTouch={touchByAgent.get(selected.id) ?? null}
          activeTool={toolsByAgent.get(selected.id) ?? null}
          lastRun={lastRunByAgent.get(selected.id) ?? null}
          onClose={() => setSelectedId(null)}
          onPickFile={onPickFile}
          onTalkTo={() => {
            onPickAgent(selected.id);
            setSelectedId(null);
          }}
        />
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// AgentDetail — 캐릭터를 클릭했을 때 하단에 펴지는 정보 strip.
// 이전 카드 그리드의 정보 밀도를 그대로 가져오면서 한 명에 집중.
// ─────────────────────────────────────────────────────────────────

type DeskStatus = "working" | "thinking" | "idle";

function AgentDetail({
  projectId,
  agent,
  working,
  touching,
  activeTouch,
  activeTool,
  lastRun,
  onClose,
  onPickFile,
  onTalkTo,
}: {
  projectId: string;
  agent: Agent;
  working: boolean;
  touching: boolean;
  activeTouch: ActiveTouch | null;
  activeTool: ActiveToolsForAgent | null;
  lastRun: Run | null;
  onClose: () => void;
  onPickFile: (path: string) => void;
  onTalkTo: () => void;
}) {
  const { t } = useI18n();
  const cls = classesFor(agentColorOf(agent));

  const skills = useQuery({
    queryKey: ["specs", { agentId: agent.id }],
    queryFn: () => api.listSpecs({ agentId: agent.id }),
    staleTime: 60_000,
  });
  const skillList: Spec[] = skills.data?.specs ?? [];

  const status: DeskStatus = touching
    ? "working"
    : working
      ? "thinking"
      : "idle";

  const recentTools = activeTool?.recent ?? [];
  const latestTool = recentTools[recentTools.length - 1] ?? null;
  const olderTools = recentTools.slice(-6, -1);

  return (
    <section className="shrink-0 border-t-2 border-foreground/10 bg-card max-h-[40%] overflow-y-auto">
      <header className="sticky top-0 flex items-center gap-2 px-4 py-2 border-b border-border/60 bg-card/95 backdrop-blur">
        <AgentInitialBadge agent={agent} live={touching} size="sm" />
        <span className={cn("text-sm font-semibold truncate", cls.text)}>
          @{agent.name}
        </span>
        <StatusPill status={status} />
        <button
          type="button"
          onClick={onTalkTo}
          className="ml-auto inline-flex items-center gap-1 px-2 h-6 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          {t("office.detail.talkTo")}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label={t("common.close")}
        >
          <X className="size-3.5" />
        </button>
      </header>
      <div className="px-4 py-3 grid gap-2 sm:grid-cols-2">
        {activeTouch ? (
          <ActivityLine
            icon={FileEdit}
            label={t("office.desk.editing")}
            tone="working"
          >
            <FileChip paths={activeTouch.paths} onPick={onPickFile} />
          </ActivityLine>
        ) : working ? (
          <ActivityLine
            icon={Activity}
            label={t("office.desk.thinking")}
            tone="thinking"
          >
            <span className="text-[11px] text-muted-foreground/80 italic">
              {t("office.desk.composing")}
            </span>
          </ActivityLine>
        ) : lastRun ? (
          <ActivityLine
            icon={Coffee}
            label={t("office.desk.idle")}
            tone="idle"
          >
            <span
              className="text-[11px] text-muted-foreground/70 truncate block"
              title={lastRun.prompt}
            >
              {lastRun.prompt.split("\n")[0]?.slice(0, 80) ?? ""}
            </span>
          </ActivityLine>
        ) : (
          <ActivityLine
            icon={Coffee}
            label={t("office.desk.unstarted")}
            tone="idle"
          >
            <span className="text-[11px] text-muted-foreground/60 italic">
              {t("office.desk.unstartedHint")}
            </span>
          </ActivityLine>
        )}

        {latestTool ? (
          <ActivityLine
            icon={Wrench}
            label={t("office.desk.using")}
            tone="working"
          >
            <div className="flex flex-wrap items-center gap-1">
              <ToolChip tool={latestTool} highlight />
              {olderTools.map((tu, i) => (
                <ToolChip key={i} tool={tu} />
              ))}
            </div>
          </ActivityLine>
        ) : null}

        {activeTool && activeTool.mcpServers.length > 0 ? (
          <ActivityLine
            icon={Plug}
            label={t("office.desk.mcp", { n: activeTool.mcpServers.length })}
            tone="meta"
          >
            <div className="flex flex-wrap gap-1">
              {activeTool.mcpServers.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center px-1.5 h-4 rounded text-[10px] mono bg-violet-500/10 text-violet-700 dark:text-violet-300"
                  title={`mcp://${s}`}
                >
                  {s}
                </span>
              ))}
            </div>
          </ActivityLine>
        ) : null}

        {skillList.length > 0 ? (
          <ActivityLine
            icon={Sparkles}
            label={t("office.desk.skills", { n: skillList.length })}
            tone="meta"
          >
            <div className="flex flex-wrap gap-1">
              {skillList.slice(0, 4).map((s) => (
                <span
                  key={s.id}
                  className="inline-flex items-center px-1.5 h-4 rounded text-[10px] bg-foreground/[0.05] text-muted-foreground"
                  title={s.name}
                >
                  {s.name.length > 18 ? s.name.slice(0, 18) + "…" : s.name}
                </span>
              ))}
              {skillList.length > 4 ? (
                <span className="text-[10px] text-muted-foreground/60 mono">
                  +{skillList.length - 4}
                </span>
              ) : null}
            </div>
          </ActivityLine>
        ) : null}
      </div>
      <span className="sr-only mono">{projectId}</span>
    </section>
  );
}

function StatusPill({ status }: { status: DeskStatus }) {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 h-4 rounded-full text-[9px] mono shrink-0",
        status === "working"
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : status === "thinking"
            ? "bg-amber-400/10 text-amber-700 dark:text-amber-300"
            : "bg-muted text-muted-foreground/70",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1 rounded-full",
          status === "working"
            ? "bg-emerald-500 animate-pulse"
            : status === "thinking"
              ? "bg-amber-400 animate-pulse"
              : "bg-muted-foreground/40",
        )}
      />
      {t(`office.status.${status}`)}
    </span>
  );
}

function ActivityLine({
  icon: Icon,
  label,
  tone,
  children,
}: {
  icon: LucideIcon;
  label: string;
  tone: DeskStatus | "meta";
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 text-[11px] min-w-0">
      <Icon
        className={cn(
          "size-3 mt-0.5 shrink-0",
          tone === "working"
            ? "text-emerald-600 dark:text-emerald-400"
            : tone === "thinking"
              ? "text-amber-500"
              : "text-muted-foreground/60",
        )}
      />
      <div className="min-w-0 flex-1">
        <span className="text-muted-foreground/70 mr-1">{label}</span>
        {children}
      </div>
    </div>
  );
}

function FileChip({
  paths,
  onPick,
}: {
  paths: string[];
  onPick: (path: string) => void;
}) {
  if (paths.length === 0) return null;
  const head = paths[0]!;
  return (
    <span className="inline-flex items-center gap-1 min-w-0">
      <button
        type="button"
        onClick={() => onPick(head)}
        className="inline-flex items-center gap-1 max-w-[14rem] px-1.5 h-4 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 mono text-[10px] hover:bg-emerald-500/20 transition-colors"
        title={head}
      >
        <FileText className="size-2.5 shrink-0" />
        <span className="truncate">{basename(head)}</span>
      </button>
      {paths.length > 1 ? (
        <span className="text-[10px] text-muted-foreground/60 mono">
          +{paths.length - 1}
        </span>
      ) : null}
    </span>
  );
}

function ToolChip({
  tool,
  highlight,
}: {
  tool: ActiveTool;
  highlight?: boolean;
}) {
  if (tool.name.startsWith("mcp__")) return null;
  const short = shortToolLabel(tool);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 h-4 rounded text-[10px] mono transition-colors",
        highlight
          ? "bg-foreground text-background"
          : "bg-foreground/[0.06] text-muted-foreground",
      )}
      title={tool.target ? `${tool.name} · ${tool.target}` : tool.name}
    >
      <span className="font-semibold">{tool.name}</span>
      {short ? <span className="opacity-80">{short}</span> : null}
    </span>
  );
}

function shortToolLabel(tool: ActiveTool): string | null {
  if (!tool.target) return null;
  if (
    tool.name === "Read" ||
    tool.name === "Write" ||
    tool.name === "Edit" ||
    tool.name === "MultiEdit" ||
    tool.name === "NotebookEdit"
  ) {
    return basename(tool.target);
  }
  return tool.target.length > 24 ? tool.target.slice(0, 24) + "…" : tool.target;
}
