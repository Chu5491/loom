export type AgentRole = "engineer" | "researcher" | "reviewer" | "writer" | "other";

export type ThreadStatus = "active" | "done" | "archived";

export type AdapterKind = "claude-code" | "gemini" | "codex" | "cursor" | string;

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

/** "Open in IDE" 버튼이 spawn할 외부 에디터 CLI. 새 IDE를 추가하려면
 *  서버 쪽 buildOpenCommand에 인자 패턴도 함께 추가해야 한다. */
export type PreferredEditor =
  | "vscode"
  | "cursor"
  | "antigravity"
  | "zed"
  | "intellij";

export interface Project {
  id: string;
  name: string;
  /** Absolute path on disk. Becomes the default `cwd` for runs of agents in this project. */
  path: string;
  description: string | null;
  /** 사용자가 "Open in IDE"로 호출하는 외부 에디터. NULL이면 vscode. */
  preferredEditor: PreferredEditor | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdapterConfig {
  command?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
  model?: string;
  [key: string]: unknown;
}

export interface Agent {
  id: string;
  /** Project this agent belongs to. Runs default to the project's path. */
  projectId: string;
  name: string;
  /** System / instruction prompt prepended to every run before user input. */
  prompt: string;
  /** IDs of skills (specs) assigned to this agent — mirrored to disk per run. */
  skillIds: string[];
  /** IDs of MCP servers this agent is permitted to call. The server merges
   *  only these into the .mcp.json the CLI sees at run time. */
  mcpServerIds: string[];
  role: AgentRole | null;
  adapterKind: AdapterKind;
  adapterConfig: AdapterConfig;
  /** Optional override of the project's path for this agent. */
  defaultCwd: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Top-level MCP server config in the system catalog. Agents subscribe to a
 *  subset via agent_mcp_servers. Storage of secrets is local-trust only — keep
 *  loom on a single machine and don't expose the API publicly. */
export type McpServerKind = "stdio" | "http" | "sse";

export interface McpServer {
  id: string;
  /** Unique name — also the key in the .mcp.json `mcpServers` map. */
  name: string;
  description: string | null;
  kind: McpServerKind;
  /** stdio only — the binary to spawn (e.g. "npx"). */
  command: string | null;
  args: string[];
  env: Record<string, string>;
  /** http / sse only — the endpoint URL. */
  url: string | null;
  headers: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface Spec {
  id: string;
  name: string;
  content: string;
  agentId: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Conversation thread — the first-class container for a coherent piece
 * of work. Replaces the implicit grouping by parent_run_id chains:
 * every run now belongs to one Thread, identified by `threadId`. The
 * chain still exists for hand-off badges, but Thread is the unit users
 * navigate, name, and curate.
 */
export interface Thread {
  id: string;
  projectId: string;
  name: string;
  status: ThreadStatus;
  /**
   * User-curated markdown that the user can opt-into attaching to runs
   * in this thread. We never auto-inject — the toggle on the composer
   * controls whether the bundle is composed into the next prompt.
   */
  contextBundle: string;
  /**
   * Optional isolated git worktree path. When set, all runs in this
   * thread cd into this path instead of the project's main directory
   * — useful when multiple threads need to make conflicting edits in
   * parallel without stepping on each other. NULL means "share the
   * project's main checkout" (the default).
   */
  worktreePath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  id: string;
  agentId: string;
  /** Thread this run belongs to. Always set for new runs; legacy runs
   *  from before threads existed are backfilled at migration time. */
  threadId: string | null;
  /** Set when this run was kicked off as a delegation from another run. */
  parentRunId: string | null;
  /** The user prompt as typed (not the composed prompt with skill manifest). */
  prompt: string;
  /** Snapshot of every skill that participated in this run, for auditing. */
  attachedSpecIds: string[];
  cwd: string;
  status: RunStatus;
  exitCode: number | null;
  pid: number | null;
  logPath: string | null;
  /**
   * Working-tree snapshot SHAs (dangling commits) bracketing the run.
   * Both NULL when the cwd isn't a git repo or snapshot failed — UI
   * should treat that as "diff tracking unavailable for this run."
   */
  beforeRef: string | null;
  afterRef: string | null;
  /**
   * Cost in USD as reported by the CLI's result event (claude-code's
   * `total_cost_usd`). NULL when the adapter doesn't surface a cost
   * — UIs hide cost displays in that case rather than show $0.
   */
  costUsd: number | null;
  /**
   * CLI-side session id captured from this run's output (claude-code's
   * `session_id` in stream-json events, opencode's `--session`, etc.).
   * The run-service feeds this back as a resume token on the next run
   * in the same thread/agent so the agent keeps its memory across turns.
   * NULL when the adapter doesn't expose a session id (or the run was
   * cancelled before it surfaced one).
   */
  sessionId: string | null;
  /**
   * Session id this run attempted to resume from at start, if any.
   * When the run fails the session-lookup code uses this to mark the
   * id as poisoned so the next run won't try to resume the same dead
   * session.
   */
  resumedSessionId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

/**
 * Per-file change summary derived by diffing a run's before/after work-tree
 * snapshots. Returned by `GET /api/runs/:id/changes`.
 */
export interface RunChange {
  path: string;
  /** Previous path when status === "renamed". */
  fromPath?: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
}

/**
 * One entry in a project's filesystem tree. Returned by
 * `GET /api/projects/:id/tree?path=…` (one level at a time).
 */
export interface TreeEntry {
  name: string;
  /** Path relative to the project root, "/"-separated. */
  path: string;
  kind: "file" | "directory";
  /** Bytes. Files only. */
  size?: number;
}

/**
 * A single file's contents. Returned by `GET /api/projects/:id/file?path=…`.
 * `text` is null for binaries — the UI shows a placeholder rather than
 * trying to render bytes.
 */
export interface FileContent {
  path: string;
  size: number;
  text: string | null;
  /** Lower-case extension without the dot, "" when none. UI uses this
   *  to pick a syntax-highlight mode. */
  ext: string;
}

/**
 * Decoration data for the file tree — one entry per file path that
 * any agent has ever touched in this project. The UI hangs a dot on
 * matching tree entries so the eye can find "what's been worked on."
 */
export interface TouchedPath {
  path: string;
  lastTouchedAt: string;
  lastAgentId: string;
}

/**
 * Live "an agent is editing this right now" entry. Backed by an
 * in-memory map fed from the CLI's tool_use stream and drained when
 * the run finishes — once it's gone, run_changes / TouchedPath cover
 * the post-mortem read.
 */
export interface ActiveTouch {
  runId: string;
  agentId: string;
  projectId: string;
  paths: string[];
  /** Most recent edit locations the server could pin to a line — i.e.
   *  the agent's `old_string` matched something in the current file.
   *  Empty when the adapter doesn't expose targets, or none of the
   *  current edits could be located (file already shifted). */
  locations: { path: string; line: number }[];
}

/** One tool_use captured live from an agent's stdout. Companion to
 *  ActiveTouch: ActiveTouch answers "which file", ActiveTool answers
 *  "which tool / which MCP server". The Office view's desks render
 *  these as the "what's on the desk right now" indicator. */
export interface ActiveTool {
  ts: string;
  name: string;
  target?: string;
}

export interface ActiveToolsForAgent {
  agentId: string;
  runId: string;
  projectId: string;
  recent: ActiveTool[];
  /** mcp__<server>__... 패턴에서 뽑은 server 이름들. 사무실 책상에 "회의 중인 서버" chip. */
  mcpServers: string[];
}

/**
 * One entry in a file's run history. Returned by
 * `GET /api/projects/:id/file-history?path=…`. The shape pre-hydrates
 * agent + run info so the UI can render a list without follow-up calls.
 */
export interface FileHistoryEntry {
  runId: string;
  agentId: string;
  agentName: string | null;
  adapterKind: string | null;
  status: RunChange["status"];
  additions: number;
  deletions: number;
  fromPath?: string;
  runStatus: RunStatus;
  createdAt: string;
  endedAt: string | null;
}
