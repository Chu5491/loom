// v2-core API 클라이언트 — 어댑터 허브 4종 호출이 전부.

import type {
  AdapterManifest,
  AdapterProbeResult,
  AgentSpec,
  HarnessEdge,
  McpServer,
  ModelListResult,
  Office,
  Project,
  RunInfo,
  TestAdapterResult,
} from "@loom/core";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return (await res.json()) as T;
}

export const api = {
  listAdapters: () =>
    request<{ adapters: AdapterManifest[] }>("/api/adapters"),

  probeAdapter: (kind: string, opts: { command?: string; refresh?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (opts.command) qs.set("command", opts.command);
    if (opts.refresh) qs.set("refresh", "1");
    const tail = qs.toString() ? `?${qs}` : "";
    return request<{ probe: AdapterProbeResult }>(`/api/adapters/${kind}/probe${tail}`);
  },

  /** POST — env(API 키)가 URL에 남지 않도록. */
  listAdapterModels: (
    kind: string,
    opts: { command?: string; refresh?: boolean; env?: Record<string, string> } = {},
  ) =>
    request<{ models: ModelListResult }>(`/api/adapters/${kind}/models`, {
      method: "POST",
      body: JSON.stringify(opts),
    }),

  testAdapter: (
    kind: string,
    body: { config: Record<string, unknown>; prompt?: string; cwd?: string },
  ) =>
    request<{ test: TestAdapterResult }>(`/api/adapters/${kind}/test`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── office-as-code ─────────────────────────────────────────────────────
  getOffice: () => request<{ office: Office }>("/api/office"),

  putRule: (name: string, body: string) =>
    request<unknown>(`/api/office/rules/${name}`, {
      method: "PUT",
      body: JSON.stringify({ body }),
    }),
  deleteRule: (name: string) =>
    request<unknown>(`/api/office/rules/${name}`, { method: "DELETE" }),

  putSkill: (name: string, description: string, body: string) =>
    request<unknown>(`/api/office/skills/${name}`, {
      method: "PUT",
      body: JSON.stringify({ description, body }),
    }),
  deleteSkill: (name: string) =>
    request<unknown>(`/api/office/skills/${name}`, { method: "DELETE" }),

  putAgent: (name: string, spec: Omit<AgentSpec, "name">) =>
    request<unknown>(`/api/office/agents/${name}`, {
      method: "PUT",
      body: JSON.stringify(spec),
    }),
  deleteAgent: (name: string) =>
    request<unknown>(`/api/office/agents/${name}`, { method: "DELETE" }),

  putMcp: (servers: McpServer[]) =>
    request<unknown>("/api/office/mcp", {
      method: "PUT",
      body: JSON.stringify({ servers }),
    }),

  putHarness: (edges: HarnessEdge[]) =>
    request<unknown>("/api/office/harness", {
      method: "PUT",
      body: JSON.stringify({ edges }),
    }),

  // ── projects (작업 디렉토리) ─────────────────────────────────────────────
  listProjects: () => request<{ projects: Project[] }>("/api/projects"),
  createProject: (name: string, path: string) =>
    request<{ project: Project }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name, path }),
    }),
  deleteProject: (id: string) =>
    request<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),

  /** Talk 컴포저 @file 멘션 — 프로젝트 디렉토리 파일 검색(상대경로 최대 20개). */
  searchProjectFiles: (projectId: string, q: string) =>
    request<{ files: string[] }>(`/api/projects/${projectId}/files?q=${encodeURIComponent(q)}`),

  // ── runs (Talk) ────────────────────────────────────────────────────────
  // projectId 없으면 전체, "none" 이면 프로젝트 없는 run, id 면 그 프로젝트.
  listRuns: (projectId?: string | null) =>
    request<{ runs: RunInfo[] }>(`/api/runs${projectId === undefined ? "" : `?projectId=${projectId ?? "none"}`}`),

  startRun: (body: { agent: string; prompt: string; cwd?: string; projectId?: string | null; skills?: string[] }) =>
    request<{ run: RunInfo }>("/api/runs", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  cancelRun: (id: string) =>
    request<{ ok: boolean }>(`/api/runs/${id}/cancel`, { method: "POST" }),

  /** 기록 삭제 — running 은 409(먼저 취소). user+agent 버블이 함께 사라진다. */
  deleteRun: (id: string) =>
    request<{ ok: boolean }>(`/api/runs/${id}`, { method: "DELETE" }),

  /** ask/manual 엣지 수동 발화 — 완료된 run 에서 to 에이전트로 핸드오프. */
  handoffRun: (id: string, to: string) =>
    request<{ run: RunInfo }>(`/api/runs/${id}/handoff`, {
      method: "POST",
      body: JSON.stringify({ to }),
    }),
};

/** SSE 구독 URL — EventSource 가 직접 연다(`event`/`done` 네임드 이벤트). */
export const runEventsUrl = (id: string) => `/api/runs/${id}/events`;
