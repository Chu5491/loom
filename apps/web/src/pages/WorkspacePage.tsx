import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  GitBranch,
  MessageCircle,
  MessagesSquare,
  Paperclip,
  Pencil,
  Plus,
  Users,
  X,
} from "lucide-react";
import type { AdapterManifest, Agent, Run, Thread } from "@loom/core";
import { api } from "../api/client.js";
import {
  AgentMessage,
  Composer,
  DaySeparator,
  ThreadFrame,
  TooltipProvider,
  UserMessage,
  WorkingIndicator,
  buildForwardQuote,
  buildReplyQuote,
  buildSelectionQuote,
  dayKey,
  findParentAgent,
  isContinuation,
  useRoomDerived,
} from "../components/Chat.js";
import { ContextDrawer } from "../components/ContextDrawer.js";
import { FilePalette } from "../components/FilePalette.js";
import { FilesTree } from "../components/FilesTree.js";
import { FileTab } from "../components/FileTab.js";
import { TopAgentsStrip } from "../components/TopAgentsStrip.js";
import { Button } from "../components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

/**
 * Unified project workspace — the "VSCode + Discord" surface.
 *
 *   ┌──────────┬─────────────────────────────┬──────────┐
 *   │ Files    │  ┌Tabs────────────────────┐ │ Members  │
 *   │ tree     │  │ Chat | src/auth.ts | × │ │ (agents) │
 *   │          │  ├────────────────────────┤ │          │
 *   │          │  │ active tab content     │ │          │
 *   └──────────┴──┴────────────────────────┴─┴──────────┘
 *
 *   - Chat tab is always pinned and never closes.
 *   - Clicking a file in the tree opens (or activates) a tab for it.
 *   - File tabs show contents + a "runs that touched this file" rail
 *     whose entries are clickable: clicking jumps back to the chat tab
 *     and scrolls to that run's message — closing the loop between
 *     files and the conversation.
 */
export function WorkspacePage() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();

  // ── Data
  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.getProject(projectId!),
    enabled: !!projectId,
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
  const projectAgentIds = useMemo(
    () => new Set((agents.data?.agents ?? []).map((a) => a.id)),
    [agents.data],
  );
  const runsQuery = useQuery({
    queryKey: ["runs", { projectId }],
    queryFn: () => api.listRuns({ limit: 100 }),
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return false;
      const hasActive = data.runs.some(
        (r) => r.status === "queued" || r.status === "running",
      );
      return hasActive ? 2000 : false;
    },
    enabled: !!projectId,
  });
  const projectRuns = useMemo(
    () =>
      (runsQuery.data?.runs ?? []).filter((r) => projectAgentIds.has(r.agentId)),
    [runsQuery.data, projectAgentIds],
  );

  // Threads in this project. Sidebar order is most-recent-activity first
  // (server orders by updated_at, which run-service bumps on every run).
  const threadsQuery = useQuery({
    queryKey: ["threads", { projectId }],
    queryFn: () => api.listThreads({ projectId }),
    enabled: !!projectId,
    refetchInterval: () => {
      // Bump faster while runs are active so a freshly-created thread
      // (first message in a brand-new conversation) shows up promptly.
      const active = runsQuery.data?.runs.some(
        (r) => r.status === "queued" || r.status === "running",
      );
      return active ? 3000 : 30_000;
    },
  });
  const threadList = threadsQuery.data?.threads ?? [];

  const agentList = agents.data?.agents ?? [];
  const manifests = adapters.data?.adapters ?? [];
  const adapterByKind = useMemo(() => {
    const map: Record<string, AdapterManifest> = {};
    for (const m of manifests) map[m.kind] = m;
    return map;
  }, [manifests]);

  // Touched-paths set powers the file-tree dot decorations. Refresh on
  // a slow cadence (and after an active run finishes) — it's purely
  // visual, so we don't need it second-by-second.
  const touched = useQuery({
    queryKey: ["projectTouched", projectId],
    queryFn: () => api.getProjectTouched(projectId!),
    enabled: !!projectId,
    refetchInterval: () => {
      // Re-fetch faster while runs are active — newly touched files
      // should pop a dot soon after the run ends.
      const active = runsQuery.data?.runs.some(
        (r) => r.status === "queued" || r.status === "running",
      );
      return active ? 4000 : 30_000;
    },
  });
  const touchedSet = useMemo(
    () => new Set((touched.data?.paths ?? []).map((p) => p.path)),
    [touched.data],
  );

  // The member rail tracks "anyone busy anywhere in this project,"
  // independent of the active thread, so users can see e.g. "@QA is
  // busy in another thread." The chat panel narrows to the active
  // thread further down (after activeThreadId is declared).
  const { working, workingIds } = useRoomDerived(projectRuns, agentList);

  // ── Tabs + active thread + drawer state (persisted per project)
  // Center tabs hold *only* file paths now — chat moved to its own
  // right-side drawer. `activeFile` is the path of the file in view
  // (or null when no file is open and the center shows an empty state).
  //
  // `chatDrawerOpen` controls the right-side chat panel. ⌘L (or its
  // header button) toggles it. Closed = full-width work area, open =
  // chat sits beside the file content for live monitor / quick reply.
  //
  // `activeThreadId` is null until the first message lands or the user
  // explicitly picks a thread. Sending while null tells the server to
  // create a fresh thread, then we adopt the new id from the response.
  const tabsKey = projectId ? `loom:workspace:${projectId}:tabs` : null;
  const [openFiles, setOpenFiles] = useState<string[]>(() =>
    readPersistedTabs(tabsKey).openFiles,
  );
  const [activeFile, setActiveFile] = useState<string | null>(() => {
    const persisted = readPersistedTabs(tabsKey);
    return persisted.activeTab === "chat" ? null : persisted.activeTab;
  });
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    () => readPersistedTabs(tabsKey).activeThreadId,
  );
  const [chatDrawerOpen, setChatDrawerOpen] = useState<boolean>(() =>
    readBoolFlag("loom:workspace:chatDrawerOpen", () => true),
  );

  // Reload state when the project changes (within the same component
  // instance — e.g. navigating /projects/A → /projects/B).
  useEffect(() => {
    const next = readPersistedTabs(tabsKey);
    setOpenFiles(next.openFiles);
    setActiveFile(next.activeTab === "chat" ? null : next.activeTab);
    setActiveThreadId(next.activeThreadId);
  }, [tabsKey]);

  // Persist on every change. Cheap (small JSON, single key).
  useEffect(() => {
    if (!tabsKey) return;
    try {
      window.localStorage.setItem(
        tabsKey,
        JSON.stringify({
          openFiles,
          // Keep the legacy "chat" sentinel out of storage — null is
          // the new representation for "no file is currently active."
          activeTab: activeFile ?? "chat",
          activeThreadId,
        }),
      );
    } catch {
      // Quota exceeded / private mode — silently skip; the UX still
      // works for the current session.
    }
  }, [tabsKey, openFiles, activeFile, activeThreadId]);

  useEffect(() => {
    writeBoolFlag("loom:workspace:chatDrawerOpen", chatDrawerOpen);
  }, [chatDrawerOpen]);

  // Auto-pick the most recent thread when the project loads and no
  // thread is selected yet. Skip if the user has explicitly chosen
  // "no thread" (null after a "new thread" click) — that's an active
  // signal that the next send should create a fresh conversation.
  const [hasInitializedThread, setHasInitializedThread] = useState(false);
  useEffect(() => {
    if (hasInitializedThread) return;
    if (threadList.length === 0) return;
    if (activeThreadId === null) {
      // Only auto-pick on the very first load — once the user clears
      // the thread we respect that until they send.
      const persisted = readPersistedTabs(tabsKey).activeThreadId;
      if (persisted === null) {
        setActiveThreadId(threadList[0]!.id);
      }
    }
    setHasInitializedThread(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadList.length]);

  // Chat-panel runs are scoped to the active thread. With null thread
  // (a "new conversation" the user is about to start), nothing is
  // shown — the empty state will say "send a message to begin."
  const filteredRuns = useMemo(
    () =>
      activeThreadId
        ? projectRuns.filter((r) => r.threadId === activeThreadId)
        : [],
    [projectRuns, activeThreadId],
  );
  const { threads } = useRoomDerived(filteredRuns, agentList);

  // Sum of the active thread's run costs. We sum everything that has a
  // cost reported — cost-less runs (non-claude-code adapters) just
  // don't contribute, which is the right shape for "total cost so far."
  const threadCost = useMemo(() => {
    let total = 0;
    let any = false;
    for (const r of filteredRuns) {
      if (typeof r.costUsd === "number") {
        total += r.costUsd;
        any = true;
      }
    }
    return any ? total : null;
  }, [filteredRuns]);

  const openFile = useCallback((path: string) => {
    setOpenFiles((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setActiveFile(path);
  }, []);
  const closeFile = useCallback((path: string) => {
    setOpenFiles((prev) => {
      const next = prev.filter((p) => p !== path);
      setActiveFile((cur) => {
        if (cur !== path) return cur;
        // When closing the active file, fall back to the next one in
        // the strip (or null if this was the last one).
        return next[next.length - 1] ?? null;
      });
      return next;
    });
  }, []);

  // ── Composer state (lifted up so file→jump can also surface chat)
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<string | undefined>();
  const [draftKey, setDraftKey] = useState(0);
  useEffect(() => {
    if (agentIds.length === 0 && agentList.length) {
      setAgentIds([agentList[0]!.id]);
    }
  }, [agentList, agentIds.length]);

  // Jump-to-run target — set when a file-history entry is clicked.
  // Auto-opens the chat drawer (so the message is actually rendered)
  // and the ChatPanel inside scrolls to the matching message after
  // mount / update, then clears it.
  const [pendingJumpRunId, setPendingJumpRunId] = useState<string | null>(null);
  const handleJumpToRun = useCallback((runId: string) => {
    setChatDrawerOpen(true);
    setPendingJumpRunId(runId);
  }, []);

  // Context drawer (markdown editor for the active thread's bundle)
  // and file palette state.
  const [contextOpen, setContextOpen] = useState(false);

  // Files panel collapse. Persisted in localStorage so the layout
  // survives reloads. Defaults collapsed on narrow viewports so the
  // chat itself gets the room it deserves; the user can expand it
  // when they actually need to browse the tree.
  //
  // The old MemberRail (right side) collapse is gone — the strip at
  // the top of the workspace replaced that rail entirely.
  const [filesCollapsed, setFilesCollapsed] = useState(() =>
    readBoolFlag("loom:workspace:filesCollapsed", () =>
      typeof window !== "undefined" && window.innerWidth < 1100,
    ),
  );
  useEffect(() => {
    writeBoolFlag("loom:workspace:filesCollapsed", filesCollapsed);
  }, [filesCollapsed]);

  // Cmd+P / Ctrl+P opens the file quick-open palette. Cmd+L / Ctrl+L
  // toggles the chat drawer. Skip both when an editable element has
  // focus so the user can still print / select-line text inside an
  // input or textarea.
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const inEditable = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      return !!(
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      );
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return;
      if (inEditable(e)) return;
      const k = e.key.toLowerCase();
      if (k === "p") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (k === "l") {
        e.preventDefault();
        setChatDrawerOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (project.isLoading || agents.isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }
  if (project.isError || !project.data) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-destructive">
        {project.error?.message ?? t("common.notFound")}
      </div>
    );
  }
  const p = project.data.project;
  const activeThread =
    threadList.find((th) => th.id === activeThreadId) ?? null;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full min-w-0 flex-col">
        {/* Workspace-wide top strip — full width across all sub-areas
         *  so member presence is visible whether you're in a file or
         *  the chat drawer. */}
        <TopAgentsStrip
          agents={agentList}
          manifests={manifests}
          workingIds={workingIds}
          runs={projectRuns}
          selectedAgentId={agentIds[0]}
          onPick={(id) => setAgentIds([id])}
          projectId={p.id}
        />

        <div className="flex-1 min-h-0 flex">
          {/* Files panel — left rail, collapsible. */}
          <aside
            className={cn(
              "hidden md:flex shrink-0 flex-col border-r bg-muted/20 transition-[width] duration-200",
              filesCollapsed ? "w-8" : "w-60",
            )}
          >
            <div
              className={cn(
                "flex items-center border-b shrink-0",
                filesCollapsed ? "justify-center px-1" : "justify-between px-3",
                "py-2",
              )}
            >
              {filesCollapsed ? null : (
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("files.tree.title")}
                </span>
              )}
              <button
                type="button"
                onClick={() => setFilesCollapsed((v) => !v)}
                title={
                  filesCollapsed
                    ? t("workspace.files.expand")
                    : t("workspace.files.collapse")
                }
                aria-label={
                  filesCollapsed
                    ? t("workspace.files.expand")
                    : t("workspace.files.collapse")
                }
                className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                {filesCollapsed ? (
                  <ChevronRight className="size-3" />
                ) : (
                  <ChevronLeft className="size-3" />
                )}
              </button>
            </div>
            {filesCollapsed ? null : (
              <div className="flex-1 overflow-y-auto">
                <FilesTree
                  projectId={p.id}
                  selectedPath={activeFile}
                  touched={touchedSet}
                  onPick={openFile}
                />
              </div>
            )}
          </aside>

          {/* Center — file viewer or empty state. The chat used to live
           *  here as a tab; now it sits in the right drawer so files and
           *  chat can be visible at the same time. */}
          <div className="flex-1 min-w-0 flex flex-col">
            {openFiles.length > 0 ? (
              <FileTabBar
                activeFile={activeFile}
                openFiles={openFiles}
                onActivate={(path) => setActiveFile(path)}
                onClose={closeFile}
                chatDrawerOpen={chatDrawerOpen}
                onToggleChatDrawer={() => setChatDrawerOpen((v) => !v)}
              />
            ) : (
              <CenterTopBar
                chatDrawerOpen={chatDrawerOpen}
                onToggleChatDrawer={() => setChatDrawerOpen((v) => !v)}
              />
            )}
            <div className="flex-1 min-h-0 flex flex-col">
              {activeFile && openFiles.includes(activeFile) ? (
                <FileTab
                  projectId={p.id}
                  path={activeFile}
                  onJumpToRun={handleJumpToRun}
                  adapterByKind={adapterByKind}
                />
              ) : (
                <CenterEmptyState chatDrawerOpen={chatDrawerOpen} />
              )}
            </div>
          </div>

          {/* Chat drawer — slides in from the right. Toggleable via
           *  ⌘L or its own header button; persisted across sessions. */}
          {chatDrawerOpen ? (
            <aside className="hidden lg:flex shrink-0 w-[440px] flex-col border-l bg-background">
              <ThreadBar
                projectId={p.id}
                threads={threadList}
                activeThread={activeThread}
                activeThreadCost={threadCost}
                onCloseDrawer={() => setChatDrawerOpen(false)}
                onOpenContext={() => setContextOpen(true)}
                onPickThread={(id) => setActiveThreadId(id)}
                onNewThread={() => setActiveThreadId(null)}
                onNewIsolatedThread={async () => {
                  try {
                    const r = await api.createThread({
                      projectId: p.id,
                      name: "Isolated thread",
                      isolate: true,
                    });
                    setActiveThreadId(r.thread.id);
                  } catch (err) {
                    console.error("[loom] failed to create isolated thread", err);
                  }
                }}
              />
              <ChatPanel
                project={p}
                agentList={agentList}
                manifests={manifests}
                threads={threads}
                working={working}
                activeThreadId={activeThreadId}
                threadHasContext={!!activeThread?.contextBundle}
                onAdoptThreadId={setActiveThreadId}
                agentIds={agentIds}
                setAgentIds={setAgentIds}
                draft={draft}
                setDraft={setDraft}
                draftKey={draftKey}
                setDraftKey={setDraftKey}
                pendingJumpRunId={pendingJumpRunId}
                onConsumedJump={() => setPendingJumpRunId(null)}
              />
            </aside>
          ) : null}
        </div>
      </div>

      <FilePalette
        projectId={p.id}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onPickFile={openFile}
      />

      <ContextDrawer
        open={contextOpen}
        thread={activeThread}
        onClose={() => setContextOpen(false)}
      />
    </TooltipProvider>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Center-area top bars (when files exist vs. empty state)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Mini bar that sits above the empty center state. Even with no file
 * tabs open, the user still needs the chat-drawer toggle reachable so
 * they can re-open a closed drawer without leaving the workspace.
 */
function CenterTopBar({
  chatDrawerOpen,
  onToggleChatDrawer,
}: {
  chatDrawerOpen: boolean;
  onToggleChatDrawer: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-end gap-1 px-3 py-1.5 border-b bg-muted/10 shrink-0">
      <button
        type="button"
        onClick={onToggleChatDrawer}
        title={
          chatDrawerOpen
            ? t("workspace.chat.close")
            : t("workspace.chat.open")
        }
        aria-label={
          chatDrawerOpen
            ? t("workspace.chat.close")
            : t("workspace.chat.open")
        }
        className="inline-flex items-center gap-1 px-2 h-6 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <MessageCircle className="size-3.5" />
        <span>{t("workspace.chat.label")}</span>
        <span className="text-muted-foreground/60 mono ml-1">⌘L</span>
      </button>
    </div>
  );
}

/**
 * Empty state for the center pane when no file tab is open. Hints at
 * the two ways into a file: the tree on the left, and ⌘P search.
 * Doesn't mention the chat drawer here — the top bar above already
 * has its toggle.
 */
function CenterEmptyState({
  chatDrawerOpen,
}: {
  chatDrawerOpen: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex-1 flex items-center justify-center text-center px-6">
      <div className="max-w-sm">
        <FileText className="size-10 mx-auto text-muted-foreground/50" />
        <h3 className="mt-3 text-sm font-medium text-muted-foreground">
          {t("workspace.empty.title")}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground/70">
          {t("workspace.empty.hintTree")}
          <br />
          {t("workspace.empty.hintPalette")}
        </p>
        {!chatDrawerOpen ? (
          <p className="mt-3 text-[11px] text-muted-foreground/60 mono">
            {t("workspace.empty.hintChat")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Thread bar — active thread name + switcher + rename + new
// ────────────────────────────────────────────────────────────────────────────

/**
 * Always-visible bar above the tab strip showing the active thread.
 * Hosts three controls:
 *
 *   - The thread name (editable inline — click pencil to rename)
 *   - A switcher dropdown listing every thread in the project
 *   - "+ new thread" — clears the active thread; the next send creates
 *     a fresh one and we adopt its id from the create-run response
 *
 * When no thread is selected (post-"new thread" or empty project) the
 * bar shows "New conversation" as a placeholder.
 */
function ThreadBar({
  projectId,
  threads,
  activeThread,
  activeThreadCost,
  onCloseDrawer,
  onOpenContext,
  onPickThread,
  onNewThread,
  onNewIsolatedThread,
}: {
  projectId: string;
  threads: Thread[];
  activeThread: Thread | null;
  /** Total $ cost across the active thread's runs, or null when no
   *  run in this thread has reported a cost yet. */
  activeThreadCost: number | null;
  /** Close button in the bar — collapses the chat drawer entirely so
   *  the center pane reclaims the chat's width for full-screen file
   *  work. */
  onCloseDrawer?: () => void;
  onOpenContext: () => void;
  onPickThread: (id: string) => void;
  onNewThread: () => void;
  onNewIsolatedThread: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const rename = useMutation({
    mutationFn: (input: { id: string; name: string }) =>
      api.updateThread(input.id, { name: input.name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["threads", { projectId }] });
    },
  });

  const setStatus = useMutation({
    mutationFn: (input: { id: string; status: Thread["status"] }) =>
      api.updateThread(input.id, { status: input.status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["threads", { projectId }] });
    },
  });

  // ⌘⇧A / Ctrl+Shift+A — toggle the active thread's archived state.
  // Picked over a plain ⌘A because that conflicts with "select all".
  // Skips when an editable element is focused so it doesn't fire while
  // the user is typing (composer, rename input, etc.).
  useEffect(() => {
    if (!activeThread) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "a"
      ) {
        e.preventDefault();
        setStatus.mutate({
          id: activeThread.id,
          status:
            activeThread.status === "archived" ? "active" : "archived",
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeThread, setStatus]);

  const startEdit = () => {
    if (!activeThread) return;
    setDraftName(activeThread.name);
    setEditing(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };
  const commitEdit = () => {
    if (!activeThread) {
      setEditing(false);
      return;
    }
    const next = draftName.trim();
    if (next && next !== activeThread.name) {
      rename.mutate({ id: activeThread.id, name: next });
    }
    setEditing(false);
  };
  const cancelEdit = () => setEditing(false);

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-b shrink-0 bg-muted/10">
      {activeThread?.worktreePath ? (
        <span
          title={`worktree: ${activeThread.worktreePath}`}
          className="text-sky-600 dark:text-sky-400 shrink-0"
        >
          <GitBranch className="size-3.5" />
        </span>
      ) : (
        <MessagesSquare className="size-3.5 text-muted-foreground shrink-0" />
      )}
      {editing && activeThread ? (
        <input
          ref={inputRef}
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.nativeEvent.isComposing &&
              e.nativeEvent.keyCode !== 229
            ) {
              e.preventDefault();
              commitEdit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelEdit();
            }
          }}
          className="flex-1 min-w-0 bg-transparent border-0 px-0 py-0 text-sm font-medium focus:outline-none focus:ring-0"
        />
      ) : (
        <span
          className={cn(
            "flex-1 min-w-0 truncate text-sm flex items-center gap-2",
            activeThread ? "font-medium" : "italic text-muted-foreground",
          )}
          title={activeThread?.name}
        >
          <span className="truncate">
            {activeThread?.name ?? t("thread.bar.newConversation")}
          </span>
          {activeThread && activeThread.status !== "active" ? (
            <span
              className={cn(
                "shrink-0 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                activeThread.status === "done"
                  ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10"
                  : "border-zinc-500/40 text-zinc-600 dark:text-zinc-400 bg-zinc-500/10",
              )}
            >
              {activeThread.status === "done" ? (
                <CheckCircle2 className="size-2.5" />
              ) : (
                <Archive className="size-2.5" />
              )}
              {activeThread.status}
            </span>
          ) : null}
        </span>
      )}
      {activeThread && !editing ? (
        <>
          <button
            type="button"
            onClick={startEdit}
            title={t("thread.bar.rename")}
            aria-label={t("thread.bar.rename")}
            className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Pencil className="size-3" />
          </button>
          <button
            type="button"
            onClick={onOpenContext}
            title={t("thread.bar.editContext")}
            aria-label={t("thread.bar.editContext")}
            className={cn(
              "inline-flex items-center gap-1 px-1.5 h-6 rounded text-[11px] transition-colors",
              activeThread.contextBundle
                ? "text-sky-700 dark:text-sky-400 bg-sky-500/10 hover:bg-sky-500/20"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            <Paperclip className="size-3" />
            {activeThread.contextBundle ? (
              <span className="mono">
                {compactBundleSize(activeThread.contextBundle)}
              </span>
            ) : (
              <span>{t("thread.bar.addContext")}</span>
            )}
          </button>
        </>
      ) : null}

      {activeThreadCost !== null ? (
        <span
          className="text-[11px] text-muted-foreground/80 mono shrink-0"
          title={t("thread.bar.totalCost", {
            value: `$${activeThreadCost.toFixed(4)}`,
          })}
        >
          {formatThreadCost(activeThreadCost)}
        </span>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title={t("thread.bar.switch")}
          >
            <ChevronDown className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[18rem] max-w-[24rem]">
          <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("thread.bar.threadsCount", { n: threads.length })}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {threads.length === 0 ? (
            <div className="px-2 py-2 text-xs text-muted-foreground">
              {t("thread.bar.empty")}
            </div>
          ) : (
            threads.map((th) => (
              <DropdownMenuItem
                key={th.id}
                onSelect={() => onPickThread(th.id)}
                className="gap-2"
              >
                <span className="flex-1 truncate text-sm">{th.name}</span>
                {th.id === activeThread?.id ? (
                  <Check className="size-3 shrink-0 text-foreground/70" />
                ) : (
                  <span className="text-[10px] text-muted-foreground/60 mono shrink-0">
                    {timeAgo(th.updatedAt)}
                  </span>
                )}
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={onNewThread}
            className="gap-2 text-sm"
          >
            <Plus className="size-3.5 text-muted-foreground" />
            {t("thread.bar.newThread")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={onNewIsolatedThread}
            className="gap-2 text-sm"
          >
            <GitBranch className="size-3.5 text-muted-foreground" />
            <span className="flex-1">{t("thread.bar.newIsolatedThread")}</span>
            <span className="text-[10px] text-muted-foreground/70">
              worktree
            </span>
          </DropdownMenuItem>
          {activeThread ? (
            <>
              <DropdownMenuSeparator />
              {activeThread.status !== "done" ? (
                <DropdownMenuItem
                  onSelect={() =>
                    setStatus.mutate({
                      id: activeThread.id,
                      status: "done",
                    })
                  }
                  className="gap-2 text-sm"
                >
                  <CheckCircle2 className="size-3.5 text-muted-foreground" />
                  {t("thread.bar.markDone")}
                </DropdownMenuItem>
              ) : null}
              {activeThread.status !== "archived" ? (
                <DropdownMenuItem
                  onSelect={() =>
                    setStatus.mutate({
                      id: activeThread.id,
                      status: "archived",
                    })
                  }
                  className="gap-2 text-sm"
                >
                  <Archive className="size-3.5 text-muted-foreground" />
                  {t("thread.bar.archive")}
                  <span className="ml-auto text-[10px] text-muted-foreground/70 mono">
                    ⇧⌘A
                  </span>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onSelect={() =>
                    setStatus.mutate({
                      id: activeThread.id,
                      status: "active",
                    })
                  }
                  className="gap-2 text-sm"
                >
                  <ArchiveRestore className="size-3.5 text-muted-foreground" />
                  {t("thread.bar.unarchive")}
                  <span className="ml-auto text-[10px] text-muted-foreground/70 mono">
                    ⇧⌘A
                  </span>
                </DropdownMenuItem>
              )}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        type="button"
        onClick={onNewThread}
        title={t("thread.bar.newThread")}
        aria-label={t("thread.bar.newThread")}
        className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <Plus className="size-3.5" />
      </button>
      {onCloseDrawer ? (
        <button
          type="button"
          onClick={onCloseDrawer}
          title={t("workspace.chat.close")}
          aria-label={t("workspace.chat.close")}
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
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

/** Read a boolean flag from localStorage. Falls back to `def()` —
 *  `def` is a thunk so we can do a viewport check at first read
 *  without paying the lookup cost on every re-render. */
function readBoolFlag(key: string, def: () => boolean): boolean {
  if (typeof window === "undefined") return def();
  const v = window.localStorage.getItem(key);
  if (v === "1") return true;
  if (v === "0") return false;
  return def();
}

function writeBoolFlag(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // private mode / quota — silently skip
  }
}

/** Compact USD for the thread-bar total. Slightly less aggressive
 *  rounding than the per-message display so a thread total of $0.043
 *  doesn't read as "$0" in the bar. */
function formatThreadCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 10) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** Size pill for the thread-bar's context button. Char count for
 *  short bundles, "Nk" for longer ones. Reads at a glance. */
function compactBundleSize(text: string): string {
  const n = text.length;
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(1)}k`;
}

// ────────────────────────────────────────────────────────────────────────────
// File tab bar
// ────────────────────────────────────────────────────────────────────────────

/**
 * Center-pane tab strip. Files only — chat moved to its own drawer,
 * so the strip's job is now purely "which file am I looking at?"
 *
 * The right edge holds the chat-drawer toggle so opening / closing
 * chat is a one-click operation no matter where you are in the file
 * stack.
 */
function FileTabBar({
  activeFile,
  openFiles,
  onActivate,
  onClose,
  chatDrawerOpen,
  onToggleChatDrawer,
}: {
  activeFile: string | null;
  openFiles: string[];
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  chatDrawerOpen: boolean;
  onToggleChatDrawer: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-stretch gap-px border-b bg-muted/10 px-1 shrink-0 overflow-x-auto">
      {openFiles.map((path) => (
        <Tab
          key={path}
          active={activeFile === path}
          icon={<FileText className="size-3.5" />}
          label={basename(path)}
          title={path}
          onActivate={() => onActivate(path)}
          onClose={() => onClose(path)}
        />
      ))}
      <div className="flex-1" />
      <button
        type="button"
        onClick={onToggleChatDrawer}
        title={
          chatDrawerOpen
            ? t("workspace.chat.close")
            : t("workspace.chat.open")
        }
        aria-label={
          chatDrawerOpen
            ? t("workspace.chat.close")
            : t("workspace.chat.open")
        }
        className={cn(
          "inline-flex items-center gap-1 px-2 self-center h-6 rounded text-[11px] transition-colors mr-1",
          chatDrawerOpen
            ? "bg-foreground/5 text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted",
        )}
      >
        <MessageCircle className="size-3.5" />
        <span>{t("workspace.chat.label")}</span>
        <span className="text-muted-foreground/60 mono ml-1">⌘L</span>
      </button>
    </div>
  );
}

function Tab({
  active,
  icon,
  label,
  title,
  onActivate,
  onClose,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  title?: string;
  onActivate: () => void;
  onClose?: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 px-3 py-1.5 text-sm border-b-2 -mb-px cursor-pointer transition-colors max-w-[14rem]",
        active
          ? "border-foreground bg-background text-foreground font-medium"
          : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40",
      )}
      onClick={onActivate}
      title={title}
    >
      <span className="opacity-70 shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
      {onClose ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className={cn(
            "ml-1 inline-flex size-4 items-center justify-center rounded transition-opacity",
            active
              ? "opacity-60 hover:opacity-100 hover:bg-foreground/10"
              : "opacity-0 group-hover:opacity-60 hover:opacity-100 hover:bg-foreground/10",
          )}
          aria-label="close tab"
        >
          <X className="size-2.5" />
        </button>
      ) : null}
    </div>
  );
}

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

// ────────────────────────────────────────────────────────────────────────────
// Chat panel — extracted so the tab system can swap it in/out
// ────────────────────────────────────────────────────────────────────────────

function ChatPanel({
  project,
  agentList,
  manifests,
  threads,
  working,
  activeThreadId,
  threadHasContext,
  onAdoptThreadId,
  agentIds,
  setAgentIds,
  draft,
  setDraft,
  draftKey,
  setDraftKey,
  pendingJumpRunId,
  onConsumedJump,
}: {
  project: { id: string; name: string };
  agentList: Agent[];
  manifests: import("@loom/core").AdapterManifest[];
  threads: ReturnType<typeof useRoomDerived>["threads"];
  working: Agent[];
  /** Active thread the chat is filtered to. null = "new conversation",
   *  in which case the next send creates a thread server-side and the
   *  parent adopts the returned id via `onAdoptThreadId`. */
  activeThreadId: string | null;
  /** Whether the active thread has a non-empty context bundle — drives
   *  visibility of the composer's "attach context" toggle. */
  threadHasContext: boolean;
  onAdoptThreadId: (id: string) => void;
  agentIds: string[];
  setAgentIds: (ids: string[]) => void;
  draft: string | undefined;
  setDraft: (d: string | undefined) => void;
  draftKey: number;
  setDraftKey: (fn: (n: number) => number) => void;
  pendingJumpRunId: string | null;
  onConsumedJump: () => void;
}) {
  const { t } = useI18n();
  const bodyRef = useRef<HTMLDivElement>(null);
  const stickyBottomRef = useRef(true);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickyBottomRef.current = dist < 100;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    const el = bodyRef.current;
    if (el && stickyBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [threads.length, working.length]);

  // Consume pending jumps after layout — same scroll mechanism the
  // hand-off badges use, so the visual treatment (smooth scroll + flash)
  // is consistent regardless of where the click came from.
  useEffect(() => {
    if (!pendingJumpRunId) return;
    // Defer so the chat tab has actually mounted.
    const id = window.setTimeout(() => {
      const el = document.querySelector(
        `[data-run-id="${pendingJumpRunId}"][data-msg-kind="agent"]`,
      ) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.remove("flash-target");
        void el.offsetWidth;
        el.classList.add("flash-target");
        window.setTimeout(() => el.classList.remove("flash-target"), 1500);
      }
      onConsumedJump();
    }, 50);
    return () => clearTimeout(id);
  }, [pendingJumpRunId, onConsumedJump, threads.length]);

  const handleReply = (run: Run, agent: Agent | undefined) => {
    if (agent) setAgentIds([agent.id]);
    setDraft(buildReplyQuote(run, agent, t));
    setDraftKey((k) => k + 1);
  };
  const handleHandoff = async (
    run: Run,
    fromAgent: Agent | undefined,
    toAgent: Agent,
  ) => {
    setAgentIds([toAgent.id]);
    setDraft(await buildForwardQuote(run, fromAgent, t));
    setDraftKey((k) => k + 1);
  };
  const handleQuoteSelection = (
    selection: string,
    run: Run,
    agent: Agent | undefined,
  ) => {
    setDraft(buildSelectionQuote(selection, agent, run.agentId, t));
    setDraftKey((k) => k + 1);
  };

  return (
    <>
      {/* Drawer-width chat — already constrained by the drawer's width
       *  (~440px), so we don't apply an extra max-width here. The
       *  scroll container is the drawer itself; messages flow within. */}
      <div ref={bodyRef} className="flex-1 overflow-y-auto bg-background">
        <div className="w-full py-3">
          {agentList.length === 0 ? (
            <Empty
              icon={<Users className="size-10 text-muted-foreground" />}
              title={t("chat.empty.noAgents")}
              action={
                <Button asChild variant="outline" size="sm">
                  <Link to={`/projects/${project.id}/agents`}>
                    {t("chat.manageAgents")}
                  </Link>
                </Button>
              }
            />
          ) : threads.length === 0 ? (
            <Empty
              icon={<MessageCircle className="size-10 text-muted-foreground" />}
              title={t("chat.empty.firstMessage")}
            />
          ) : (
            threads.map((thread, ti) => {
              const prevThread = threads[ti - 1];
              const showDay =
                !prevThread ||
                dayKey(prevThread.lastTs) !== dayKey(thread.lastTs);
              return (
                <div key={thread.rootId}>
                  {showDay ? <DaySeparator ts={thread.lastTs} /> : null}
                  <ThreadFrame thread={thread}>
                    {thread.items.map((item, i) => {
                      const prev = thread.items[i - 1];
                      const continuation = isContinuation(item, prev);
                      const a = agentList.find((x) => x.id === item.run.agentId);
                      const m = a
                        ? manifests.find((mm) => mm.kind === a.adapterKind)
                        : undefined;
                      if (item.kind === "user") {
                        const parentAgent = findParentAgent(
                          item.run,
                          thread,
                          agentList,
                        );
                        return (
                          <UserMessage
                            key={`${item.run.id}-u`}
                            run={item.run}
                            target={a}
                            parentAgent={parentAgent}
                            isContinuation={continuation}
                          />
                        );
                      }
                      return (
                        <AgentMessage
                          key={`${item.run.id}-a`}
                          run={item.run}
                          agent={a}
                          manifest={m}
                          isContinuation={continuation}
                          allAgents={agentList}
                          allManifests={manifests}
                          onReply={handleReply}
                          onHandoff={handleHandoff}
                          onQuoteSelection={handleQuoteSelection}
                        />
                      );
                    })}
                  </ThreadFrame>
                </div>
              );
            })
          )}
        </div>
      </div>

      <WorkingIndicator workingAgents={working} />

      {agentList.length > 0 ? (
        <div className="border-t bg-background shrink-0">
          <Composer
            agents={agentList}
            manifests={manifests}
            agentIds={agentIds}
            onAgentIdsChange={setAgentIds}
            threadId={activeThreadId}
            threadHasContext={threadHasContext}
            onThreadCreated={onAdoptThreadId}
            initialDraft={draft}
            draftKey={draftKey}
            onSent={() => {
              setDraft(undefined);
              stickyBottomRef.current = true;
            }}
          />
        </div>
      ) : null}
    </>
  );
}

function Empty({
  icon,
  title,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 px-6">
      {icon}
      <p className="mt-3 text-sm text-muted-foreground">{title}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/**
 * Pull persisted tab state. Defensive parse — anything non-conforming
 * (corrupted JSON, schema drift, missing key) reverts to a clean
 * "chat tab only" default. Persistence is a UX nicety, not a
 * correctness requirement, so we never throw.
 */
function readPersistedTabs(
  key: string | null,
): {
  openFiles: string[];
  activeTab: "chat" | string;
  activeThreadId: string | null;
} {
  const empty = {
    openFiles: [] as string[],
    activeTab: "chat" as "chat" | string,
    activeThreadId: null as string | null,
  };
  if (!key || typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as {
      openFiles?: unknown;
      activeTab?: unknown;
      activeThreadId?: unknown;
    };
    const openFiles =
      Array.isArray(parsed.openFiles) &&
      parsed.openFiles.every((p) => typeof p === "string")
        ? (parsed.openFiles as string[])
        : [];
    const activeTab =
      typeof parsed.activeTab === "string" &&
      (parsed.activeTab === "chat" || openFiles.includes(parsed.activeTab))
        ? (parsed.activeTab as "chat" | string)
        : "chat";
    const activeThreadId =
      typeof parsed.activeThreadId === "string"
        ? parsed.activeThreadId
        : null;
    return { openFiles, activeTab, activeThreadId };
  } catch {
    return empty;
  }
}
