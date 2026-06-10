import type {
  ActiveToolsForAgent,
  ActiveTouch,
  AdapterManifest,
  AdapterProbeResult,
  Agent,
  ApiKeyStatus,
  ApiKeyStatuses,
  Delegation,
  FileContent,
  FileHistoryEntry,
  GeminiSyncReport,
  GeminiSyncStatus,
  GhProbe,
  HarnessEdge,
  HarnessMode,
  HarnessTrigger,
  ScheduledRun,
  GitAuthStatus,
  GitBranchInfo,
  GitCollaborator,
  GitCommitInfo,
  GitCreatePrResult,
  GitLogEntry,
  GitOrg,
  GitRepo,
  GitStashEntry,
  GitStatus,
  GitWorkingChange,
  InsightsAgent,
  InsightsDaily,
  InsightsFile,
  InsightsProject,
  InsightsSummary,
  InsightsWorkspaceAgent,
  LoomSettings,
  McpServer,
  ModelListResult,
  PreferredEditor,
  Project,
  ProjectInsights,
  Review,
  ReviewStatus,
  Run,
  RunChange,
  RunStatus,
  SearchResult,
  Spec,
  TestAdapterResult,
  Thread,
  ThreadStatus,
  TouchedPath,
  TreeEntry,
  WorkspaceInsights,
} from "@loom/core";

// @loom/core 에서 re-export — 기존 `import { GitStatus } from "../api/client"` 를 깨지 않도록.
export type {
  ApiKeyStatus,
  ApiKeyStatuses,
  GeminiSyncReport,
  GeminiSyncStatus,
  GhProbe,
  GitBranchInfo,
  GitCollaborator,
  GitCommitInfo,
  GitCreatePrResult,
  GitLogEntry,
  GitStashEntry,
  GitStatus,
  GitWorkingChange,
  InsightsAgent,
  InsightsDaily,
  InsightsFile,
  InsightsProject,
  InsightsSummary,
  InsightsWorkspaceAgent,
  LoomSettings,
  ProjectInsights,
  WorkspaceInsights,
};

// ── Marketplace (서버가 inline으로 응답 — core에 타입 없음) ──

export interface SkillMarketplaceEntry {
  id: string;
  name: string;
  description: string;
  source?: string;
  publisher: "loom" | "Anthropic" | "Community";
  tags: string[];
  content: string;
}

export interface McpMarketplaceEntry {
  id: string;
  name: string;
  description: string;
  source: string;
  publisher: "Anthropic" | "Community";
  tags: string[];
  template:
    | {
        kind: "stdio";
        command: string;
        args: string[];
        env: Record<string, string>;
      }
    | {
        kind: "http" | "sse";
        url: string;
        headers: Record<string, string>;
      };
  placeholders?: Array<{
    where: string;
    label: string;
    hint?: string;
  }>;
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
  /** Local path 모드 — 둘 중 하나는 필수. */
  path?: string;
  /** Clone 모드 — git URL. 서버가 ~/.loom/data/repos/<id>/ 로 clone 하고
   *  project.path 를 그 위치로 채움. */
  cloneUrl?: string;
  description?: string | null;
  preferredEditor?: PreferredEditor | null;
}

/** Update 는 path 와 cloneUrl 둘 다 안 받음 — 정체성에 가까운 필드라 변경 막음. */
export type UpdateProjectBody = Partial<
  Omit<CreateProjectBody, "path" | "cloneUrl">
> & { path?: string };


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
  mcpServerIds?: string[];
  role?: string | null;
  adapterKind: string;
  adapterConfig?: Record<string, unknown>;
  defaultCwd?: string | null;
}

export interface CreateMcpServerBody {
  name: string;
  description?: string | null;
  kind: "stdio" | "http" | "sse";
  command?: string | null;
  args?: string[];
  env?: Record<string, string>;
  url?: string | null;
  headers?: Record<string, string>;
}

export type UpdateMcpServerBody = Partial<CreateMcpServerBody>;

export type UpdateAgentBody = Partial<CreateAgentBody>;

export interface CreateRunBody {
  agentId: string;
  prompt: string;
  cwd?: string;
  /** 새 thread 를 만들 프로젝트(전역 에이전트가 어느 팀에서 도는지). */
  projectId?: string | null;
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

export interface CreateScheduleBody {
  agentId: string;
  name: string;
  prompt: string;
  cron: string;
  timezone?: string | null;
  cwd?: string | null;
  enabled?: boolean;
}

export type UpdateScheduleBody = Partial<Omit<CreateScheduleBody, "agentId">>;

export interface CreateHarnessEdgeBody {
  projectId: string;
  fromAgentId: string;
  toAgentId: string;
  trigger: HarnessTrigger;
  prompt?: string | null;
  carryResult?: boolean;
  mode?: HarnessMode;
}

export interface UpdateHarnessEdgeBody {
  trigger?: HarnessTrigger;
  prompt?: string | null;
  carryResult?: boolean;
  mode?: HarnessMode;
}


export const api = {
  health: () => request<{ status: string; name: string; version: string }>("/api/health"),

  getSettings: () => request<{ settings: LoomSettings }>("/api/settings"),
  getGlobalRule: () =>
    request<{ content: string }>("/api/settings/global-rule"),
  putGlobalRule: (content: string) =>
    request<{ settings: LoomSettings }>("/api/settings/global-rule", {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),

  /** API 키 상태 (configured + source). 실제 값은 절대 안 보냄. */
  getApiKeys: () => request<ApiKeyStatuses>("/api/settings/api-keys"),
  /** 키 저장. null = clear, undefined = no-op, string = new value. */
  putApiKeys: (body: {
    smithery?: string | null;
    skillsSh?: string | null;
  }) =>
    request<ApiKeyStatuses>("/api/settings/api-keys", {
      method: "PUT",
      body: JSON.stringify(body),
    }),


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
    options: {
      command?: string;
      refresh?: boolean;
      /** Agent env (API keys). POSTed in the body — provider-API adapters read
       *  the key from here to fetch live models. Never goes in the URL. */
      env?: Record<string, string>;
    } = {},
  ) =>
    request<{ models: ModelListResult }>(`/api/adapters/${kind}/models`, {
      method: "POST",
      body: JSON.stringify(options),
    }),
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
  getProjectActiveRuns: (id: string) =>
    request<{ runs: Run[] }>(`/api/projects/${id}/active-runs`),
  getProjectInsights: (id: string, windowDays = 30) =>
    request<ProjectInsights>(
      `/api/projects/${id}/insights?windowDays=${windowDays}`,
    ),
  getWorkspaceInsights: (windowDays = 30) =>
    request<WorkspaceInsights>(`/api/insights?windowDays=${windowDays}`),
  getProjectActiveTools: (id: string) =>
    request<{ tools: ActiveToolsForAgent[] }>(
      `/api/projects/${id}/active-tools`,
    ),
  getProjectActiveDelegations: (id: string) =>
    request<{ delegations: Delegation[] }>(
      `/api/projects/${id}/active-delegations`,
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
  getGitSides: (
    id: string,
    path: string,
    opts: { staged?: boolean; untracked?: boolean } = {},
  ) => {
    const qs = new URLSearchParams({ path });
    if (opts.staged) qs.set("staged", "1");
    if (opts.untracked) qs.set("untracked", "1");
    return request<{ before: string; after: string }>(
      `/api/projects/${id}/git/sides?${qs.toString()}`,
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
  getGitCollaborators: (id: string) =>
    request<{ collaborators: GitCollaborator[] }>(
      `/api/projects/${id}/git/collaborators`,
    ),
  getCommit: (id: string, sha: string) =>
    request<{ commit: GitCommitInfo }>(
      `/api/projects/${id}/git/commits/${sha}`,
    ),
  getCommitFileDiff: (id: string, sha: string, path: string) =>
    request<{ diff: string }>(
      `/api/projects/${id}/git/commits/${sha}/diff?path=${encodeURIComponent(path)}`,
    ),
  gitCheckout: (id: string, branch: string) =>
    request<{ ok: true }>(`/api/projects/${id}/git/checkout`, {
      method: "POST",
      body: JSON.stringify({ branch }),
    }),

  // ── branches: create / rename / delete
  gitCreateBranch: (
    id: string,
    body: { name: string; startPoint?: string; checkout?: boolean },
  ) =>
    request<{ ok: true }>(`/api/projects/${id}/git/branches`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  gitRenameBranch: (id: string, oldName: string, newName: string) =>
    request<{ ok: true }>(`/api/projects/${id}/git/branches`, {
      method: "PATCH",
      body: JSON.stringify({ oldName, newName }),
    }),
  gitDeleteBranch: (id: string, name: string, opts: { force?: boolean } = {}) =>
    request<{ ok: true }>(
      `/api/projects/${id}/git/branches/${encodeURIComponent(name)}${opts.force ? "?force=1" : ""}`,
      { method: "DELETE" },
    ),

  // ── stash
  gitListStash: (id: string) =>
    request<{ entries: GitStashEntry[] }>(`/api/projects/${id}/git/stash`),
  gitSaveStash: (
    id: string,
    body: { message?: string; includeUntracked?: boolean } = {},
  ) =>
    request<{ ok: true }>(`/api/projects/${id}/git/stash`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  gitPopStash: (id: string, idx: number) =>
    request<{ ok: true }>(`/api/projects/${id}/git/stash/${idx}/pop`, {
      method: "POST",
    }),
  gitApplyStash: (id: string, idx: number) =>
    request<{ ok: true }>(`/api/projects/${id}/git/stash/${idx}/apply`, {
      method: "POST",
    }),
  gitDropStash: (id: string, idx: number) =>
    request<{ ok: true }>(`/api/projects/${id}/git/stash/${idx}`, {
      method: "DELETE",
    }),

  // ── apply-patch (hunk staging)
  gitApplyPatch: (
    id: string,
    body: { patch: string; cached?: boolean; reverse?: boolean },
  ) =>
    request<{ ok: true }>(`/api/projects/${id}/git/apply-patch`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── PR (gh)
  gitProbeGh: (id: string) =>
    request<GhProbe>(`/api/projects/${id}/git/pr-probe`),
  gitCreatePr: (
    id: string,
    body: { title: string; body: string; base?: string; draft?: boolean },
  ) =>
    request<GitCreatePrResult>(`/api/projects/${id}/git/pr`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  gitFetch: (
    id: string,
    opts: { remote?: string; prune?: boolean } = {},
  ) =>
    request<{ ok: true; output: string }>(`/api/projects/${id}/git/fetch`, {
      method: "POST",
      body: JSON.stringify(opts),
    }),
  gitPull: (
    id: string,
    opts: { remote?: string; branch?: string; rebase?: boolean } = {},
  ) =>
    request<{ ok: true; output: string }>(`/api/projects/${id}/git/pull`, {
      method: "POST",
      body: JSON.stringify(opts),
    }),
  gitPush: (
    id: string,
    opts: {
      remote?: string;
      branch?: string;
      setUpstream?: boolean;
      force?: boolean;
    } = {},
  ) =>
    request<{ ok: true; output: string }>(`/api/projects/${id}/git/push`, {
      method: "POST",
      body: JSON.stringify(opts),
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
  /** 전역 에이전트를 프로젝트 팀에 추가. */
  addAgentToProject: (agentId: string, projectId: string) =>
    request<{ ok: true }>(`/api/agents/${agentId}/team`, {
      method: "POST",
      body: JSON.stringify({ projectId }),
    }),
  /** 프로젝트 팀에서 제거(그 프로젝트의 관련 하네스 엣지도 정리). */
  removeAgentFromProject: (agentId: string, projectId: string) =>
    request<{ ok: true }>(`/api/agents/${agentId}/team/${projectId}`, {
      method: "DELETE",
    }),

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
  /** Returns before/after full text for side-by-side diff (Monaco DiffEditor). */
  getRunSides: (id: string, path: string) =>
    request<{ before: string; after: string }>(
      `/api/runs/${id}/changes/sides?path=${encodeURIComponent(path)}`,
    ),
  createRun: (body: CreateRunBody) =>
    request<{ run: Run }>("/api/runs", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  cancelRun: (id: string) =>
    request<{ ok: true }>(`/api/runs/${id}/cancel`, { method: "POST" }),
  rollbackRun: (id: string) =>
    request<{ ok: true; safetyRef: string | null }>(
      `/api/runs/${id}/rollback`,
      { method: "POST" },
    ),

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
  listSkillMarketplace: (source: "all" | "builtin" | "skills.sh" = "all") =>
    request<{
      entries: SkillMarketplaceEntry[];
      sources: { skillsShEnabled: boolean };
    }>(`/api/specs/marketplace?source=${source}`),
  /** skills.sh entry 의 SKILL.md 본문. Install 클릭 시점에 lazy fetch.
   *  builtin entry 도 같은 endpoint 로 — 서버가 source 분기. */
  getSkillMarketplaceContent: (id: string) =>
    request<{ content: string }>(
      `/api/specs/marketplace/content?id=${encodeURIComponent(id)}`,
    ),
  deleteSpec: (id: string) =>
    request<void>(`/api/specs/${id}`, { method: "DELETE" }),

  listMcpServers: () =>
    request<{ servers: McpServer[] }>("/api/mcp-servers"),
  listMcpMarketplace: (
    source: "all" | "official" | "smithery" | "builtin" = "all",
  ) =>
    request<{
      entries: McpMarketplaceEntry[];
      sources: { smitheryEnabled: boolean };
    }>(`/api/mcp-servers/marketplace?source=${source}`),
  getMcpServer: (id: string) =>
    request<{ server: McpServer }>(`/api/mcp-servers/${id}`),
  createMcpServer: (body: CreateMcpServerBody) =>
    request<{ server: McpServer }>("/api/mcp-servers", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateMcpServer: (id: string, body: UpdateMcpServerBody) =>
    request<{ server: McpServer }>(`/api/mcp-servers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteMcpServer: (id: string) =>
    request<void>(`/api/mcp-servers/${id}`, { method: "DELETE" }),

  // gemini-sync — settings.json mirroring on/off + manual run + snippet
  getGeminiSyncStatus: () =>
    request<{ status: GeminiSyncStatus }>("/api/gemini-sync/status"),
  runGeminiSync: (force = false) =>
    request<{ report: GeminiSyncReport; status: GeminiSyncStatus }>(
      "/api/gemini-sync/run",
      { method: "POST", body: JSON.stringify({ force }) },
    ),
  setGeminiSyncEnabled: (enabled: boolean) =>
    request<{ status: GeminiSyncStatus }>("/api/gemini-sync/settings", {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
  getGeminiSnippet: () =>
    request<{ snippet: string }>("/api/gemini-sync/snippet"),

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
  getThreadCiStatus: (id: string) =>
    request<{
      checks: import("@loom/core").CiCheck[];
      overall: import("@loom/core").CiOverall;
    }>(`/api/threads/${id}/ci-status`),

  // ── Webhooks
  getWebhookSecret: () =>
    request<{ secret: string }>("/api/webhooks/secret"),
  rotateWebhookSecret: () =>
    request<{ secret: string }>("/api/webhooks/secret/rotate", {
      method: "POST",
    }),

  // ── Git Account
  getGitAuthStatus: () =>
    request<GitAuthStatus>("/api/git-account/auth-status"),
  getGitRepos: (opts: { org?: string; limit?: number; sort?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.org) qs.set("org", opts.org);
    if (opts.limit) qs.set("limit", String(opts.limit));
    if (opts.sort) qs.set("sort", opts.sort);
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<{ repos: GitRepo[] }>(`/api/git-account/repos${suffix}`);
  },
  getGitOrgs: () =>
    request<{ orgs: GitOrg[] }>("/api/git-account/orgs"),
  searchGitRepos: (q: string, limit = 20) =>
    request<{ repos: GitRepo[] }>(
      `/api/git-account/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),

  // ── Search
  search: (q: string, opts?: { projectId?: string; limit?: number }) => {
    const params = new URLSearchParams({ q });
    if (opts?.projectId) params.set("projectId", opts.projectId);
    if (opts?.limit) params.set("limit", String(opts.limit));
    return request<{ results: SearchResult[] }>(`/api/search?${params}`);
  },

  // ── Reviews ────────────────────────────────────────────────────────────
  listReviews: (threadId: string) =>
    request<{ reviews: Review[] }>(`/api/reviews?threadId=${threadId}`),

  createReview: (input: { threadId: string; reviewerAgentId: string }) =>
    request<{ review: Review }>("/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),

  updateReviewStatus: (id: string, status: ReviewStatus) =>
    request<{ review: Review }>(`/api/reviews/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }),

  // ── Schedules (cron-driven runs) ─────────────────────────────────────────
  listSchedules: (filter: { agentId?: string } = {}) => {
    const qs = filter.agentId ? `?agentId=${filter.agentId}` : "";
    return request<{ schedules: ScheduledRun[] }>(`/api/schedules${qs}`);
  },
  getSchedule: (id: string) =>
    request<{ schedule: ScheduledRun }>(`/api/schedules/${id}`),
  createSchedule: (body: CreateScheduleBody) =>
    request<{ schedule: ScheduledRun }>("/api/schedules", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateSchedule: (id: string, body: UpdateScheduleBody) =>
    request<{ schedule: ScheduledRun }>(`/api/schedules/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteSchedule: (id: string) =>
    request<{ ok: true }>(`/api/schedules/${id}`, { method: "DELETE" }),

  // ── Harness (agent-to-agent handoff edges) ───────────────────────────────
  listHarnessEdges: (projectId: string) =>
    request<{ edges: HarnessEdge[] }>(
      `/api/harness?projectId=${encodeURIComponent(projectId)}`,
    ),
  createHarnessEdge: (body: CreateHarnessEdgeBody) =>
    request<{ edge: HarnessEdge }>("/api/harness", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateHarnessEdge: (id: string, body: UpdateHarnessEdgeBody) =>
    request<{ edge: HarnessEdge }>(`/api/harness/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteHarnessEdge: (id: string) =>
    request<{ ok: true }>(`/api/harness/${id}`, { method: "DELETE" }),
};
