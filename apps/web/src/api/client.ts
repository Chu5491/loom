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
  SkillSpec,
  TestAdapterResult,
  Thread,
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

  // 스킬 딸린 파일(폴더 스킬). 단일 .md 스킬에 파일을 추가하면 폴더로 자동 승격.
  getSkillFile: (name: string, path: string) =>
    request<{ content: string }>(`/api/office/skills/${name}/file?path=${encodeURIComponent(path)}`),
  putSkillFile: (name: string, path: string, content: string) =>
    request<{ skill: SkillSpec }>(`/api/office/skills/${name}/file`, {
      method: "PUT",
      body: JSON.stringify({ path, content }),
    }),
  deleteSkillFile: (name: string, path: string) =>
    request<{ ok: boolean }>(`/api/office/skills/${name}/file`, {
      method: "DELETE",
      body: JSON.stringify({ path }),
    }),

  // .md/.zip 업로드 가져오기 — base64 JSON (멀티파트 의존성 없이).
  importSkillArchive: async (file: File) =>
    request<{ skill: SkillSpec }>("/api/office/skills/import", {
      method: "POST",
      body: JSON.stringify({ filename: file.name, dataBase64: await fileToBase64(file) }),
    }),
  importRulesArchive: async (file: File) =>
    request<{ rules: { name: string }[] }>("/api/office/rules/import", {
      method: "POST",
      body: JSON.stringify({ filename: file.name, dataBase64: await fileToBase64(file) }),
    }),

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

  /** 폴더 피커 — 로컬 디렉토리 탐색(디렉토리만, 숨김 제외). path 없으면 홈. */
  listDirs: (path?: string) =>
    request<{ path: string; parent: string | null; home: string; dirs: { name: string; path: string }[] }>(
      `/api/fs/dirs${path ? `?path=${encodeURIComponent(path)}` : ""}`,
    ),

  /** Talk 컴포저 @file 멘션 — 프로젝트 디렉토리 파일 검색(상대경로 최대 20개). */
  searchProjectFiles: (projectId: string, q: string) =>
    request<{ files: string[] }>(`/api/projects/${projectId}/files?q=${encodeURIComponent(q)}`),

  // ── threads (대화 단위 — 같은 스레드의 연속 턴은 CLI 세션이 이어진다) ────────
  listThreads: (projectId: string | null) =>
    request<{ threads: Thread[] }>(`/api/threads?projectId=${projectId ?? "none"}`),
  createThread: (name: string, projectId: string | null) =>
    request<{ thread: Thread }>("/api/threads", {
      method: "POST",
      body: JSON.stringify({ name, projectId }),
    }),
  renameThread: (id: string, name: string) =>
    request<{ ok: boolean }>(`/api/threads/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  deleteThread: (id: string) =>
    request<{ ok: boolean }>(`/api/threads/${id}`, { method: "DELETE" }),

  // ── runs (Talk) ────────────────────────────────────────────────────────
  /** threadId 스코프가 Talk 의 기본. 없으면 빈 스레드로 간주해 호출하지 않는다. */
  listRuns: (threadId: string) =>
    request<{ runs: RunInfo[] }>(`/api/runs?threadId=${encodeURIComponent(threadId)}`),

  startRun: (body: { agent: string; prompt: string; cwd?: string; projectId?: string | null; threadId?: string; skills?: string[] }) =>
    request<{ run: RunInfo }>("/api/runs", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** 스마트 디스패치 — 작업 설명으로 적합 에이전트를 골라 시작(라우팅만, 주입 없음). */
  dispatchRun: (body: { prompt: string; projectId?: string | null; threadId?: string; skills?: string[] }) =>
    request<{ run: RunInfo; pick: { agent: string; score: number; matched: string[] } }>("/api/runs/dispatch", {
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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    // data:...;base64, 프리픽스 제거
    r.onload = () => resolve(String(r.result).split(",", 2)[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
