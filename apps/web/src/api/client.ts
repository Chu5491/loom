import type {
  AdapterManifest,
  AdapterProbeResult,
  Agent,
  ModelListResult,
  Project,
  Run,
  RunStatus,
  Spec,
  TestAdapterResult,
} from "@loom/core";

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
}

export type UpdateProjectBody = Partial<CreateProjectBody>;

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
  parentRunId?: string | null;
  attachedSpecIds?: string[];
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
      parentRunId?: string;
      status?: RunStatus;
      limit?: number;
    } = {},
  ) => {
    const qs = new URLSearchParams();
    if (filter.agentId) qs.set("agentId", filter.agentId);
    if (filter.parentRunId) qs.set("parentRunId", filter.parentRunId);
    if (filter.status) qs.set("status", filter.status);
    if (filter.limit) qs.set("limit", String(filter.limit));
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<{ runs: Run[] }>(`/api/runs${suffix}`);
  },
  getRun: (id: string) => request<{ run: Run }>(`/api/runs/${id}`),
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
};
