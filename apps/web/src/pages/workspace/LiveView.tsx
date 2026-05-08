// LiveView — 멀티에이전트 ops 화면.
//
// 좌-리스트/우-디테일 패턴은 AgentsTab(팀 메뉴)와 너무 비슷해서 폐기. 대신
// 모든 에이전트를 *동시에* 보고 (상단 가로 카드들), 그 아래에 *통합 활동 스트림*.
// loom 의 본질 = 여러 에이전트가 같이 일하는 거니까 화면 전체가 그걸 보여줘야.

import { useMemo, useState } from "react";
import { Loader2, Pencil, Plus, RefreshCw } from "lucide-react";
import { useParams } from "react-router-dom";
import type {
  ActiveToolsForAgent,
  ActiveTouch,
  AdapterManifest,
  Agent,
  Thread,
} from "@loom/core";
import { AdapterIcon } from "../../components/AdapterIcon.js";
import { agentColorOf, classesFor } from "../../components/agentColor.js";
import { useI18n } from "../../context/I18nContext.js";
import { basename } from "../../lib/path.js";
import { formatTimeAgo } from "../../lib/timeAgo.js";
import { useAutoAnimate } from "../../lib/useAutoAnimate.js";
import { cn } from "../../lib/utils.js";
import { AgentFormDialog } from "./AgentFormDialog.js";
import type { FormMode } from "../agents/types.js";

// ──────────────────────────────────────────────────────────────────────────
// 헬퍼
// ──────────────────────────────────────────────────────────────────────────

function toolIcon(name: string): string {
  if (name.startsWith("mcp__")) return "🔌";
  const n = name.toLowerCase();
  if (n.includes("read")) return "📖";
  if (n.includes("write") || n.includes("create")) return "✍️";
  if (n.includes("edit") || n.includes("update")) return "✎";
  if (n.includes("bash") || n.includes("exec") || n.includes("shell")) return "⚡";
  if (n.includes("search") || n.includes("grep") || n.includes("find")) return "🔍";
  if (n.includes("web") || n.includes("fetch") || n.includes("curl")) return "🌐";
  if (n.includes("test")) return "🧪";
  return "🔧";
}

type LiveState = "editing" | "tooling" | "thinking" | "idle";

function liveStateOf(
  working: boolean,
  file: string | null,
  tool: ActiveToolsForAgent | null,
): LiveState {
  if (file) return "editing";
  if (working && tool && tool.recent.length > 0) return "tooling";
  if (working) return "thinking";
  return "idle";
}

// ──────────────────────────────────────────────────────────────────────────
// 메인
// ──────────────────────────────────────────────────────────────────────────

interface Props {
  projectName: string;
  agents: Agent[];
  workingIds: Set<string>;
  touchingIds: Set<string>;
  activeTouches: ActiveTouch[];
  activeTools: ActiveToolsForAgent[];
  threadList: Thread[];
  workingThreadIds: Set<string>;
  activeThreadId: string | null;
  threadByAgent: Map<string, string>;
  adapterByKind: Record<string, AdapterManifest>;
  onPickFile: (path: string) => void;
  onPickAgent: (id: string) => void;
  onPickThread: (id: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function LiveView({
  projectName,
  agents,
  workingIds,
  touchingIds,
  activeTouches,
  activeTools,
  threadList,
  workingThreadIds,
  activeThreadId,
  threadByAgent,
  adapterByKind,
  onPickFile,
  onPickAgent,
  onPickThread,
  onRefresh,
  refreshing,
}: Props) {
  const { id: projectId } = useParams<{ id: string }>();
  const [formState, setFormState] = useState<FormMode | null>(null);

  const fileByAgent = useMemo(() => {
    const m = new Map<string, string>();
    for (const tch of activeTouches) {
      const first = tch.paths[0];
      if (first && !m.has(tch.agentId)) m.set(tch.agentId, first);
    }
    return m;
  }, [activeTouches]);

  const toolByAgent = useMemo(() => {
    const m = new Map<string, ActiveToolsForAgent>();
    for (const x of activeTools) m.set(x.agentId, x);
    return m;
  }, [activeTools]);

  // 정렬: working > touching > 알파벳.
  const sortedAgents = useMemo(() => {
    return [...agents].sort((a, b) => {
      const wa = workingIds.has(a.id) ? 1 : 0;
      const wb = workingIds.has(b.id) ? 1 : 0;
      if (wa !== wb) return wb - wa;
      const ta = touchingIds.has(a.id) ? 1 : 0;
      const tb = touchingIds.has(b.id) ? 1 : 0;
      if (ta !== tb) return tb - ta;
      return a.name.localeCompare(b.name);
    });
  }, [agents, workingIds, touchingIds]);

  // 통합 스트림 — 모든 에이전트의 tool.recent 를 ts desc 로 병합.
  type StreamItem = {
    key: string;
    ts: string;
    agent: Agent;
    name: string;
    target: string | null;
  };
  const stream = useMemo<StreamItem[]>(() => {
    const items: StreamItem[] = [];
    for (const tool of activeTools) {
      const a = agents.find((x) => x.id === tool.agentId);
      if (!a) continue;
      tool.recent.forEach((r, i) => {
        items.push({
          key: `${a.id}-${tool.runId}-${i}-${r.ts}`,
          ts: r.ts,
          agent: a,
          name: r.name,
          target: r.target ?? null,
        });
      });
    }
    items.sort((a, b) => (b.ts > a.ts ? 1 : b.ts < a.ts ? -1 : 0));
    return items.slice(0, 60);
  }, [activeTools, agents]);

  const totalWorking = workingIds.size;

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <Header
        projectName={projectName}
        totalWorking={totalWorking}
        totalAgents={agents.length}
        onRefresh={onRefresh}
        refreshing={refreshing}
      />

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-5 py-5">
          {/* 상단 — 가로 에이전트 카드들. 모두 동시 가시 + 끝에 "+ 추가" 타일.
              edit / add 는 모두 모달로 — 라이브 화면을 안 떠남. */}
          <AgentRow
            agents={sortedAgents}
            workingIds={workingIds}
            touchingIds={touchingIds}
            fileByAgent={fileByAgent}
            toolByAgent={toolByAgent}
            adapterByKind={adapterByKind}
            threadByAgent={threadByAgent}
            activeThreadId={activeThreadId}
            threads={threadList}
            workingThreadIds={workingThreadIds}
            canManage={!!projectId}
            onPickAgent={onPickAgent}
            onPickFile={onPickFile}
            onPickThread={onPickThread}
            onEditAgent={(a) => setFormState({ mode: "edit", agent: a })}
            onAddAgent={() => setFormState({ mode: "create" })}
          />

          {/* 통합 활동 스트림. */}
          <Stream stream={stream} onPickFile={onPickFile} onPickAgent={onPickAgent} />
        </div>
      </div>

      <AgentFormDialog
        open={!!formState}
        state={formState}
        projectId={projectId}
        onOpenChange={(o) => {
          if (!o) setFormState(null);
        }}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 헤더
// ──────────────────────────────────────────────────────────────────────────

function Header({
  totalWorking,
  totalAgents,
  onRefresh,
  refreshing,
}: {
  projectName: string;
  totalWorking: number;
  totalAgents: number;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const { t } = useI18n();
  // 프로젝트명/라이브 라벨은 위쪽 TeamRibbon + FileTabBar 가 이미 표시. 여기는
  // 카운트만 — 중복 제거하니 시각 노이즈 ↓.
  return (
    <header className="shrink-0 flex items-center gap-3 px-4 py-1.5 border-b border-border/60">
      <span className="text-[11px] text-muted-foreground mono">
        {totalWorking > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {totalWorking} {t("live.workingShort")} ·{" "}
            <span className="text-muted-foreground/60">
              {totalAgents} {t("live.agentsShort")}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground/60">
            {totalAgents} {t("live.agentsShort")} · {t("live.state.idle")}
          </span>
        )}
      </span>
      {onRefresh ? (
        <button
          type="button"
          onClick={onRefresh}
          title={t("map.refresh")}
          aria-label={t("map.refresh")}
          className="ml-auto inline-flex size-6 items-center justify-center rounded text-muted-foreground/70 hover:text-foreground hover:bg-muted transition-colors shrink-0"
        >
          <RefreshCw className={cn("size-3", refreshing && "animate-spin")} />
        </button>
      ) : null}
    </header>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 에이전트 카드 row — 가로 grid. 모두 동시 가시.
// ──────────────────────────────────────────────────────────────────────────

function AgentRow({
  agents,
  workingIds,
  touchingIds,
  fileByAgent,
  toolByAgent,
  adapterByKind,
  threadByAgent,
  activeThreadId,
  threads,
  workingThreadIds,
  canManage,
  onPickAgent,
  onPickFile,
  onPickThread,
  onEditAgent,
  onAddAgent,
}: {
  agents: Agent[];
  workingIds: Set<string>;
  touchingIds: Set<string>;
  fileByAgent: Map<string, string>;
  toolByAgent: Map<string, ActiveToolsForAgent>;
  adapterByKind: Record<string, AdapterManifest>;
  threadByAgent: Map<string, string>;
  activeThreadId: string | null;
  threads: Thread[];
  workingThreadIds: Set<string>;
  canManage: boolean;
  onPickAgent: (id: string) => void;
  onPickFile: (path: string) => void;
  onPickThread: (id: string) => void;
  onEditAgent: (agent: Agent) => void;
  onAddAgent: () => void;
}) {
  return (
    <div
      className="grid gap-2 mb-4"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}
    >
      {agents.map((a) => (
        <AgentCard
          key={a.id}
          agent={a}
          manifest={adapterByKind[a.adapterKind]}
          working={workingIds.has(a.id)}
          touching={touchingIds.has(a.id)}
          file={fileByAgent.get(a.id) ?? null}
          tool={toolByAgent.get(a.id) ?? null}
          thread={
            threads.find((th) => th.id === threadByAgent.get(a.id)) ?? null
          }
          inActiveThread={
            threadByAgent.get(a.id) === activeThreadId &&
            activeThreadId !== null
          }
          threadWorking={
            !!threadByAgent.get(a.id) &&
            workingThreadIds.has(threadByAgent.get(a.id)!)
          }
          canEdit={canManage}
          onPickAgent={() => onPickAgent(a.id)}
          onPickFile={onPickFile}
          onPickThread={onPickThread}
          onEdit={() => onEditAgent(a)}
        />
      ))}
      {canManage ? <AddAgentTile onClick={onAddAgent} /> : null}
    </div>
  );
}

function AddAgentTile({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center justify-center gap-1.5 rounded-xl bg-card/30 ring-1 ring-foreground/5 hover:ring-foreground/15 hover:bg-card/70 transition-all text-muted-foreground hover:text-foreground"
      title={t("live.addAgent.title")}
    >
      <Plus className="size-3.5" />
      <span className="text-[11.5px] font-medium">{t("live.addAgent")}</span>
    </button>
  );
}

function AgentCard({
  agent,
  manifest,
  working,
  touching,
  file,
  tool,
  thread,
  inActiveThread,
  threadWorking,
  canEdit,
  onPickAgent,
  onPickFile,
  onPickThread,
  onEdit,
}: {
  agent: Agent;
  manifest: AdapterManifest | undefined;
  working: boolean;
  touching: boolean;
  file: string | null;
  tool: ActiveToolsForAgent | null;
  thread: Thread | null;
  inActiveThread: boolean;
  threadWorking: boolean;
  /** false 면 hover 시 편집 아이콘 숨김. */
  canEdit: boolean;
  onPickAgent: () => void;
  onPickFile: (path: string) => void;
  onPickThread: (id: string) => void;
  onEdit: () => void;
}) {
  const { t } = useI18n();
  const cls = classesFor(agentColorOf(agent));
  const state = liveStateOf(working, file, tool);
  const latest = tool?.recent[tool.recent.length - 1];

  return (
    <div
      className={cn(
        "group relative rounded-xl p-3.5 transition-all",
        working
          ? "bg-emerald-500/[0.04] ring-1 ring-emerald-500/30 shadow-sm"
          : inActiveThread
            ? "bg-card/70 ring-1 ring-foreground/15 shadow-sm"
            : "bg-card/50 ring-1 ring-foreground/5 hover:ring-foreground/15 hover:bg-card/80",
      )}
    >
      {/* hover 시 우상단 편집 아이콘 — 모달로 띄움 (페이지 이동 X). */}
      {canEdit ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          title={t("live.editAgent")}
          aria-label={t("live.editAgent")}
          className="absolute top-1.5 right-1.5 inline-flex size-6 items-center justify-center rounded text-muted-foreground/60 opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-muted/60 transition-all"
        >
          <Pencil className="size-3" />
        </button>
      ) : null}

      {/* 헤더: 로고 + 이름 + 상태 dot. */}
      <div className="flex items-center gap-2 mb-2 min-w-0">
        <button
          type="button"
          onClick={onPickAgent}
          title={`${t("room.talk")} @${agent.name}`}
          className={cn(
            "relative inline-flex size-10 items-center justify-center rounded-xl bg-background/80 shrink-0 ring-1 transition-all hover:scale-105",
            cls.ring,
            working ? "ring-2 ring-offset-2 ring-offset-card" : "ring-foreground/10",
          )}
        >
          {manifest ? (
            <AdapterIcon manifest={manifest} size={28} />
          ) : (
            <span className={cn("text-sm font-semibold", cls.text)}>·</span>
          )}
          {/* 우하단 상태 dot */}
          <span
            aria-hidden
            className={cn(
              "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-card",
              working
                ? "bg-emerald-500 animate-pulse"
                : "bg-muted-foreground/30",
            )}
          />
        </button>

        <div className="flex-1 min-w-0">
          <button
            type="button"
            onClick={onPickAgent}
            className={cn(
              "block text-[12.5px] font-semibold truncate hover:underline text-left max-w-full",
              cls.text,
            )}
          >
            @{agent.name}
          </button>
          <div className="text-[10px] mono text-muted-foreground/80 truncate">
            {manifest?.displayName ?? agent.adapterKind}
            {agent.role ? (
              <span className="text-muted-foreground/60"> · {agent.role}</span>
            ) : null}
          </div>
        </div>
      </div>

      {/* 상태 라인 */}
      <div className="text-[11.5px] mono text-foreground/85 truncate min-w-0 mb-1.5">
        {state === "editing" && file ? (
          <button
            type="button"
            onClick={() => onPickFile(file)}
            className={cn(
              "inline-flex items-center gap-1 hover:underline truncate max-w-full",
              touching ? "text-emerald-700 dark:text-emerald-300" : cls.text,
            )}
            title={file}
          >
            <span>✎</span>
            <span className="truncate">{basename(file)}</span>
          </button>
        ) : state === "tooling" && latest ? (
          <span className="inline-flex items-center gap-1 truncate">
            <span>{toolIcon(latest.name)}</span>
            <span className="truncate">{latest.name}</span>
            {latest.target ? (
              <span className="text-muted-foreground/70 truncate">
                · {latest.target.slice(0, 30)}
              </span>
            ) : null}
          </span>
        ) : state === "thinking" ? (
          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
            <Loader2 className="size-3 animate-spin" />
            {t("live.state.thinking")}
          </span>
        ) : (
          <span className="text-muted-foreground/60">
            {t("live.state.idle")}
          </span>
        )}
      </div>

      {/* 진행 바 */}
      <div className="h-0.5 w-full rounded-full bg-muted overflow-hidden">
        {working ? (
          <div
            className="h-full rounded-full bg-emerald-500/60"
            style={{
              animation: "live-scan 1.8s ease-in-out infinite",
              width: "30%",
            }}
          />
        ) : null}
      </div>
      <style>{`
        @keyframes live-scan {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
      `}</style>

      {/* thread 표시 — 클릭하면 활성화. */}
      {thread ? (
        <button
          type="button"
          onClick={() => onPickThread(thread.id)}
          className={cn(
            "mt-2 w-full text-left text-[10px] mono truncate inline-flex items-center gap-1 transition-colors",
            inActiveThread
              ? "text-foreground/80"
              : "text-muted-foreground hover:text-foreground",
          )}
          title={thread.name ?? t("thread.untitled")}
        >
          {threadWorking ? (
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          ) : (
            <span className="size-1.5 rounded-full bg-muted-foreground/30 shrink-0" />
          )}
          <span className="truncate">
            in {thread.name ?? t("thread.untitled")}
          </span>
        </button>
      ) : null}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 통합 스트림 — 모든 에이전트의 활동 시간순 병합.
// ──────────────────────────────────────────────────────────────────────────

function Stream({
  stream,
  onPickFile,
  onPickAgent,
}: {
  stream: Array<{
    key: string;
    ts: string;
    agent: Agent;
    name: string;
    target: string | null;
  }>;
  onPickFile: (path: string) => void;
  onPickAgent: (id: string) => void;
}) {
  const { t } = useI18n();
  const ref = useAutoAnimate<HTMLUListElement>({
    duration: 220,
    easing: "ease-out",
  });

  // 빈 스트림이면 라벨까지 안 보임 — 시각 노이즈 ↓. 활동이 들어오면 자연스럽게 등장.
  if (stream.length === 0) return null;

  return (
    <section>
      <div className="flex items-center gap-2 mb-2 px-1">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("live.stream")}
        </h3>
        <span className="text-[10px] text-muted-foreground/60">
          · {stream.length}
        </span>
      </div>
      <ul ref={ref} className="space-y-px">
        {stream.map((item, idx) => (
          <StreamRow
            key={item.key}
            ts={item.ts}
            agent={item.agent}
            name={item.name}
            target={item.target}
            recent={idx < 3}
            onPickFile={onPickFile}
            onPickAgent={onPickAgent}
          />
        ))}
      </ul>
    </section>
  );
}

function StreamRow({
  ts,
  agent,
  name,
  target,
  recent,
  onPickFile,
  onPickAgent,
}: {
  ts: string;
  agent: Agent;
  name: string;
  target: string | null;
  /** 상위 3개 만 emerald dot — 진짜 직전 활동 강조. */
  recent: boolean;
  onPickFile: (path: string) => void;
  onPickAgent: (id: string) => void;
}) {
  const { t } = useI18n();
  const cls = classesFor(agentColorOf(agent));
  const isPath =
    !!target &&
    (target.startsWith("/") || target.includes("/") || target.includes("."));
  const display = name.startsWith("mcp__")
    ? `🔌 ${name.split("__").slice(1).join(" · ")}`
    : `${toolIcon(name)} ${name}`;

  return (
    <li className="group flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-foreground/[0.03] transition-colors">
      {/* timeline 좌측 dot */}
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full shrink-0",
          recent ? "bg-emerald-500" : "bg-muted-foreground/30",
          recent && "animate-pulse",
        )}
      />
      <span className="text-[10px] mono text-muted-foreground/60 w-12 shrink-0 tabular-nums">
        {formatTimeAgo(ts, t)}
      </span>
      <button
        type="button"
        onClick={() => onPickAgent(agent.id)}
        className={cn(
          "text-[11px] font-medium hover:underline shrink-0",
          cls.text,
        )}
      >
        @{agent.name}
      </button>
      <span className="text-xs mono text-foreground/80 shrink-0">
        {display}
      </span>
      {target ? (
        isPath ? (
          <button
            type="button"
            onClick={() => onPickFile(target)}
            className="text-[11px] mono text-muted-foreground/80 hover:text-foreground hover:underline truncate min-w-0"
            title={target}
          >
            {basename(target)}
          </button>
        ) : (
          <span
            className="text-[11px] mono text-muted-foreground/70 truncate min-w-0"
            title={target}
          >
            {target}
          </span>
        )
      ) : null}
    </li>
  );
}
