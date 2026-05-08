// LiveView — Devin 풍 활동 피드.
//
// "사무실/회의실/맵" 같은 공간 메타포 다 폐기. 본인이 진짜 보는 건 *각 에이전트가
// 지금 뭐 하고 있는지* 의 정보. 이 view 가 그것만 한다.
//
// 레이아웃:
//   ┌─ 세션 리스트 ─┐  ┌─ 선택된 에이전트의 활동 피드 ────┐
//   │ ● @arch       │  │ ⏳ 지금 뭐 하는지 (Currently)    │
//   │   editing foo │  │                                  │
//   │ ◯ @coder      │  │ ──── 최근 활동 ────              │
//   │   idle        │  │ 10:34  📖 Read foo.ts            │
//   │ ◯ @rev        │  │ 10:34  ⚡ Bash npm test           │
//   │   editing plan│  │ ...                              │
//   └───────────────┘  └──────────────────────────────────┘
//
// 회의실의 모든 픽셀/캐릭터/벽/책상/게시판 폐기. 단순함이 미덕.

import { useMemo, useState } from "react";
import {
  ChevronRight,
  Loader2,
  RefreshCw,
  Wrench,
} from "lucide-react";
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
  if (working && tool?.recent.length) return "tooling";
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
  const { t } = useI18n();

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

  // 선택 default — 일하는 사람 우선, 없으면 첫 에이전트.
  const [explicit, setExplicit] = useState<string | null>(null);
  const autoSelected = useMemo(() => {
    if (explicit && agents.some((a) => a.id === explicit)) return explicit;
    const working = agents.find((a) => workingIds.has(a.id));
    if (working) return working.id;
    return agents[0]?.id ?? null;
  }, [explicit, agents, workingIds]);

  // 외부에서 selectedAgentId 가 변경되면 (다른 panel 클릭 등) 따라가도 됨 — 일단 내부 상태만.
  const selected = useMemo(
    () => agents.find((a) => a.id === autoSelected) ?? null,
    [agents, autoSelected],
  );

  if (agents.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground italic">
        {t("live.empty")}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <Header
        projectName={projectName}
        onRefresh={onRefresh}
        refreshing={refreshing}
      />

      <div className="flex-1 min-h-0 flex">
        <SessionList
          agents={agents}
          workingIds={workingIds}
          touchingIds={touchingIds}
          fileByAgent={fileByAgent}
          toolByAgent={toolByAgent}
          adapterByKind={adapterByKind}
          threadByAgent={threadByAgent}
          activeThreadId={activeThreadId}
          selectedId={selected?.id ?? null}
          onSelect={(id) => setExplicit(id)}
          onPickAgent={onPickAgent}
        />

        <ActivityFeed
          agent={selected}
          manifest={selected ? adapterByKind[selected.adapterKind] : undefined}
          working={selected ? workingIds.has(selected.id) : false}
          touching={selected ? touchingIds.has(selected.id) : false}
          file={selected ? (fileByAgent.get(selected.id) ?? null) : null}
          tool={selected ? (toolByAgent.get(selected.id) ?? null) : null}
          threadId={selected ? (threadByAgent.get(selected.id) ?? null) : null}
          threads={threadList}
          workingThreadIds={workingThreadIds}
          onPickFile={onPickFile}
          onPickAgent={onPickAgent}
          onPickThread={onPickThread}
        />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 헤더 — 단순.
// ──────────────────────────────────────────────────────────────────────────

function Header({
  projectName,
  onRefresh,
  refreshing,
}: {
  projectName: string;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const { t } = useI18n();
  return (
    <header className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-border bg-muted/20">
      <span className="text-sm font-semibold truncate" title={projectName}>
        {projectName}
        <span className="text-muted-foreground/70 font-normal ml-2">
          · {t("live.label")}
        </span>
      </span>
      {onRefresh ? (
        <button
          type="button"
          onClick={onRefresh}
          title={t("map.refresh")}
          aria-label={t("map.refresh")}
          className="ml-auto inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        >
          <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
        </button>
      ) : null}
    </header>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 세션 리스트 — 좌측 사이드.
// ──────────────────────────────────────────────────────────────────────────

function SessionList({
  agents,
  workingIds,
  touchingIds,
  fileByAgent,
  toolByAgent,
  adapterByKind,
  threadByAgent,
  activeThreadId,
  selectedId,
  onSelect,
}: {
  agents: Agent[];
  workingIds: Set<string>;
  touchingIds: Set<string>;
  fileByAgent: Map<string, string>;
  toolByAgent: Map<string, ActiveToolsForAgent>;
  adapterByKind: Record<string, AdapterManifest>;
  threadByAgent: Map<string, string>;
  activeThreadId: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPickAgent: (id: string) => void;
}) {
  const { t } = useI18n();
  // 정렬: working > touching > 알파벳.
  const sorted = useMemo(() => {
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

  return (
    <aside className="w-64 shrink-0 border-r border-border overflow-y-auto bg-card/30">
      <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        {t("live.sessions")} · {agents.length}
      </div>
      <ul>
        {sorted.map((a) => {
          const working = workingIds.has(a.id);
          const touching = touchingIds.has(a.id);
          const file = fileByAgent.get(a.id) ?? null;
          const tool = toolByAgent.get(a.id) ?? null;
          const state = liveStateOf(working, file, tool);
          const selected = a.id === selectedId;
          const inActiveThread =
            threadByAgent.get(a.id) === activeThreadId &&
            activeThreadId !== null;
          const cls = classesFor(agentColorOf(a));
          const manifest = adapterByKind[a.adapterKind];

          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onSelect(a.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors border-l-2 border-transparent",
                  selected
                    ? "bg-foreground/[0.06] border-l-foreground"
                    : "hover:bg-muted/40",
                )}
              >
                <span
                  className={cn(
                    "relative inline-flex size-8 items-center justify-center rounded-md border bg-card shrink-0",
                    cls.border,
                  )}
                >
                  {manifest ? (
                    <AdapterIcon manifest={manifest} size={22} />
                  ) : (
                    <span className={cn("text-xs font-semibold", cls.text)}>
                      {a.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  {/* 우하단 상태 dot */}
                  <span
                    aria-hidden
                    className={cn(
                      "absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-card",
                      working
                        ? "bg-emerald-500 animate-pulse"
                        : "bg-muted-foreground/30",
                    )}
                  />
                </span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className={cn("text-[12px] font-medium truncate", cls.text)}>
                      @{a.name}
                    </span>
                    {inActiveThread ? (
                      <ChevronRight className="size-3 text-muted-foreground/60 shrink-0" />
                    ) : null}
                  </div>
                  <div className="text-[10.5px] text-muted-foreground truncate mono">
                    <SessionStateLine
                      state={state}
                      file={file}
                      tool={tool}
                      touching={touching}
                    />
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function SessionStateLine({
  state,
  file,
  tool,
  touching,
}: {
  state: LiveState;
  file: string | null;
  tool: ActiveToolsForAgent | null;
  touching: boolean;
}) {
  const { t } = useI18n();
  if (state === "editing" && file) {
    return (
      <span className={touching ? "text-emerald-700 dark:text-emerald-400" : ""}>
        ✎ {basename(file)}
      </span>
    );
  }
  if (state === "tooling" && tool) {
    const latest = tool.recent[tool.recent.length - 1];
    if (latest) {
      return (
        <span>
          {toolIcon(latest.name)} {latest.name}
        </span>
      );
    }
  }
  if (state === "thinking") {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="size-1 rounded-full bg-emerald-500 animate-pulse" />
        {t("live.state.thinking")}
      </span>
    );
  }
  return <span className="opacity-60">{t("live.state.idle")}</span>;
}

// ──────────────────────────────────────────────────────────────────────────
// 활동 피드 — 우측 메인.
// ──────────────────────────────────────────────────────────────────────────

function ActivityFeed({
  agent,
  manifest,
  working,
  touching,
  file,
  tool,
  threadId,
  threads,
  workingThreadIds,
  onPickFile,
  onPickAgent,
  onPickThread,
}: {
  agent: Agent | null;
  manifest: AdapterManifest | undefined;
  working: boolean;
  touching: boolean;
  file: string | null;
  tool: ActiveToolsForAgent | null;
  threadId: string | null;
  threads: Thread[];
  workingThreadIds: Set<string>;
  onPickFile: (path: string) => void;
  onPickAgent: (id: string) => void;
  onPickThread: (id: string) => void;
}) {
  const { t } = useI18n();

  if (!agent) {
    return (
      <main className="flex-1 min-w-0 flex items-center justify-center text-sm text-muted-foreground italic">
        {t("live.selectAgent")}
      </main>
    );
  }

  const cls = classesFor(agentColorOf(agent));
  const state = liveStateOf(working, file, tool);
  const currentThread = threads.find((th) => th.id === threadId) ?? null;

  return (
    <main className="flex-1 min-w-0 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-5">
        {/* 에이전트 헤더 */}
        <div className="flex items-center gap-3 mb-4">
          <button
            type="button"
            onClick={() => onPickAgent(agent.id)}
            className={cn(
              "relative inline-flex size-12 items-center justify-center rounded-lg border bg-card shadow-sm hover:shadow transition-shadow",
              cls.border,
            )}
            title={`${t("room.talk")} @${agent.name}`}
          >
            {manifest ? (
              <AdapterIcon manifest={manifest} size={32} />
            ) : (
              <span className={cn("text-base font-semibold", cls.text)}>
                {agent.name.slice(0, 1).toUpperCase()}
              </span>
            )}
          </button>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h2 className={cn("text-lg font-semibold", cls.text)}>
                @{agent.name}
              </h2>
              {agent.role ? (
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                  {agent.role}
                </span>
              ) : null}
            </div>
            <div className="text-xs text-muted-foreground mono">
              {manifest?.displayName ?? agent.adapterKind}
              {currentThread ? (
                <>
                  {" "}
                  ·{" "}
                  <button
                    type="button"
                    onClick={() => onPickThread(currentThread.id)}
                    className="hover:text-foreground hover:underline"
                  >
                    in {currentThread.name ?? t("thread.untitled")}
                  </button>
                  {workingThreadIds.has(currentThread.id) ? (
                    <span className="ml-1 inline-block size-1.5 rounded-full bg-emerald-500 animate-pulse align-middle" />
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </div>

        {/* Currently 카드 */}
        <CurrentlyCard
          state={state}
          working={working}
          touching={touching}
          file={file}
          tool={tool}
          colorClass={cls}
          onPickFile={onPickFile}
        />

        {/* 최근 활동 */}
        <RecentActivity tool={tool} onPickFile={onPickFile} />
      </div>
    </main>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Currently 카드 — 지금 뭐 하는지.
// ──────────────────────────────────────────────────────────────────────────

function CurrentlyCard({
  state,
  working,
  touching,
  file,
  tool,
  colorClass,
  onPickFile,
}: {
  state: LiveState;
  working: boolean;
  touching: boolean;
  file: string | null;
  tool: ActiveToolsForAgent | null;
  colorClass: ReturnType<typeof classesFor>;
  onPickFile: (path: string) => void;
}) {
  const { t } = useI18n();
  const latest = tool?.recent[tool.recent.length - 1];

  return (
    <div
      className={cn(
        "rounded-md border bg-card p-4 mb-6 transition-colors",
        working ? "border-emerald-500/40 bg-emerald-500/[0.03]" : "border-border",
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        {working ? (
          <Loader2 className="size-3.5 text-emerald-500 animate-spin" />
        ) : (
          <span className="size-2 rounded-full bg-muted-foreground/30" />
        )}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {working ? t("live.now") : t("live.lastSeen")}
        </span>
      </div>

      {state === "editing" && file ? (
        <div>
          <div className="text-base font-semibold mb-1">
            {touching ? t("live.now.editing") : t("live.now.had_file")}
          </div>
          <button
            type="button"
            onClick={() => onPickFile(file)}
            className={cn(
              "inline-flex items-center gap-1.5 px-2 py-1 rounded mono text-xs hover:bg-muted/60 transition-colors border",
              colorClass.bgSoft,
              colorClass.border,
            )}
          >
            <span>✎</span>
            <span className="truncate max-w-[400px]">{file}</span>
          </button>
        </div>
      ) : state === "tooling" && latest ? (
        <div>
          <div className="text-base font-semibold mb-1">
            {t("live.now.using_tool")}
          </div>
          <div className="inline-flex items-center gap-2 px-2 py-1 rounded bg-muted/50 mono text-xs">
            <Wrench className="size-3 text-muted-foreground" />
            <span>{toolIcon(latest.name)}</span>
            <span className="font-medium">{latest.name}</span>
            {latest.target ? (
              <span className="text-muted-foreground truncate max-w-[300px]">
                · {latest.target}
              </span>
            ) : null}
          </div>
        </div>
      ) : state === "thinking" ? (
        <div>
          <div className="text-base font-semibold mb-1">
            {t("live.now.thinking")}
          </div>
          <div className="text-xs text-muted-foreground">
            {t("live.now.thinking_hint")}
          </div>
        </div>
      ) : (
        <div>
          <div className="text-base font-semibold text-muted-foreground/80 mb-1">
            {t("live.now.idle")}
          </div>
          <div className="text-xs text-muted-foreground/70">
            {t("live.now.idle_hint")}
          </div>
        </div>
      )}

      {/* 진행 progress bar — working 시. */}
      {working ? (
        <div className="mt-3 h-0.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-emerald-500/60"
            style={{
              animation: "live-scan 1.8s ease-in-out infinite",
              width: "30%",
            }}
          />
        </div>
      ) : null}
      <style>{`
        @keyframes live-scan {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
      `}</style>

      {/* MCP 서버 chip — 있으면. */}
      {tool && tool.mcpServers.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {tool.mcpServers.slice(0, 5).map((s) => (
            <span
              key={s}
              className="inline-flex items-center px-1.5 h-4 rounded text-[10px] mono bg-violet-500/10 text-violet-700 dark:text-violet-300"
            >
              🔌 {s}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 최근 활동 — tool.recent 를 chronological 로.
// ──────────────────────────────────────────────────────────────────────────

function RecentActivity({
  tool,
  onPickFile,
}: {
  tool: ActiveToolsForAgent | null;
  onPickFile: (path: string) => void;
}) {
  const { t } = useI18n();
  const ref = useAutoAnimate<HTMLUListElement>({ duration: 200, easing: "ease-out" });
  const recent = useMemo(() => {
    if (!tool) return [] as ActiveToolsForAgent["recent"];
    return [...tool.recent].reverse();
  }, [tool]);

  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("live.recent")}
        </h3>
        <span className="text-[10px] text-muted-foreground/60">
          {recent.length > 0 ? `· ${recent.length} actions` : ""}
        </span>
      </div>
      {recent.length === 0 ? (
        <div className="text-sm text-muted-foreground/60 italic px-1">
          {t("live.recent.empty")}
        </div>
      ) : (
        <ul ref={ref} className="space-y-0.5">
          {recent.map((r, i) => (
            <FeedRow
              key={`${r.ts}-${i}-${r.name}`}
              ts={r.ts}
              name={r.name}
              target={r.target ?? null}
              onPickFile={onPickFile}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function FeedRow({
  ts,
  name,
  target,
  onPickFile,
}: {
  ts: string;
  name: string;
  target: string | null;
  onPickFile: (path: string) => void;
}) {
  const { t } = useI18n();
  // target 이 절대/상대 path 로 보이면 클릭으로 파일 열기. heuristic 단순.
  const isPath =
    !!target &&
    (target.startsWith("/") || target.includes("/") || target.includes("."));
  const display = name.startsWith("mcp__")
    ? `🔌 ${name.split("__").slice(1).join(" · ")}`
    : `${toolIcon(name)} ${name}`;

  return (
    <li className="group flex items-baseline gap-2 px-1 py-1 rounded hover:bg-muted/30 transition-colors">
      <span className="text-[10px] mono text-muted-foreground/60 w-14 shrink-0 tabular-nums">
        {formatTimeAgo(ts, t)}
      </span>
      <span className="text-xs mono text-foreground/90">{display}</span>
      {target ? (
        isPath ? (
          <button
            type="button"
            onClick={() => onPickFile(target)}
            className="text-[11px] mono text-muted-foreground hover:text-foreground hover:underline truncate"
            title={target}
          >
            {basename(target)}
          </button>
        ) : (
          <span
            className="text-[11px] mono text-muted-foreground truncate"
            title={target}
          >
            {target}
          </span>
        )
      ) : null}
    </li>
  );
}
