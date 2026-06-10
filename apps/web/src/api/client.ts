// v2-core API 클라이언트 — 어댑터 허브 4종 호출이 전부.

import type {
  AdapterManifest,
  AdapterProbeResult,
  AgentSpec,
  HarnessEdge,
  McpServer,
  ModelListResult,
  Office,
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
};
