import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useOutletContext, useParams } from "react-router-dom";
import type { LayoutOutletContext } from "../components/Layout.js";
import {
  Archive,
  ArchiveRestore,
  Check,
  CheckCircle2,
  ChevronDown,
  Expand,
  FileText,
  GitBranch,
  MessagesSquare,
  Minimize2,
  Paperclip,
  Plus,
  Users,
  X,
} from "lucide-react";
import type { AdapterManifest, Agent, Run, Thread } from "@loom/core";
import { api } from "../api/client.js";
import {
  AgentAvatar,
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
import { AgentInitialBadge } from "../components/AgentInitialBadge.js";
import { ContextDrawer } from "../components/ContextDrawer.js";
import { FilePalette } from "../components/FilePalette.js";
import { FileTab } from "../components/FileTab.js";
import { LiveActivityRail } from "../components/LiveActivityRail.js";
import { TeamRibbon } from "../components/TeamRibbon.js";
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

/** Project workspace. Channel banner + file tabs in the centre, chat
 *  drawer on the right. Clicking a file pill in chat opens it as a
 *  tab; clicking a run in a file's history rail jumps back to the
 *  matching message in chat. */
export function WorkspacePage() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();
  const { chatFullModal, setChatFullModal } =
    useOutletContext<LayoutOutletContext>();

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

  // Live "@agent is editing this file *now*" map — keyed by project-
  // relative path → agent id. Polls fast while runs are happening so
  // file tabs / file viewer can pulse a badge in near-real-time.
  const activeTouchesQuery = useQuery({
    queryKey: ["projectActiveTouches", projectId],
    queryFn: () => api.getProjectActiveTouches(projectId!),
    enabled: !!projectId,
    refetchInterval: 1500,
  });
  const activeByPath = useMemo(() => {
    const m = new Map<string, string>();
    for (const tch of activeTouchesQuery.data?.touches ?? []) {
      for (const p of tch.paths) m.set(p, tch.agentId);
    }
    return m;
  }, [activeTouchesQuery.data]);
  // Last-known edit line per path — drives ":42" suffix in banners
  // and tab tooltips. We keep just the freshest hit per path because
  // the user typically wants "where is the agent at *now*", not a
  // history of every line they swept through.
  const lineByPath = useMemo(() => {
    const m = new Map<string, number>();
    for (const tch of activeTouchesQuery.data?.touches ?? []) {
      for (const loc of tch.locations) m.set(loc.path, loc.line);
    }
    return m;
  }, [activeTouchesQuery.data]);

  // Server orders by updated_at (run-service bumps on every run), so
  // the most-recently-touched thread always lands at the top.
  const threadsQuery = useQuery({
    queryKey: ["threads", { projectId }],
    queryFn: () => api.listThreads({ projectId }),
    enabled: !!projectId,
    refetchInterval: () => {
      // Faster polls while something is running so a brand-new thread
      // shows up before the user wonders where their first message went.
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

  // Anyone busy anywhere in the project — used by the team ribbon so
  // a teammate working in a different thread still reads as present.
  const { working, workingIds } = useRoomDerived(projectRuns, agentList);

  // Tabs are file paths only; chat lives in its own drawer. activeFile
  // is null = empty centre. activeThreadId null = next send creates a
  // fresh thread server-side and we adopt the returned id.
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

  // File viewer is the side panel — the conversation is the main work,
  // files are just where we verify what an agent did. Clamped on read
  // so a saved value from a wider monitor doesn't strand the panel.
  const [fileViewerWidth, setFileViewerWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 520;
    const raw = window.localStorage.getItem("loom:workspace:fileViewerWidth");
    const n = raw ? Number(raw) : NaN;
    if (!Number.isFinite(n)) return 520;
    return Math.min(Math.max(n, 320), 1200);
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(
        "loom:workspace:fileViewerWidth",
        String(fileViewerWidth),
      );
    } catch {
      // ignore quota / private mode
    }
  }, [fileViewerWidth]);

  // Re-read when the user navigates between projects without unmounting.
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

  // Auto-pick the most recent thread on first load. A `null`
  // activeThreadId after the user clicks "new thread" is intentional
  // — leave it alone so the next send starts a fresh conversation.
  const [hasInitializedThread, setHasInitializedThread] = useState(false);
  useEffect(() => {
    if (hasInitializedThread) return;
    if (threadList.length === 0) return;
    if (activeThreadId === null) {
      const persisted = readPersistedTabs(tabsKey).activeThreadId;
      if (persisted === null) {
        setActiveThreadId(threadList[0]!.id);
      }
    }
    setHasInitializedThread(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadList.length]);

  const filteredRuns = useMemo(
    () =>
      activeThreadId
        ? projectRuns.filter((r) => r.threadId === activeThreadId)
        : [],
    [projectRuns, activeThreadId],
  );
  const { threads } = useRoomDerived(filteredRuns, agentList);

  // Cost-less runs (non-claude-code adapters) drop out of the sum,
  // which is the right shape for "total cost so far."
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
  const closeAllFiles = useCallback(() => {
    setOpenFiles([]);
    setActiveFile(null);
  }, []);

  // Composer state lives at this level so file-history → chat jumps
  // can swap the target agent and surface a draft.
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<string | undefined>();
  const [draftKey, setDraftKey] = useState(0);
  useEffect(() => {
    if (agentIds.length === 0 && agentList.length) {
      setAgentIds([agentList[0]!.id]);
    }
  }, [agentList, agentIds.length]);

  // Set by a file's history rail OR the live activity rail / sidebar
  // when the user wants to jump to a specific message. If the run lives
  // in a different thread we switch to it first — otherwise the chat
  // can't find the matching DOM node and the click reads as broken.
  const [pendingJumpRunId, setPendingJumpRunId] = useState<string | null>(null);
  const handleJumpToRun = useCallback(
    (runId: string) => {
      const run = projectRuns.find((r) => r.id === runId);
      if (run && run.threadId && run.threadId !== activeThreadId) {
        setActiveThreadId(run.threadId);
      }
      setPendingJumpRunId(runId);
    },
    [projectRuns, activeThreadId],
  );

  // The activity panels live above us in the tree and can't reach our
  // state directly. They fire window events; we listen here. Loose
  // coupling — any page that wants the same hooks just adds listeners.
  useEffect(() => {
    const onOpenFile = (e: Event) => {
      const path = (e as CustomEvent<{ path: string }>).detail?.path;
      if (path) openFile(path);
    };
    const onPickThread = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (id) setActiveThreadId(id);
    };
    const onNewThread = () => setActiveThreadId(null);
    const onPickAgent = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (id) setAgentIds([id]);
    };
    const onJumpRun = (e: Event) => {
      const runId = (e as CustomEvent<{ runId: string }>).detail?.runId;
      if (runId) handleJumpToRun(runId);
    };
    window.addEventListener("loom:openFile", onOpenFile);
    window.addEventListener("loom:pickThread", onPickThread);
    window.addEventListener("loom:newThread", onNewThread);
    window.addEventListener("loom:pickAgent", onPickAgent);
    window.addEventListener("loom:jumpToRun", onJumpRun);
    return () => {
      window.removeEventListener("loom:openFile", onOpenFile);
      window.removeEventListener("loom:pickThread", onPickThread);
      window.removeEventListener("loom:newThread", onNewThread);
      window.removeEventListener("loom:pickAgent", onPickAgent);
      window.removeEventListener("loom:jumpToRun", onJumpRun);
    };
  }, [openFile, handleJumpToRun]);

  const [contextOpen, setContextOpen] = useState(false);

  // ⌘P opens the file palette. ⌘\ closes the file viewer (= close all
  // open files). Skipped while an editable is focused.
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
      } else if (e.key === "\\") {
        e.preventDefault();
        closeAllFiles();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeAllFiles]);

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

  // Show the file viewer panel when the user has opened at least one
  // file. ⌘⇧L (focus mode) hides it so the conversation can breathe.
  const fileViewerVisible = openFiles.length > 0 && !chatFullModal;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full min-w-0 flex-col">
        {chatFullModal ? null : (
          <TeamRibbon
            project={p}
            agents={agentList}
            workingIds={workingIds}
            activeThread={activeThread}
          />
        )}

        <div className="flex-1 min-h-0 min-w-0 flex">
          {/* The conversation IS the workspace — always centred, always
           *  visible. Files only get a side panel when the user opens
           *  one to verify what an agent did. */}
          <section className="flex-1 min-w-0 flex flex-col bg-card">
            <ThreadBar
              projectId={p.id}
              threads={threadList}
              activeThread={activeThread}
              activeThreadCost={threadCost}
              fullModal={chatFullModal}
              onToggleFullModal={() => setChatFullModal(!chatFullModal)}
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
          </section>

          {fileViewerVisible ? (
            <aside
              className="hidden lg:flex shrink-0 flex-col border-l border-border bg-background relative"
              style={{ width: fileViewerWidth }}
            >
              <PanelResizer
                width={fileViewerWidth}
                onChange={setFileViewerWidth}
              />
              <FileTabBar
                activeFile={activeFile}
                openFiles={openFiles}
                activeByPath={activeByPath}
                lineByPath={lineByPath}
                agents={agentList}
                onActivate={(path) => setActiveFile(path)}
                onClose={closeFile}
                onCloseAll={closeAllFiles}
              />
              <div className="flex-1 min-h-0 flex flex-col">
                {activeFile && openFiles.includes(activeFile) ? (
                  <FileTab
                    projectId={p.id}
                    path={activeFile}
                    activeAgentId={activeByPath.get(activeFile)}
                    activeLine={lineByPath.get(activeFile)}
                    agents={agentList}
                    onJumpToRun={handleJumpToRun}
                    adapterByKind={adapterByKind}
                  />
                ) : null}
              </div>
            </aside>
          ) : !chatFullModal ? (
            <LiveActivityRail
              agents={agentList}
              manifests={manifests}
              runs={projectRuns}
            />
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

/** Header strip above the chat. Thread switcher, context-bundle
 *  pill, cost, and a focus-mode toggle. */
function ThreadBar({
  projectId,
  threads,
  activeThread,
  activeThreadCost,
  fullModal,
  onToggleFullModal,
  onOpenContext,
  onPickThread,
  onNewThread,
  onNewIsolatedThread,
}: {
  projectId: string;
  threads: Thread[];
  activeThread: Thread | null;
  /** Sum of run costs in this thread, or null if no run reported a cost. */
  activeThreadCost: number | null;
  fullModal?: boolean;
  onToggleFullModal?: () => void;
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

  // ⌘⇧A archives the active thread. Plain ⌘A is taken by "select all",
  // and shift makes it a deliberate gesture. Skipped while typing.
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
    <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border shrink-0 bg-card">
      {/* Thread switcher. The thread name lives in the channel banner
       *  above; in here we just need pick / attach / manage. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-2 h-7 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title={t("thread.bar.switch")}
          >
            {activeThread?.worktreePath ? (
              <GitBranch className="size-3.5 text-sky-600 dark:text-sky-400" />
            ) : (
              <MessagesSquare className="size-3.5" />
            )}
            <span>
              {activeThread
                ? t("thread.bar.threadsCount", { n: threads.length })
                : t("thread.bar.newConversation")}
            </span>
            <ChevronDown className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[18rem] max-w-[24rem]">
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
          <DropdownMenuItem onSelect={onNewThread} className="gap-2 text-sm">
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
              <DropdownMenuItem
                onSelect={() => activeThread && startEdit()}
                className="gap-2 text-sm"
              >
                <span className="size-3.5 inline-flex items-center justify-center text-muted-foreground">
                  ✎
                </span>
                {t("thread.bar.rename")}
              </DropdownMenuItem>
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

      {/* Rename swaps in over the switcher to keep the bar one row. */}
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
          placeholder={t("thread.bar.rename")}
          className="flex-1 min-w-0 bg-transparent border-0 px-2 py-0 text-sm focus:outline-none focus:ring-0"
        />
      ) : (
        <div className="flex-1" />
      )}

      {activeThread ? (
        <button
          type="button"
          onClick={onOpenContext}
          title={t("thread.bar.editContext")}
          aria-label={t("thread.bar.editContext")}
          className={cn(
            "inline-flex items-center gap-1 px-1.5 h-7 rounded text-[11px] transition-colors shrink-0",
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
          ) : null}
        </button>
      ) : null}

      {activeThreadCost !== null ? (
        <span
          className="text-[11px] text-muted-foreground/80 mono shrink-0 px-1"
          title={t("thread.bar.totalCost", {
            value: `$${activeThreadCost.toFixed(4)}`,
          })}
        >
          {formatThreadCost(activeThreadCost)}
        </span>
      ) : null}

      {onToggleFullModal ? (
        <button
          type="button"
          onClick={onToggleFullModal}
          className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          title={
            fullModal
              ? t("workspace.chat.exitFullModal")
              : t("workspace.chat.enterFullModal")
          }
          aria-label={
            fullModal
              ? t("workspace.chat.exitFullModal")
              : t("workspace.chat.enterFullModal")
          }
        >
          {fullModal ? (
            <Minimize2 className="size-3.5" />
          ) : (
            <Expand className="size-3.5" />
          )}
        </button>
      ) : null}
    </div>
  );
}

const PANEL_MIN_WIDTH = 320;
const PANEL_MAX_WIDTH = 1200;

/** Drag handle on the file viewer's left edge. Listeners attach to
 *  the document so the cursor can wander outside the 6px hot zone
 *  without dropping the drag. */
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
      // Cursor moves left → panel grows (chat shrinks).
      const dx = startX - ev.clientX;
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
    // Pin the cursor and kill text selection while dragging so the OS
    // doesn't try to select content the cursor sweeps over.
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onMouseDown={onMouseDown}
      className="absolute left-0 top-0 bottom-0 z-10 w-1.5 -ml-0.5 cursor-col-resize group"
    >
      <span
        aria-hidden
        className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-px bg-transparent group-hover:bg-foreground/25 transition-colors"
      />
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

/** Three-decimal default avoids a $0.043 total reading as "$0". */
function formatThreadCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 10) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function compactBundleSize(text: string): string {
  const n = text.length;
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(1)}k`;
}

/** File tab strip. Each tab shows a small initials badge of the agent
 *  currently editing that file (when any) — so the user can see
 *  "@AD is in main.py *right now*" without leaving the chat. */
function FileTabBar({
  activeFile,
  openFiles,
  activeByPath,
  lineByPath,
  agents,
  onActivate,
  onClose,
  onCloseAll,
}: {
  activeFile: string | null;
  openFiles: string[];
  activeByPath?: Map<string, string>;
  lineByPath?: Map<string, number>;
  agents?: Agent[];
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onCloseAll: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-stretch border-b border-border bg-muted/30 shrink-0">
      <div className="flex-1 min-w-0 flex items-stretch gap-px px-1 overflow-x-auto subtle-scrollbar">
        {openFiles.map((path) => {
          const liveAgentId = activeByPath?.get(path);
          const liveAgent = liveAgentId
            ? agents?.find((a) => a.id === liveAgentId)
            : undefined;
          const liveLine = lineByPath?.get(path);
          return (
            <Tab
              key={path}
              active={activeFile === path}
              icon={<FileText className="size-3.5" />}
              label={basename(path)}
              title={path}
              liveAgent={liveAgent}
              liveLine={liveLine}
              onActivate={() => onActivate(path)}
              onClose={() => onClose(path)}
            />
          );
        })}
      </div>
      <button
        type="button"
        onClick={onCloseAll}
        title={t("workspace.tabs.closeAll")}
        aria-label={t("workspace.tabs.closeAll")}
        className="inline-flex items-center gap-1 px-2 self-center h-6 mx-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors whitespace-nowrap shrink-0"
      >
        <X className="size-3 shrink-0" />
        <span>{t("workspace.tabs.closeAll")}</span>
        <span className="text-muted-foreground/60 mono ml-1">⌘\</span>
      </button>
    </div>
  );
}

function Tab({
  active,
  icon,
  label,
  title,
  liveAgent,
  liveLine,
  onActivate,
  onClose,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  title?: string;
  liveAgent?: Agent;
  liveLine?: number;
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
      title={
        liveAgent && title
          ? `${title}${liveLine ? ":" + liveLine : ""} · @${liveAgent.name} editing now`
          : title
      }
    >
      <span className="opacity-70 shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
      {liveAgent ? (
        <>
          <AgentInitialBadge
            agent={liveAgent}
            live
            size="xs"
            className="ml-0.5"
          />
          {liveLine ? (
            <span className="text-[10px] text-muted-foreground/80 mono shrink-0 ml-0.5">
              :{liveLine}
            </span>
          ) : null}
        </>
      ) : null}
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
  /** null = the next send creates a fresh thread; we adopt the
   *  returned id via `onAdoptThreadId`. */
  activeThreadId: string | null;
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

  // Same scroll-and-flash treatment hand-off badges use, so jumps from
  // anywhere look identical.
  useEffect(() => {
    if (!pendingJumpRunId) return;
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
      <div
        ref={bodyRef}
        className="flex-1 overflow-y-auto overflow-x-hidden bg-card subtle-scrollbar"
      >
        <div className="mx-auto w-full max-w-3xl py-3 px-4">
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
            <ChatStartHint agents={agentList} manifests={manifests} />
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
        <div className="border-t border-border bg-card shrink-0">
          <div className="mx-auto w-full max-w-3xl px-4">
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
        </div>
      ) : null}
    </>
  );
}

/** Greeting shown when a project has agents but no thread has started
 *  yet. Lists the team so the room feels populated even before the
 *  first message — "you're walking into a staffed channel, not staring
 *  at a blank editor." */
function ChatStartHint({
  agents,
  manifests,
}: {
  agents: Agent[];
  manifests: AdapterManifest[];
}) {
  const { t } = useI18n();
  return (
    <div className="px-4 py-12 text-center">
      <div className="inline-flex flex-wrap items-center justify-center gap-1.5 mb-4">
        {agents.slice(0, 6).map((a) => (
          <span
            key={a.id}
            className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 pl-1 pr-2 py-0.5 text-xs"
          >
            <AgentAvatar
              agent={a}
              manifest={manifests.find((m) => m.kind === a.adapterKind)}
              size="sm"
            />
            <span className="font-medium">@{a.name}</span>
          </span>
        ))}
      </div>
      <h3 className="text-base font-semibold tracking-tight">
        {t("chat.empty.firstMessage")}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("chat.start.hint")}
      </p>
    </div>
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

/** Defensive parse — corrupted JSON / schema drift falls back to the
 *  empty default. Persistence is a nicety, not correctness. */
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
