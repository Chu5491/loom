import type {
  ActiveToolsForAgent,
  ActiveTouch,
  AdapterManifest,
  AdapterProbeResult,
  Agent,
  FileContent,
  FileHistoryEntry,
  ModelListResult,
  PreferredEditor,
  Project,
  Run,
  RunChange,
  RunStatus,
  Spec,
  TestAdapterResult,
  Thread,
  ThreadStatus,
  TouchedPath,
  TreeEntry,
} from "@loom/core";

// 서버의 services/git.ts 와 1:1 대응. 변경 시 양쪽 동시 수정.
export interface GitWorkingChange {
  path: string;
  fromPath?: string;
  status: string;
}
export interface GitStatus {
  branch: string | null;
  head: string | null;
  ahead: number | null;
  behind: number | null;
  staged: GitWorkingChange[];
  unstaged: GitWorkingChange[];
  untracked: string[];
  conflicted: string[];
  clean: boolean;
}
export interface GitLogEntry {
  sha: string;
  shortSha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  subject: string;
  refs: string[];
}
export interface GitBranchInfo {
  name: string;
  current: boolean;
  upstream: string | null;
  head: string;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface CreateProjectBody {
  name: string;
  path: string;
  description?: string | null;
  preferredEditor?: PreferredEditor | null;
}

export type UpdateProjectBody = Partial<CreateProjectBody>;

export interface OpenInEditorBody {
  /** project-relative path. Missing/empty = project root. */
  path?: string;
  line?: number;
  /** Override the project's saved preference for this call. */
  editor?: PreferredEditor;
}

export interface CreateAgentBody {
  projectId: string;
  name: string;
  prompt?: string;
  skillIds?: string[];
  role?: string | null;
  adapterKind: string;
  adapterConfig?: Record<string, unknown>;
  defaultCwd?: string | null;
}

export type UpdateAgentBody = Partial<CreateAgentBody>;

export interface CreateRunBody {
  agentId: string;
  prompt: string;
  cwd?: string;
  threadId?: string | null;
  parentRunId?: string | null;
  attachedSpecIds?: string[];
  /** When true and the thread has a context bundle, prepend it to the
   *  composed prompt for this run. Opt-in per-send. */
  includeContext?: boolean;
  /** When true, do not pass `--resume <id>` for this run. The CLI starts
   *  a fresh session id; subsequent runs in the thread pick up from there. */
  freshSession?: boolean;
}

export interface CreateThreadBody {
  projectId: string;
  name: string;
  isolate?: boolean;
}

export interface UpdateThreadBody {
  name?: string;
  status?: ThreadStatus;
  contextBundle?: string;
}

export interface CreateSpecBody {
  name: string;
  content: string;
  agentId?: string | null;
  tags?: string[];
}

export interface UpdateSpecBody {
  name?: string;
  content?: string;
  agentId?: string | null;
  tags?: string[];
}

export const api = {
  health: () => request<{ status: string; name: string; version: string }>("/api/health"),

  listAdapters: () => request<{ adapters: AdapterManifest[] }>("/api/adapters"),
  getAdapter: (kind: string) =>
    request<{ adapter: AdapterManifest }>(`/api/adapters/${kind}`),
  probeAdapter: (
    kind: string,
    options: { command?: string; refresh?: boolean } = {},
  ) => {
    const params = new URLSearchParams();
    if (options.command) params.set("command", options.command);
    if (options.refresh) params.set("refresh", "1");
    const qs = params.toString() ? `?${params}` : "";
    return request<{ probe: AdapterProbeResult }>(
      `/api/adapters/${kind}/probe${qs}`,
    );
  },
  listAdapterModels: (
    kind: string,
    options: { command?: string; refresh?: boolean } = {},
  ) => {
    const params = new URLSearchParams();
    if (options.command) params.set("command", options.command);
    if (options.refresh) params.set("refresh", "1");
    const qs = params.toString() ? `?${params}` : "";
    return request<{ models: ModelListResult }>(
      `/api/adapters/${kind}/models${qs}`,
    );
  },
  testAdapter: (
    kind: string,
    body: {
      config: Record<string, unknown>;
      prompt?: string;
      cwd?: string;
    },
  ) =>
    request<{ test: TestAdapterResult }>(`/api/adapters/${kind}/test`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listProjects: () => request<{ projects: Project[] }>("/api/projects"),
  getProject: (id: string) => request<{ project: Project }>(`/api/projects/${id}`),
  createProject: (body: CreateProjectBody) =>
    request<{ project: Project }>("/api/projects", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateProject: (id: string, body: UpdateProjectBody) =>
    request<{ project: Project }>(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteProject: (id: string) =>
    request<void>(`/api/projects/${id}`, { method: "DELETE" }),
  openInEditor: (id: string, body: OpenInEditorBody = {}) =>
    request<{ ok: true; editor: PreferredEditor; command: string }>(
      `/api/projects/${id}/open-in-editor`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  getProjectTree: (id: string, path?: string) => {
    const qs = path ? `?path=${encodeURIComponent(path)}` : "";
    return request<{ entries: TreeEntry[] }>(`/api/projects/${id}/tree${qs}`);
  },
  getProjectFile: (id: string, path: string) =>
    request<{ file: FileContent }>(
      `/api/projects/${id}/file?path=${encodeURIComponent(path)}`,
    ),
  getProjectFileHistory: (id: string, path: string) =>
    request<{ entries: FileHistoryEntry[] }>(
      `/api/projects/${id}/file-history?path=${encodeURIComponent(path)}`,
    ),
  getProjectTouched: (id: string) =>
    request<{ paths: TouchedPath[] }>(`/api/projects/${id}/touched`),
  getProjectActiveTouches: (id: string) =>
    request<{ touches: ActiveTouch[] }>(`/api/projects/${id}/active-touches`),
  getProjectActiveTools: (id: string) =>
    request<{ tools: ActiveToolsForAgent[] }>(
      `/api/projects/${id}/active-tools`,
    ),
  getProjectEnv: (id: string) =>
    request<{ env: Record<string, string> }>(`/api/projects/${id}/env`),
  setProjectEnv: (id: string, env: Record<string, string>) =>
    request<{ env: Record<string, string> }>(`/api/projects/${id}/env`, {
      method: "PUT",
      body: JSON.stringify({ env }),
    }),
  getProjectFilesFlat: (id: string) =>
    request<{ paths: string[] }>(`/api/projects/${id}/files-flat`),

  // ── Git
  getGitStatus: (id: string) =>
    request<{ status: GitStatus }>(`/api/projects/${id}/git/status`),
  getGitDiff: (
    id: string,
    path: string,
    opts: { staged?: boolean; untracked?: boolean } = {},
  ) => {
    const qs = new URLSearchParams({ path });
    if (opts.staged) qs.set("staged", "1");
    if (opts.untracked) qs.set("untracked", "1");
    return request<{ diff: string }>(
      `/api/projects/${id}/git/diff?${qs.toString()}`,
    );
  },
  gitStage: (id: string, paths: string[]) =>
    request<{ ok: true }>(`/api/projects/${id}/git/stage`, {
      method: "POST",
      body: JSON.stringify({ paths }),
    }),
  gitUnstage: (id: string, paths: string[]) =>
    request<{ ok: true }>(`/api/projects/${id}/git/unstage`, {
      method: "POST",
      body: JSON.stringify({ paths }),
    }),
  gitCommit: (id: string, message: string) =>
    request<{ sha: string }>(`/api/projects/${id}/git/commit`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
  getGitLog: (id: string, opts: { limit?: number; all?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (opts.limit) qs.set("limit", String(opts.limit));
    if (opts.all) qs.set("all", "1");
    const tail = qs.toString();
    return request<{ entries: GitLogEntry[] }>(
      `/api/projects/${id}/git/log${tail ? `?${tail}` : ""}`,
    );
  },
  getGitBranches: (id: string) =>
    request<{ branches: GitBranchInfo[] }>(
      `/api/projects/${id}/git/branches`,
    ),
  gitCheckout: (id: string, branch: string) =>
    request<{ ok: true }>(`/api/projects/${id}/git/checkout`, {
      method: "POST",
      body: JSON.stringify({ branch }),
    }),

  listAgents: (filter: { projectId?: string } = {}) => {
    const qs = filter.projectId ? `?projectId=${filter.projectId}` : "";
    return request<{ agents: Agent[] }>(`/api/agents${qs}`);
  },
  getAgent: (id: string) => request<{ agent: Agent }>(`/api/agents/${id}`),
  createAgent: (body: CreateAgentBody) =>
    request<{ agent: Agent }>("/api/agents", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateAgent: (id: string, body: UpdateAgentBody) =>
    request<{ agent: Agent }>(`/api/agents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteAgent: (id: string) =>
    request<void>(`/api/agents/${id}`, { method: "DELETE" }),

  listRuns: (
    filter: {
      agentId?: string;
      threadId?: string;
      parentRunId?: string;
      status?: RunStatus;
      limit?: number;
    } = {},
  ) => {
    const qs = new URLSearchParams();
    if (filter.agentId) qs.set("agentId", filter.agentId);
    if (filter.threadId) qs.set("threadId", filter.threadId);
    if (filter.parentRunId) qs.set("parentRunId", filter.parentRunId);
    if (filter.status) qs.set("status", filter.status);
    if (filter.limit) qs.set("limit", String(filter.limit));
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<{ runs: Run[] }>(`/api/runs${suffix}`);
  },
  getRun: (id: string) => request<{ run: Run }>(`/api/runs/${id}`),
  getRunError: (id: string) =>
    request<{ stderr: string | null }>(`/api/runs/${id}/error`),
  getRunResult: (id: string) =>
    request<{ resultText: string | null }>(`/api/runs/${id}/result`),
  getRunChanges: (id: string) =>
    request<{ changes: RunChange[] }>(`/api/runs/${id}/changes`),
  /** Returns the unified-diff text for a single file in a run. */
  getRunPatch: async (id: string, path: string): Promise<string> => {
    const res = await fetch(
      `/api/runs/${id}/changes/patch?path=${encodeURIComponent(path)}`,
    );
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.text();
  },
  createRun: (body: CreateRunBody) =>
    request<{ run: Run }>("/api/runs", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  cancelRun: (id: string) =>
    request<{ ok: true }>(`/api/runs/${id}/cancel`, { method: "POST" }),

  listSpecs: (filter: { agentId?: string } = {}) => {
    const qs = new URLSearchParams();
    if (filter.agentId) qs.set("agentId", filter.agentId);
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<{ specs: Spec[] }>(`/api/specs${suffix}`);
  },
  getSpec: (id: string) => request<{ spec: Spec }>(`/api/specs/${id}`),
  createSpec: (body: CreateSpecBody) =>
    request<{ spec: Spec }>("/api/specs", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateSpec: (id: string, body: UpdateSpecBody) =>
    request<{ spec: Spec }>(`/api/specs/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteSpec: (id: string) =>
    request<void>(`/api/specs/${id}`, { method: "DELETE" }),

  listThreads: (
    filter: { projectId?: string; status?: ThreadStatus; limit?: number } = {},
  ) => {
    const qs = new URLSearchParams();
    if (filter.projectId) qs.set("projectId", filter.projectId);
    if (filter.status) qs.set("status", filter.status);
    if (filter.limit) qs.set("limit", String(filter.limit));
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<{ threads: Thread[] }>(`/api/threads${suffix}`);
  },
  getThread: (id: string) =>
    request<{ thread: Thread }>(`/api/threads/${id}`),
  createThread: (body: CreateThreadBody) =>
    request<{ thread: Thread }>("/api/threads", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateThread: (id: string, body: UpdateThreadBody) =>
    request<{ thread: Thread }>(`/api/threads/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteThread: (id: string) =>
    request<void>(`/api/threads/${id}`, { method: "DELETE" }),
  resetThreadSession: (id: string) =>
    request<{ cleared: number }>(`/api/threads/${id}/reset-session`, {
      method: "POST",
    }),
};
