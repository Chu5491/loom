// LiveView — 멀티에이전트 ops 화면.
//
// 좌-리스트/우-디테일 패턴은 AgentsTab(팀 메뉴)와 너무 비슷해서 폐기. 대신
// 모든 에이전트를 *동시에* 보고 (상단 가로 카드들), 그 아래에 *통합 활동 스트림*.
// loom 의 본질 = 여러 에이전트가 같이 일하는 거니까 화면 전체가 그걸 보여줘야.

import { memo, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  FileCode,
  GitBranch,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useParams } from "react-router-dom";
import type {
  ActiveToolsForAgent,
  ActiveTouch,
  AdapterManifest,
  Agent,
  Delegation,
  Run,
  Thread,
} from "@loom/core";
import { api, type GitStatus, type GitBranchInfo, type GitCollaborator } from "../../api/client.js";
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
  agents: Agent[];
  runs: Run[];
  workingIds: Set<string>;
  touchingIds: Set<string>;
  activeTouches: ActiveTouch[];
  activeTools: ActiveToolsForAgent[];
  /** 진행 중 run 들의 sub-agent 위임 시도 — 활동 스트림에 행으로 등장. */
  delegations: Delegation[];
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

export const LiveView = memo(function LiveView({
  agents,
  runs,
  workingIds,
  touchingIds,
  activeTouches,
  activeTools,
  delegations,
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

  const lastRunByAgent = useMemo(() => {
    const m = new Map<string, Run>();
    for (const r of runs) {
      if (!m.has(r.agentId)) m.set(r.agentId, r);
    }
    return m;
  }, [runs]);

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

  // 통합 스트림 — 모든 에이전트의 tool.recent + 위임 시도 를 ts desc 로 병합.
  // 위임 행은 도구 행과 시각적으로 구분 (⤳ delegated → @sub-agent).
  type StreamItem =
    | {
        kind: "tool";
        key: string;
        ts: string;
        agent: Agent;
        name: string;
        target: string | null;
      }
    | {
        kind: "delegation";
        key: string;
        ts: string;
        agent: Agent;
        targetAgentName: string | null;
        taskDescription: string;
        status: Delegation["status"];
      };
  const stream = useMemo<StreamItem[]>(() => {
    const items: StreamItem[] = [];
    for (const tool of activeTools) {
      const a = agents.find((x) => x.id === tool.agentId);
      if (!a) continue;
      tool.recent.forEach((r, i) => {
        items.push({
          kind: "tool",
          key: `${a.id}-${tool.runId}-${i}-${r.ts}`,
          ts: r.ts,
          agent: a,
          name: r.name,
          target: r.target ?? null,
        });
      });
    }
    // 위임 시도 — parent run 의 agent 를 찾아 행 추가. agent 못 찾으면 skip.
    const runAgent = new Map<string, Agent>();
    for (const tool of activeTools) {
      const a = agents.find((x) => x.id === tool.agentId);
      if (a) runAgent.set(tool.runId, a);
    }
    for (const d of delegations) {
      const a = runAgent.get(d.parentRunId);
      if (!a) continue;
      items.push({
        kind: "delegation",
        key: `del-${d.id}`,
        ts: d.initiatedAt,
        agent: a,
        targetAgentName: d.targetAgentName,
        taskDescription: d.taskDescription,
        status: d.status,
      });
    }
    items.sort((a, b) => (b.ts > a.ts ? 1 : b.ts < a.ts ? -1 : 0));
    return items.slice(0, 60);
  }, [activeTools, agents, delegations]);

  const totalWorking = workingIds.size;

  const gitLogQuery = useQuery({
    queryKey: ["gitLog", projectId],
    queryFn: () => api.getGitLog(projectId!, { limit: 15, all: true }),
    enabled: !!projectId,
    refetchInterval: 30_000,
  });
  const gitStatusQuery = useQuery({
    queryKey: ["gitStatus", projectId],
    queryFn: () => api.getGitStatus(projectId!),
    enabled: !!projectId,
    refetchInterval: 15_000,
  });
  const insightsQuery = useQuery({
    queryKey: ["projectInsights", projectId],
    queryFn: () => api.getProjectInsights(projectId!, 7),
    enabled: !!projectId,
    staleTime: 60_000,
  });
  const commits = gitLogQuery.data?.entries ?? [];
  const gitStatus = gitStatusQuery.data?.status ?? null;
  const insights = insightsQuery.data ?? null;

  const recentCompletedRuns = useMemo(
    () =>
      runs
        .filter(
          (r) =>
            r.status === "succeeded" ||
            r.status === "failed" ||
            r.status === "cancelled",
        )
        .slice(0, 8),
    [runs],
  );

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-5 py-5">
          <ProjectInfoBar
            gitStatus={gitStatus}
            agentCount={agents.length}
            workingCount={totalWorking}
            insights={insights?.summary ?? null}
            onRefresh={onRefresh}
            refreshing={refreshing}
          />

          <AgentRow
            agents={sortedAgents}
            workingIds={workingIds}
            touchingIds={touchingIds}
            fileByAgent={fileByAgent}
            toolByAgent={toolByAgent}
            lastRunByAgent={lastRunByAgent}
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

          <Stream stream={stream} onPickFile={onPickFile} onPickAgent={onPickAgent} />

          <GitPanel
            projectId={projectId!}
            commits={commits}
            gitStatus={gitStatus}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
            <RecentRuns
              runs={recentCompletedRuns}
              agents={agents}
              onPickAgent={onPickAgent}
            />
            <HotFiles
              files={insights?.files ?? []}
              onPickFile={onPickFile}
            />
          </div>
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
});

// ──────────────────────────────────────────────────────────────────────────
// ProjectInfoBar — compact chip row replacing old Header + QuickStats.
// ──────────────────────────────────────────────────────────────────────────

function ProjectInfoBar({
  gitStatus,
  agentCount,
  workingCount,
  insights,
  onRefresh,
  refreshing,
}: {
  gitStatus: GitStatus | null;
  agentCount: number;
  workingCount: number;
  insights: {
    totalRuns: number;
    totalCostUsd: number;
    successRate: number;
    activeRuns: number;
  } | null;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const { t } = useI18n();
  const chip =
    "inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/50 text-[10.5px] mono text-muted-foreground shrink-0";
  const dirtyCount = gitStatus
    ? gitStatus.staged.length + gitStatus.unstaged.length + gitStatus.untracked.length
    : 0;

  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-4">
      {gitStatus?.branch ? (
        <span className={chip}>
          <GitBranch className="size-3" />
          {gitStatus.branch}
          {gitStatus.ahead ? (
            <span className="text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-px">
              <ArrowUp className="size-2.5" />{gitStatus.ahead}
            </span>
          ) : null}
          {gitStatus.behind ? (
            <span className="text-rose-600 dark:text-rose-400 inline-flex items-center gap-px">
              <ArrowDown className="size-2.5" />{gitStatus.behind}
            </span>
          ) : null}
        </span>
      ) : null}

      {gitStatus ? (
        <span className={cn(chip, !gitStatus.clean && "text-amber-700 dark:text-amber-400")}>
          {gitStatus.clean ? t("git.status.clean") : `${dirtyCount} ${t("git.status.changes")}`}
        </span>
      ) : null}

      <span className={cn(chip, workingCount > 0 && "text-emerald-700 dark:text-emerald-400")}>
        {workingCount > 0 ? (
          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
        ) : null}
        {agentCount} {t("live.agentsShort")}
        {workingCount > 0
          ? ` · ${workingCount} ${t("live.workingShort")}`
          : null}
      </span>

      {insights ? (
        <>
          <span className="text-border mx-0.5">|</span>
          <span className={chip}>{insights.totalRuns} {t("live.stats.totalRuns")}</span>
          <span
            className={cn(
              chip,
              insights.successRate >= 0.9
                ? "text-emerald-700 dark:text-emerald-400"
                : insights.successRate >= 0.7
                  ? "text-amber-700 dark:text-amber-400"
                  : "text-rose-700 dark:text-rose-400",
            )}
          >
            {Math.round(insights.successRate * 100)}%
          </span>
          {insights.totalCostUsd > 0 ? (
            <span className={chip}>${insights.totalCostUsd.toFixed(2)}</span>
          ) : null}
        </>
      ) : null}

      {onRefresh ? (
        <button
          type="button"
          onClick={onRefresh}
          title={t("map.refresh")}
          aria-label={t("map.refresh")}
          className="ml-auto inline-flex size-5 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors shrink-0"
        >
          <RefreshCw className={cn("size-3", refreshing && "animate-spin")} />
        </button>
      ) : null}
    </div>
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
  lastRunByAgent,
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
  lastRunByAgent: Map<string, Run>;
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
      className="grid gap-3 mb-4"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}
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
          lastRun={lastRunByAgent.get(a.id) ?? null}
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
  lastRun,
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
  lastRun: Run | null;
  thread: Thread | null;
  inActiveThread: boolean;
  threadWorking: boolean;
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
        "group relative rounded-xl p-4 transition-all",
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
        ) : lastRun ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground/60">
            <span>
              {lastRun.status === "succeeded" ? "✓" : lastRun.status === "failed" ? "✗" : "—"}
            </span>
            <span className="truncate">
              {t("live.lastActive", { time: formatTimeAgo(lastRun.endedAt ?? lastRun.createdAt, t) })}
            </span>
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

type StreamItem =
  | {
      kind: "tool";
      key: string;
      ts: string;
      agent: Agent;
      name: string;
      target: string | null;
    }
  | {
      kind: "delegation";
      key: string;
      ts: string;
      agent: Agent;
      targetAgentName: string | null;
      taskDescription: string;
      status: Delegation["status"];
    };

function Stream({
  stream,
  onPickFile,
  onPickAgent,
}: {
  stream: StreamItem[];
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
        {stream.map((item, idx) =>
          item.kind === "tool" ? (
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
          ) : (
            <DelegationRow
              key={item.key}
              ts={item.ts}
              agent={item.agent}
              targetAgentName={item.targetAgentName}
              taskDescription={item.taskDescription}
              status={item.status}
              recent={idx < 3}
              onPickAgent={onPickAgent}
            />
          ),
        )}
      </ul>
    </section>
  );
}

function DelegationRow({
  ts,
  agent,
  targetAgentName,
  taskDescription,
  status,
  recent,
  onPickAgent,
}: {
  ts: string;
  agent: Agent;
  targetAgentName: string | null;
  taskDescription: string;
  status: Delegation["status"];
  recent: boolean;
  onPickAgent: (id: string) => void;
}) {
  const { t } = useI18n();
  const cls = classesFor(agentColorOf(agent));
  const statusLabel =
    status === "pending"
      ? t("live.delegation.pending")
      : status === "running"
        ? t("live.delegation.running")
        : status === "succeeded"
          ? t("live.delegation.succeeded")
          : t("live.delegation.failed");
  const statusColor =
    status === "succeeded"
      ? "text-emerald-700 dark:text-emerald-400"
      : status === "failed"
        ? "text-rose-700 dark:text-rose-400"
        : "text-amber-700 dark:text-amber-400";
  return (
    <li className="group flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-foreground/[0.03] transition-colors">
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full shrink-0",
          recent ? "bg-violet-500" : "bg-violet-500/40",
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
      <span className="text-xs mono text-foreground/80 shrink-0 inline-flex items-center gap-1">
        <span aria-hidden>⤳</span>
        <span>{t("live.delegation.delegated")}</span>
      </span>
      {targetAgentName ? (
        <span className="text-[11px] font-medium text-foreground/85 shrink-0">
          @{targetAgentName}
        </span>
      ) : null}
      <span
        className="text-[11px] mono text-muted-foreground truncate min-w-0"
        title={taskDescription}
      >
        "{taskDescription}"
      </span>
      <span
        className={cn(
          "ml-auto text-[10px] mono shrink-0",
          statusColor,
        )}
      >
        {statusLabel}
      </span>
    </li>
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

// ──────────────────────────────────────────────────────────────────────────
// GitPanel — tabbed panel: Commits | Branches | Contributors.
// ──────────────────────────────────────────────────────────────────────────

type GitTab = "commits" | "branches" | "contributors";

function GitPanel({
  projectId,
  commits,
  gitStatus: externalStatus,
}: {
  projectId: string;
  commits: Array<{
    sha: string;
    shortSha: string;
    authorName: string;
    authorEmail: string;
    authoredAt: string;
    subject: string;
    refs: string[];
  }>;
  gitStatus: GitStatus | null;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [tab, setTab] = useState<GitTab>("commits");

  const branchesQuery = useQuery({
    queryKey: ["gitBranches", projectId],
    queryFn: () => api.getGitBranches(projectId),
    enabled: !!projectId,
    staleTime: 30_000,
  });
  const collabQuery = useQuery({
    queryKey: ["gitCollaborators", projectId],
    queryFn: () => api.getGitCollaborators(projectId),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });

  const branches = branchesQuery.data?.branches ?? [];
  const collaborators = collabQuery.data?.collaborators ?? [];
  const status = externalStatus;
  const localBranches = branches.filter((b) => b.kind === "local");

  const changedFiles = useMemo(() => {
    if (!status) return [];
    const files: { path: string; status: string; group: "staged" | "unstaged" | "untracked" }[] = [];
    for (const f of status.staged) files.push({ path: f.path, status: f.status, group: "staged" });
    for (const f of status.unstaged) files.push({ path: f.path, status: f.status, group: "unstaged" });
    for (const p of status.untracked) files.push({ path: p, status: "?", group: "untracked" });
    return files;
  }, [status]);

  const tabs: { key: GitTab; label: string; count: number }[] = [
    { key: "commits", label: t("git.tab.commits"), count: commits.length },
    { key: "branches", label: t("git.tab.branches"), count: localBranches.length },
    { key: "contributors", label: t("git.tab.contributors"), count: collaborators.length },
  ];

  const warnings = useMemo(() => {
    if (!status) return [];
    const w: { key: string; level: "warn" | "error"; msg: string }[] = [];
    if (status.conflicted.length > 0) {
      w.push({ key: "conflict", level: "error", msg: t("git.warn.conflict", { n: status.conflicted.length }) });
    }
    if (status.behind && status.ahead) {
      w.push({ key: "diverged", level: "warn", msg: t("git.warn.diverged", { ahead: status.ahead, behind: status.behind }) });
    } else if (status.behind) {
      w.push({ key: "behind", level: "warn", msg: t("git.warn.behind", { n: status.behind }) });
    }
    return w;
  }, [status, t]);

  const goGit = () => navigate(`/projects/${projectId}/git`);

  return (
    <section className="rounded-xl bg-card/40 ring-1 ring-foreground/5 overflow-hidden mt-4">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40">
        <GitBranch className="size-3.5 text-muted-foreground shrink-0" />
        {status ? (
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="text-xs font-semibold text-foreground truncate">
              {status.branch ?? t("git.status.headDetached")}
            </span>
            <span
              className={cn("size-1.5 rounded-full shrink-0", status.clean ? "bg-emerald-500" : "bg-amber-500")}
              title={status.clean ? t("git.status.clean") : t("git.status.dirty")}
            />
            {status.ahead ? (
              <span className="text-[10px] mono text-emerald-600 dark:text-emerald-400 shrink-0 inline-flex items-center">
                <ArrowUp className="size-2.5" />{status.ahead}
              </span>
            ) : null}
            {status.behind ? (
              <span className="text-[10px] mono text-rose-600 dark:text-rose-400 shrink-0 inline-flex items-center">
                <ArrowDown className="size-2.5" />{status.behind}
              </span>
            ) : null}
          </div>
        ) : (
          <span className="text-[11px] text-muted-foreground flex-1">{t("common.loading")}</span>
        )}
        <button
          type="button"
          onClick={goGit}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        >
          {t("git.openManager")}
          <ArrowRight className="size-3" />
        </button>
      </div>

      {/* Warnings */}
      {warnings.length > 0 ? (
        <div className="px-3 py-1.5 space-y-1 border-b border-border/40">
          {warnings.map((w) => (
            <div
              key={w.key}
              className={cn(
                "flex items-start gap-1.5 px-2.5 py-1.5 rounded-md text-[10.5px]",
                w.level === "error"
                  ? "bg-rose-500/10 text-rose-700 dark:text-rose-400"
                  : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
              )}
            >
              <span className="shrink-0">!</span>
              <span>{w.msg}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* 2-column body */}
      <div className="flex min-h-0" style={{ maxHeight: 320 }}>
        {/* Left: working tree changes */}
        <div className="w-56 shrink-0 border-r border-border/40 flex flex-col overflow-hidden">
          <div className="px-3 py-2 flex items-center justify-between">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("git.workingTree")}
            </h4>
            {changedFiles.length > 0 ? (
              <span className="text-[10px] mono text-amber-600 dark:text-amber-400">
                {changedFiles.length}
              </span>
            ) : null}
          </div>
          <div className="flex-1 overflow-y-auto">
            {changedFiles.length === 0 ? (
              <p className="px-3 py-2 text-[10.5px] text-muted-foreground/50">
                {t("git.workingTree.clean")}
              </p>
            ) : (
              <ul className="px-1 pb-1 space-y-px">
                {changedFiles.map((f) => (
                  <li key={`${f.group}-${f.path}`}>
                    <button
                      type="button"
                      onClick={goGit}
                      className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-left text-[11px] hover:bg-foreground/[0.04] transition-colors"
                      title={`${f.path} — ${t("git.clickToDiff")}`}
                    >
                      <span
                        className={cn(
                          "size-4 inline-flex items-center justify-center mono text-[10px] shrink-0",
                          f.group === "staged"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : f.status === "M"
                              ? "text-amber-600 dark:text-amber-400"
                              : f.status === "D"
                                ? "text-rose-600 dark:text-rose-400"
                                : "text-emerald-600 dark:text-emerald-400",
                        )}
                      >
                        {f.group === "untracked" ? "U" : f.status}
                      </span>
                      <span className="truncate text-foreground/80">{basename(f.path)}</span>
                      {f.group === "staged" ? (
                        <span className="ml-auto text-[9px] mono text-emerald-600 dark:text-emerald-400 shrink-0">S</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right: tabbed content */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <div className="flex items-center gap-0.5 px-3 border-b border-border/40 shrink-0">
            {tabs.map(({ key, label, count }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "px-2.5 py-1.5 text-[10.5px] font-medium transition-colors border-b-2 -mb-px",
                  tab === key
                    ? "border-foreground/60 text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground/80",
                )}
              >
                {label}
                {count > 0 ? (
                  <span className="ml-1 text-muted-foreground/50">{count}</span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {tab === "commits" ? (
              <CommitList commits={commits} />
            ) : tab === "branches" ? (
              <BranchList branches={branches} currentBranch={status?.branch ?? null} />
            ) : (
              <ContributorList collaborators={collaborators} />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function CommitList({
  commits,
}: {
  commits: Array<{
    sha: string;
    shortSha: string;
    authorName: string;
    authoredAt: string;
    subject: string;
    refs: string[];
  }>;
}) {
  const { t } = useI18n();
  if (commits.length === 0) {
    return (
      <p className="p-4 text-[11px] text-muted-foreground/60">{t("git.empty.commits")}</p>
    );
  }
  return (
    <ul className="p-3 space-y-1.5">
      {commits.map((c) => (
        <li key={c.sha} className="flex items-start gap-2 text-[11px] rounded-lg hover:bg-foreground/[0.03] transition-colors px-1.5 py-1">
          <span className="mono text-muted-foreground/50 shrink-0 w-14 tabular-nums pt-px">
            {c.shortSha}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-foreground/85">{c.subject}</p>
            <p className="text-[10px] text-muted-foreground/50 truncate">
              {c.authorName} · {formatTimeAgo(c.authoredAt, t)}
              {c.refs.length > 0 ? (
                <>
                  {" · "}
                  {c.refs.slice(0, 2).map((r) => (
                    <span
                      key={r}
                      className="inline-block px-1 py-px rounded bg-sky-500/10 text-sky-700 dark:text-sky-400 text-[9px] mono mr-0.5"
                    >
                      {r}
                    </span>
                  ))}
                </>
              ) : null}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function BranchList({
  branches,
  currentBranch,
}: {
  branches: GitBranchInfo[];
  currentBranch: string | null;
}) {
  const { t } = useI18n();
  const local = branches.filter((b) => b.kind === "local");
  const remote = branches.filter((b) => b.kind === "remote");

  if (branches.length === 0) {
    return (
      <p className="p-4 text-[11px] text-muted-foreground/60">{t("git.empty.branches")}</p>
    );
  }

  return (
    <div className="p-3 space-y-3">
      {local.length > 0 ? (
        <div>
          <h4 className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold mb-1 px-1.5">
            {t("git.branches.local")}
          </h4>
          <ul className="space-y-px">
            {local.map((b) => (
              <li
                key={b.name}
                className={cn(
                  "flex items-center gap-2 text-[11px] px-1.5 py-1 rounded-lg transition-colors",
                  b.name === currentBranch
                    ? "bg-emerald-500/[0.06] text-foreground"
                    : "text-foreground/80 hover:bg-foreground/[0.03]",
                )}
              >
                <GitBranch className="size-3 text-muted-foreground/60 shrink-0" />
                <span className="mono truncate flex-1">{b.name}</span>
                {b.name === currentBranch ? (
                  <span className="text-[9px] mono text-emerald-600 dark:text-emerald-400 shrink-0 px-1 py-px rounded bg-emerald-500/10">
                    {t("git.branches.current")}
                  </span>
                ) : null}
                {b.upstream ? (
                  <span className="text-[9px] mono text-muted-foreground/40 shrink-0 truncate max-w-24">
                    {b.upstream}
                  </span>
                ) : null}
                <span className="mono text-muted-foreground/40 text-[10px] shrink-0 w-14 text-right tabular-nums">
                  {b.head.slice(0, 7)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {remote.length > 0 ? (
        <div>
          <h4 className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold mb-1 px-1.5">
            {t("git.branches.remote")}
          </h4>
          <ul className="space-y-px">
            {remote.map((b) => (
              <li
                key={b.name}
                className="flex items-center gap-2 text-[11px] px-1.5 py-1 rounded-lg text-muted-foreground/60 hover:bg-foreground/[0.03] transition-colors"
              >
                <GitBranch className="size-3 shrink-0" />
                <span className="mono truncate flex-1">{b.name}</span>
                <span className="mono text-muted-foreground/40 text-[10px] shrink-0 w-14 text-right tabular-nums">
                  {b.head.slice(0, 7)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ContributorList({
  collaborators,
}: {
  collaborators: GitCollaborator[];
}) {
  const { t } = useI18n();

  if (collaborators.length === 0) {
    return (
      <p className="p-4 text-[11px] text-muted-foreground/60">{t("git.empty.contributors")}</p>
    );
  }

  return (
    <ul className="p-3 space-y-0.5">
      {collaborators.map((c) => (
        <li
          key={c.email}
          className="flex items-center gap-2.5 px-1.5 py-1.5 rounded-lg hover:bg-foreground/[0.03] transition-colors"
        >
          <span className="inline-flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground/70 shrink-0 uppercase">
            {c.name.charAt(0)}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[11.5px] font-medium text-foreground/90 truncate">{c.name}</p>
            <p className="text-[10px] mono text-muted-foreground/50 truncate">{c.email}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[11px] mono tabular-nums text-foreground/70">
              {c.commitCount} {t("git.contributor.commits")}
            </p>
            <p className="text-[10px] mono text-muted-foreground/50">
              {formatTimeAgo(c.lastCommitAt, t)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Recent Runs — completed run history.
// ──────────────────────────────────────────────────────────────────────────

function RecentRuns({
  runs,
  agents,
  onPickAgent,
}: {
  runs: Run[];
  agents: Agent[];
  onPickAgent: (id: string) => void;
}) {
  const { t } = useI18n();
  if (runs.length === 0) return null;

  const agentMap = new Map(agents.map((a) => [a.id, a]));

  return (
    <section className="rounded-xl bg-card/40 ring-1 ring-foreground/5 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="size-3.5 text-muted-foreground" />
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("live.recentRuns")}
        </h3>
      </div>
      <ul className="space-y-0.5">
        {runs.map((r) => {
          const agent = agentMap.get(r.agentId);
          return (
            <li
              key={r.id}
              className="flex items-center gap-2 py-1.5 rounded-lg hover:bg-foreground/[0.03] transition-colors px-1.5"
            >
              <span className="shrink-0 text-xs">
                {r.status === "succeeded" ? (
                  <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                ) : r.status === "failed" ? (
                  <span className="text-rose-600 dark:text-rose-400">✗</span>
                ) : (
                  <span className="text-muted-foreground">⊘</span>
                )}
              </span>
              {agent ? (
                <button
                  type="button"
                  onClick={() => onPickAgent(agent.id)}
                  className="text-[11px] font-medium text-foreground/80 hover:underline shrink-0"
                >
                  @{agent.name}
                </button>
              ) : null}
              <span
                className="text-[11px] mono text-muted-foreground/70 truncate min-w-0 flex-1"
                title={r.prompt}
              >
                &ldquo;{r.prompt.slice(0, 60)}
                {r.prompt.length > 60 ? "…" : ""}&rdquo;
              </span>
              <span className="text-[10px] mono text-muted-foreground/50 shrink-0 tabular-nums">
                {formatTimeAgo(r.endedAt ?? r.createdAt, t)}
              </span>
              {r.costUsd != null ? (
                <span className="text-[10px] mono text-muted-foreground/50 shrink-0 tabular-nums">
                  ${r.costUsd.toFixed(2)}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Hot Files — most-touched files from insights.
// ──────────────────────────────────────────────────────────────────────────

function HotFiles({
  files,
  onPickFile,
}: {
  files: Array<{
    path: string;
    touches: number;
    additions: number;
    deletions: number;
  }>;
  onPickFile: (path: string) => void;
}) {
  const { t } = useI18n();
  if (files.length === 0) return null;

  return (
    <section className="rounded-xl bg-card/40 ring-1 ring-foreground/5 p-4">
      <div className="flex items-center gap-2 mb-3">
        <FileCode className="size-3.5 text-muted-foreground" />
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("live.hotFiles")}
        </h3>
      </div>
      <ul className="space-y-0.5">
        {files.slice(0, 8).map((f) => (
          <li
            key={f.path}
            className="flex items-center gap-2 py-1 rounded-lg hover:bg-foreground/[0.03] transition-colors px-1.5"
          >
            <button
              type="button"
              onClick={() => onPickFile(f.path)}
              className="text-[11px] mono text-foreground/80 hover:text-foreground hover:underline truncate min-w-0 flex-1 text-left"
              title={f.path}
            >
              {basename(f.path)}
            </button>
            <span className="text-[10px] mono text-muted-foreground/50 shrink-0 tabular-nums">
              {t("live.hotFiles.touches", { n: f.touches })}
            </span>
            <span className="text-[10px] mono text-emerald-600 dark:text-emerald-400 shrink-0 tabular-nums">
              +{f.additions}
            </span>
            <span className="text-[10px] mono text-rose-600 dark:text-rose-400 shrink-0 tabular-nums">
              −{f.deletions}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
