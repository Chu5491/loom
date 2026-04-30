import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, NavLink, useParams } from "react-router-dom";
import {
  Archive,
  CheckCircle2,
  ChevronRight,
  Clock,
  GitBranch,
  Plus,
} from "lucide-react";
import type { Run, Thread } from "@loom/core";
import { api } from "../api/client.js";
import { AdapterIcon } from "./AdapterIcon.js";
import { AgentAvatar } from "./Chat.js";
import { FilesTree } from "./FilesTree.js";
import { LoomLogo } from "./LoomLogo.js";
import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";
import { useI18n } from "../context/I18nContext.js";
import {
  useTheme,
  type ThemeMode,
} from "../context/ThemeContext.js";
import {
  LANG_NAMES,
  SUPPORTED_LANGS,
  type Lang,
} from "../i18n/dictionaries.js";
import { cn } from "../lib/utils.js";
import { agentColorOf, classesFor } from "./agentColor.js";
import type { ActivityKind } from "./ActivityBar.js";

/** Side panel that holds whichever activity is selected. Closes
 *  entirely when nothing is selected so the main content takes the
 *  freed width. */
export function ActivityPanel({
  activity,
  width,
  onResize,
}: {
  activity: ActivityKind;
  width: number;
  onResize: (next: number) => void;
}) {
  if (activity === null) return null;

  return (
    <aside
      className="hidden md:flex shrink-0 flex-col border-r border-border bg-muted/40 relative"
      style={{ width }}
    >
      <ActivityContent activity={activity} />
      <PanelResizer width={width} onChange={onResize} />
    </aside>
  );
}

function ActivityContent({ activity }: { activity: ActivityKind }) {
  switch (activity) {
    case "projects":
      return <ProjectsActivity />;
    case "files":
      return <FilesActivity />;
    case "threads":
      return <ThreadsActivity />;
    case "agents":
      return <AgentsActivity />;
    case "skills":
      return <SkillsActivity />;
    case "review":
      return <ReviewActivity />;
    case "history":
      return <HistoryActivity />;
    case "settings":
      return <SettingsActivity />;
    default:
      return null;
  }
}

const PANEL_MIN_WIDTH = 200;
const PANEL_MAX_WIDTH = 480;

function PanelResizer({
  width,
  onChange,
}: {
  width: number;
  onChange: (next: number) => void;
}) {
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const next = Math.min(
        PANEL_MAX_WIDTH,
        Math.max(PANEL_MIN_WIDTH, startWidth + dx),
      );
      onChange(next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onMouseDown={onMouseDown}
      className="absolute right-0 top-0 bottom-0 z-10 w-1.5 -mr-0.5 cursor-col-resize group"
    >
      <span
        aria-hidden
        className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-px bg-transparent group-hover:bg-foreground/25 transition-colors"
      />
    </div>
  );
}

function PanelHeader({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 border-b shrink-0">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </span>
      {action}
    </div>
  );
}

function NoProjectState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex items-center justify-center px-4 text-center">
      <p className="text-xs text-muted-foreground/70 italic">{message}</p>
    </div>
  );
}

function ManageFooter({ to, label }: { to: string; label: string }) {
  return (
    <div className="border-t border-border/60 shrink-0">
      <Link
        to={to}
        className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
      >
        <span>{label}</span>
        <ChevronRight className="size-3" />
      </Link>
    </div>
  );
}

function ProjectsActivity() {
  const { t } = useI18n();
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
  });
  const list = projects.data?.projects ?? [];
  return (
    <>
      <PanelHeader
        title={t("activity.projects")}
        action={
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="size-5 text-muted-foreground hover:text-foreground"
            title={t("sidebar.projects.new")}
          >
            <NavLink to="/projects" aria-label={t("sidebar.projects.new")}>
              <Plus className="size-3.5" />
            </NavLink>
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto subtle-scrollbar py-2 px-2">
        {list.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground/70 italic">
            {t("sidebar.projects.empty")}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {list.map((p) => (
              <li key={p.id}>
                <NavLink
                  to={`/projects/${p.id}`}
                  end={false}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center rounded-md px-2 py-1.5 text-sm transition-colors",
                      isActive
                        ? "bg-foreground text-background font-medium"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )
                  }
                >
                  <span className="truncate">{p.name}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function FilesActivity() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();
  const touched = useQuery({
    queryKey: ["projectTouched", projectId],
    queryFn: () => api.getProjectTouched(projectId!),
    enabled: !!projectId,
  });
  const agents = useQuery({
    queryKey: ["agents", { projectId }],
    queryFn: () => api.listAgents({ projectId }),
    enabled: !!projectId,
  });
  // Live "agent is editing this right now" map. Polls fast while the
  // panel is open so the file tree pulses in near-real-time as the CLI
  // stream emits tool_use events.
  const activeTouches = useQuery({
    queryKey: ["projectActiveTouches", projectId],
    queryFn: () => api.getProjectActiveTouches(projectId!),
    enabled: !!projectId,
    refetchInterval: 1500,
  });
  const touchedByAgent = new Map<string, string>(
    (touched.data?.paths ?? []).map((p) => [p.path, p.lastAgentId]),
  );
  // Active edits override past touches — if @frontend just started
  // editing main.tsx, the dot belongs to them, not whoever last did.
  const activeByPath = new Map<string, string>();
  for (const tch of activeTouches.data?.touches ?? []) {
    for (const p of tch.paths) {
      activeByPath.set(p, tch.agentId);
      touchedByAgent.set(p, tch.agentId);
    }
  }

  if (!projectId) {
    return (
      <>
        <PanelHeader title={t("activity.files")} />
        <NoProjectState message={t("activity.requiresProject")} />
      </>
    );
  }
  return (
    <>
      <PanelHeader title={t("activity.files")} />
      <div className="flex-1 overflow-y-auto overflow-x-hidden subtle-scrollbar">
        <FilesTree
          projectId={projectId}
          selectedPath={null}
          touched={touchedByAgent}
          activeByAgent={activeByPath}
          agents={agents.data?.agents ?? []}
          onPick={(path) => {
            // Workspace listens to this custom event and opens the file
            // tab — keeps the activity panel decoupled from workspace
            // internals (no shared state needed).
            window.dispatchEvent(
              new CustomEvent("loom:openFile", { detail: { path } }),
            );
          }}
        />
      </div>
    </>
  );
}

function ThreadsActivity() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const threads = useQuery({
    queryKey: ["threads", { projectId }],
    queryFn: () => api.listThreads({ projectId }),
    enabled: !!projectId,
  });
  const list = threads.data?.threads ?? [];

  const newThread = () => {
    window.dispatchEvent(new CustomEvent("loom:newThread"));
  };
  const newIsolated = useMutation({
    mutationFn: () =>
      api.createThread({
        projectId: projectId!,
        name: "Isolated thread",
        isolate: true,
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["threads", { projectId }] });
      window.dispatchEvent(
        new CustomEvent("loom:pickThread", {
          detail: { id: r.thread.id },
        }),
      );
    },
  });

  if (!projectId) {
    return (
      <>
        <PanelHeader title={t("activity.threads")} />
        <NoProjectState message={t("activity.requiresProject")} />
      </>
    );
  }
  return (
    <>
      <PanelHeader
        title={t("activity.threads")}
        action={
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => newIsolated.mutate()}
              title={t("thread.bar.newIsolatedThread")}
              aria-label={t("thread.bar.newIsolatedThread")}
              className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <GitBranch className="size-3" />
            </button>
            <button
              type="button"
              onClick={newThread}
              title={t("thread.bar.newThread")}
              aria-label={t("thread.bar.newThread")}
              className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto subtle-scrollbar py-1">
        {list.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground/70 italic">
            {t("thread.bar.empty")}
          </p>
        ) : (
          <ul className="space-y-px">
            {list.map((th) => (
              <li key={th.id}>
                <ThreadRow thread={th} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function ThreadRow({ thread }: { thread: Thread }) {
  const pick = () => {
    window.dispatchEvent(
      new CustomEvent("loom:pickThread", { detail: { id: thread.id } }),
    );
  };
  const StatusIcon =
    thread.status === "done"
      ? CheckCircle2
      : thread.status === "archived"
        ? Archive
        : null;
  return (
    <button
      type="button"
      onClick={pick}
      className="w-full flex items-start gap-2 px-3 py-1.5 text-left hover:bg-muted/50 transition-colors"
      title={thread.name}
    >
      {thread.worktreePath ? (
        <GitBranch className="size-3 shrink-0 mt-0.5 text-sky-600 dark:text-sky-400" />
      ) : StatusIcon ? (
        <StatusIcon className="size-3 shrink-0 mt-0.5 text-muted-foreground" />
      ) : (
        <span className="size-3 shrink-0 mt-1 inline-block rounded-full bg-foreground/30" />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm truncate">{thread.name}</div>
        <div className="text-[10px] text-muted-foreground/70 mono">
          {timeAgo(thread.updatedAt)}
        </div>
      </div>
    </button>
  );
}

function AgentsActivity() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();
  const agents = useQuery({
    queryKey: ["agents", { projectId }],
    queryFn: () => api.listAgents({ projectId }),
    enabled: !!projectId,
  });
  const adapters = useQuery({
    queryKey: ["adapters"],
    queryFn: api.listAdapters,
  });
  const runs = useQuery({
    queryKey: ["runs", { projectId, panel: "agents" }],
    queryFn: () => api.listRuns({ limit: 50 }),
    enabled: !!projectId,
    refetchInterval: 4000,
  });

  if (!projectId) {
    return (
      <>
        <PanelHeader title={t("activity.agents")} />
        <NoProjectState message={t("activity.requiresProject")} />
      </>
    );
  }

  const agentList = agents.data?.agents ?? [];
  const manifests = adapters.data?.adapters ?? [];
  const workingIds = new Set<string>();
  const latestActiveByAgent = new Map<string, Run>();
  for (const r of runs.data?.runs ?? []) {
    if (r.status === "running" || r.status === "queued") {
      workingIds.add(r.agentId);
      const cur = latestActiveByAgent.get(r.agentId);
      if (!cur || r.createdAt > cur.createdAt) {
        latestActiveByAgent.set(r.agentId, r);
      }
    }
  }

  return (
    <>
      <PanelHeader
        title={t("activity.agents")}
        action={
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="size-5 text-muted-foreground hover:text-foreground"
            title={t("chat.manageAgents")}
          >
            <Link
              to={`/projects/${projectId}/agents`}
              aria-label={t("chat.manageAgents")}
            >
              <Plus className="size-3.5" />
            </Link>
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto subtle-scrollbar py-1 min-h-0">
        {agentList.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground/70 italic">
            {t("topStrip.empty")}
          </p>
        ) : (
          <ul className="space-y-px">
            {agentList.map((a) => {
              const m = manifests.find((mm) => mm.kind === a.adapterKind);
              const cls = classesFor(agentColorOf(a));
              const working = workingIds.has(a.id);
              const active = latestActiveByAgent.get(a.id);
              return (
                <li key={a.id}>
                  <Link
                    to={`/projects/${projectId}/agents?edit=${a.id}`}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/50 transition-colors"
                  >
                    <AgentAvatar
                      agent={a}
                      manifest={m}
                      working={working}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn(
                          "text-sm font-medium truncate",
                          cls.text,
                        )}
                      >
                        @{a.name}
                      </div>
                      {working && active ? (
                        <div className="text-[10px] text-muted-foreground/80 mono">
                          ● running · {elapsedSecs(active)}s
                        </div>
                      ) : a.role ? (
                        <div className="text-[10px] text-muted-foreground/60">
                          {a.role}
                        </div>
                      ) : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <ManageFooter
        to={`/projects/${projectId}/agents`}
        label={t("activity.manage")}
      />
    </>
  );
}

function SkillsActivity() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();
  const specs = useQuery({
    queryKey: ["specs"],
    queryFn: () => api.listSpecs(),
    enabled: !!projectId,
  });

  if (!projectId) {
    return (
      <>
        <PanelHeader title={t("activity.skills")} />
        <NoProjectState message={t("activity.requiresProject")} />
      </>
    );
  }

  const list = specs.data?.specs ?? [];
  return (
    <>
      <PanelHeader
        title={t("activity.skills")}
        action={
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="size-5 text-muted-foreground hover:text-foreground"
            title={t("specs.new")}
          >
            <Link
              to={`/projects/${projectId}/skills/new`}
              aria-label={t("specs.new")}
            >
              <Plus className="size-3.5" />
            </Link>
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto subtle-scrollbar py-1 min-h-0">
        {list.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground/70 italic">
            {t("activity.skills.empty")}
          </p>
        ) : (
          <ul className="space-y-px">
            {list.map((s) => (
              <li key={s.id}>
                <Link
                  to={`/projects/${projectId}/skills/${s.id}`}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50 transition-colors"
                  title={s.name}
                >
                  <span className="size-1.5 shrink-0 rounded-full bg-foreground/30" />
                  <span className="text-sm truncate flex-1">{s.name}</span>
                  <span className="text-[10px] text-muted-foreground/60 mono shrink-0">
                    {(s.content.length / 1024).toFixed(1)}k
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ManageFooter
        to={`/projects/${projectId}/skills`}
        label={t("activity.manage")}
      />
    </>
  );
}

function ReviewActivity() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();
  const runs = useQuery({
    queryKey: ["runs", { projectId, panel: "review" }],
    queryFn: () => api.listRuns({ limit: 30 }),
    enabled: !!projectId,
    refetchInterval: 5000,
  });
  const agents = useQuery({
    queryKey: ["agents", { projectId }],
    queryFn: () => api.listAgents({ projectId }),
    enabled: !!projectId,
  });
  const adapters = useQuery({
    queryKey: ["adapters"],
    queryFn: api.listAdapters,
  });

  if (!projectId) {
    return (
      <>
        <PanelHeader title={t("activity.review")} />
        <NoProjectState message={t("activity.requiresProject")} />
      </>
    );
  }

  const agentIds = new Set((agents.data?.agents ?? []).map((a) => a.id));
  // Preview of recent runs that *could* have produced changes — the
  // full page filters more strictly (succeeded + has snapshots + has
  // file changes). Side panel just teases it.
  const candidates = (runs.data?.runs ?? [])
    .filter((r) => agentIds.has(r.agentId))
    .filter((r) => r.status === "succeeded" && r.beforeRef && r.afterRef)
    .slice(0, 12);
  const manifests = adapters.data?.adapters ?? [];

  return (
    <>
      <PanelHeader title={t("activity.review")} />
      <div className="flex-1 overflow-y-auto subtle-scrollbar py-1 min-h-0">
        {candidates.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground/70 italic">
            {t("review.empty")}
          </p>
        ) : (
          <ul className="divide-y divide-border/40">
            {candidates.map((r) => {
              const a = (agents.data?.agents ?? []).find(
                (x) => x.id === r.agentId,
              );
              const m = a
                ? manifests.find((mm) => mm.kind === a.adapterKind)
                : undefined;
              const cls = a ? classesFor(agentColorOf(a)) : null;
              return (
                <li key={r.id}>
                  <Link
                    to={`/projects/${projectId}/review`}
                    className="w-full flex items-start gap-2 px-3 py-2 hover:bg-muted/50 transition-colors"
                  >
                    {a ? (
                      <AgentAvatar agent={a} manifest={m} size="sm" />
                    ) : (
                      <span className="size-6 rounded-full bg-muted shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-1.5">
                        <span
                          className={cn(
                            "text-xs font-semibold truncate",
                            cls?.text ?? "text-foreground",
                          )}
                        >
                          @{a?.name ?? "—"}
                        </span>
                        <span className="text-[10px] text-muted-foreground/70 mono shrink-0">
                          {timeAgo(r.createdAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-1">
                        {r.prompt.slice(0, 100)}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <ManageFooter
        to={`/projects/${projectId}/review`}
        label={t("activity.manage")}
      />
    </>
  );
}

function HistoryActivity() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();
  const runs = useQuery({
    queryKey: ["runs", { projectId, panel: "history" }],
    queryFn: () => api.listRuns({ limit: 30 }),
    enabled: !!projectId,
    refetchInterval: 5000,
  });
  const agents = useQuery({
    queryKey: ["agents", { projectId }],
    queryFn: () => api.listAgents({ projectId }),
    enabled: !!projectId,
  });
  const adapters = useQuery({
    queryKey: ["adapters"],
    queryFn: api.listAdapters,
  });

  if (!projectId) {
    return (
      <>
        <PanelHeader title={t("activity.history")} />
        <NoProjectState message={t("activity.requiresProject")} />
      </>
    );
  }

  const agentIds = new Set((agents.data?.agents ?? []).map((a) => a.id));
  const runList = (runs.data?.runs ?? []).filter((r) => agentIds.has(r.agentId));
  const manifests = adapters.data?.adapters ?? [];

  return (
    <>
      <PanelHeader title={t("activity.history")} />
      <div className="flex-1 overflow-y-auto subtle-scrollbar py-1 min-h-0">
        {runList.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground/70 italic">
            {t("activity.history.empty")}
          </p>
        ) : (
          <ul className="divide-y divide-border/40">
            {runList.map((r) => {
              const a = (agents.data?.agents ?? []).find(
                (x) => x.id === r.agentId,
              );
              const m = a
                ? manifests.find((mm) => mm.kind === a.adapterKind)
                : undefined;
              return (
                <li key={r.id}>
                  <Link
                    to={`/projects/${projectId}/runs/${r.id}`}
                    className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                  >
                    {m ? (
                      <AdapterIcon manifest={m} size={18} />
                    ) : (
                      <span className="size-4 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium truncate">
                          {a?.name ?? "—"}
                        </span>
                        <Badge
                          variant={statusVariant(r.status)}
                          className="h-3.5 px-1 text-[9px] shrink-0"
                        >
                          {r.status}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
                        {r.prompt.slice(0, 80)}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground/60 mono">
                        <Clock className="inline size-2.5 mr-0.5" />
                        {timeAgo(r.createdAt)}
                      </p>
                    </div>
                    <ChevronRight className="size-3 text-muted-foreground/40 mt-1 shrink-0" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <ManageFooter
        to={`/projects/${projectId}/runs`}
        label={t("activity.manage")}
      />
    </>
  );
}

function SettingsActivity() {
  const { t } = useI18n();
  const { mode, setMode } = useTheme();
  const { lang, setLang } = useI18n();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 10_000,
  });
  return (
    <>
      <PanelHeader title={t("activity.settings")} />
      <div className="flex-1 overflow-y-auto subtle-scrollbar p-3 space-y-4">
        <SettingsRow label={t("nav.theme.title")}>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as ThemeMode)}
            className="h-7 cursor-pointer rounded-md border bg-transparent px-2 text-xs hover:bg-muted focus:outline-none"
          >
            <option value="system">{t("nav.theme.system")}</option>
            <option value="light">{t("nav.theme.light")}</option>
            <option value="dark">{t("nav.theme.dark")}</option>
          </select>
        </SettingsRow>
        <SettingsRow label={t("nav.lang.title")}>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
            className="h-7 cursor-pointer rounded-md border bg-transparent px-2 text-xs hover:bg-muted focus:outline-none"
          >
            {SUPPORTED_LANGS.map((l) => (
              <option key={l} value={l}>
                {LANG_NAMES[l]}
              </option>
            ))}
          </select>
        </SettingsRow>
        <SettingsRow label={t("settings.serverStatus")}>
          <span className="inline-flex items-center gap-1.5 text-xs">
            <span
              className={cn(
                "size-1.5 rounded-full",
                health.isSuccess
                  ? "bg-emerald-500"
                  : health.isError
                    ? "bg-red-500"
                    : "bg-zinc-400",
              )}
            />
            {health.isSuccess
              ? t("common.online")
              : health.isError
                ? t("common.offline")
                : t("common.loading")}
          </span>
        </SettingsRow>

        <div className="pt-3 border-t">
          <div className="flex items-center gap-2">
            <LoomLogo className="size-5 dark:invert" />
            <div className="text-xs text-muted-foreground">
              loom <span className="mono">v0.1.0</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function SettingsRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function statusVariant(
  s: string,
): "info" | "success" | "destructive" | "warning" | "secondary" {
  switch (s) {
    case "succeeded":
      return "success";
    case "failed":
      return "destructive";
    case "cancelled":
      return "warning";
    case "running":
    case "queued":
      return "info";
    default:
      return "secondary";
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function elapsedSecs(run: Run): number {
  const start = run.startedAt ?? run.createdAt;
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(start).getTime()) / 1000),
  );
}

