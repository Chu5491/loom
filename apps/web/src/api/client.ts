// v2-core API 클라이언트 — 어댑터 허브 4종 호출이 전부.

import type {
  AdapterManifest,
  AdapterProbeResult,
  AgentSpec,
  BudgetSpec,
  McpServer,
  ModelListResult,
  Office,
  Project,
  RunInfo,
  RunSearchHit,
  SkillSpec,
  Schedule,
  TestAdapterResult,
  Thread,
  WorkflowGate,
  WorkflowSpec,
} from "@loom/core";

/** 스탠드업 — 서버 run/standup.ts 와 동일 형태. report 는 마크다운. */
export interface Standup {
  generatedAt: string;
  agent: string;
  runId: string;
  report: string;
}

/** 분석 리포트 — 서버 zod 스키마(project-files.ts)와 동일 형태. */
export interface AnalysisReport {
  summary: string;
  stack: string[];
  languages: { name: string; percent: number }[];
  health: { tests?: number; docs?: number; structure?: number; maintainability?: number };
  metrics: { files?: number; loc?: number };
  structure: { path: string; desc: string }[];
  keyFiles: { path: string; desc: string }[];
  risks: { text: string; severity: "high" | "medium" | "low" }[];
  suggestions: { text: string; effort: "small" | "medium" | "large" }[];
}
export interface ProjectAnalysis {
  analyzedAt: string;
  agent: string;
  runId: string;
  report: AnalysisReport;
}

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

  /** 기능 프롬프트 — 내장 기능(git 커밋·분석)의 조정 가능한 지침. */
  putFeaturePrompt: (name: string, body: string) =>
    request<unknown>(`/api/office/prompts/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify({ body }),
    }),

  /** 워크플로우 정의 저장/삭제 — office/workflows/<name>.json. */
  putWorkflow: ({ name, ...spec }: WorkflowSpec) =>
    request<{ workflow: WorkflowSpec }>(`/api/office/workflows/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify(spec),
    }),
  deleteWorkflow: (name: string) =>
    request<{ ok: boolean }>(`/api/office/workflows/${encodeURIComponent(name)}`, { method: "DELETE" }),
  /** 워크플로우 수동 실행 — entry run 을 받고, 나머지 스텝은 서버가 체인. */
  runWorkflow: (body: { workflow: string; input: string; projectId?: string; threadId?: string }) =>
    request<{ run: RunInfo }>("/api/runs/workflow", {
      method: "POST",
      body: JSON.stringify(body),
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

  // ── 프로젝트 파일·Git (워크스페이스 파일/Git 뷰) ─────────────────────────
  projectTree: (id: string, path = ".") =>
    request<{ dirs: { name: string; path: string }[]; files: { name: string; path: string }[] }>(
      `/api/projects/${id}/tree?path=${encodeURIComponent(path)}`,
    ),
  projectFile: (id: string, path: string) =>
    request<{ content: string }>(`/api/projects/${id}/file?path=${encodeURIComponent(path)}`),
  gitStatus: (id: string) =>
    request<{ git: boolean; branch: string | null; files: { staged: boolean; status: string; path: string }[] }>(
      `/api/projects/${id}/git/status`,
    ),
  gitVersions: (id: string, path: string) =>
    request<{ head: string | null; working: string | null }>(
      `/api/projects/${id}/git/versions?path=${encodeURIComponent(path)}`,
    ),
  gitStage: (id: string, paths: string[]) =>
    request<{ ok: boolean }>(`/api/projects/${id}/git/stage`, { method: "POST", body: JSON.stringify({ paths }) }),
  gitUnstage: (id: string, paths: string[]) =>
    request<{ ok: boolean }>(`/api/projects/${id}/git/unstage`, { method: "POST", body: JSON.stringify({ paths }) }),
  /** staged diff 로 커밋 메시지 초안 생성 — 지정 에이전트의 유틸 run(스레드 없음). */
  gitSuggestCommit: (id: string, agent: string) =>
    request<{ message: string }>(`/api/projects/${id}/git/suggest-commit`, {
      method: "POST",
      body: JSON.stringify({ agent }),
    }),
  gitCommit: (id: string, message: string) =>
    request<{ ok: boolean; output: string }>(`/api/projects/${id}/git/commit`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
  /** 프로젝트 분석 — 최신 리포트 + 히스토리(최근 20개, 건강도 추이의 원천). */
  getProjectAnalysis: (id: string) =>
    request<{ analysis: ProjectAnalysis | null; history?: ProjectAnalysis[] }>(`/api/projects/${id}/analysis`),
  analyzeProject: (id: string, agent: string, lang: "en" | "ko") =>
    request<{ analysis: ProjectAnalysis }>(`/api/projects/${id}/analyze`, {
      method: "POST",
      body: JSON.stringify({ agent, lang }),
    }),

  agentActivity: (id: string) =>
    request<{ activity: { runId: string; agent: string; startedAt: string; files: { path: string; action: "edit" | "write" }[] }[] }>(
      `/api/projects/${id}/agent-activity`,
    ),

  /** 컴포저 드롭/붙여넣기 첨부 — data/uploads/ 에 저장하고 절대경로를 받는다. */
  uploadAttachment: async (file: File) =>
    request<{ path: string; name: string; bytes: number }>("/api/uploads", {
      method: "POST",
      body: JSON.stringify({ filename: file.name || "pasted-image.png", dataBase64: await fileToBase64(file) }),
    }),

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
  /** 전체 run (프로젝트 무관) — 관제센터의 팀 보드·활동 피드. */
  listRunsAll: () => request<{ runs: RunInfo[] }>("/api/runs"),

  /** 전문 검색 — 과거 run 의 prompt·결과 텍스트. ⌘K 팔레트가 소비. */
  searchRuns: (q: string) =>
    request<{ hits: RunSearchHit[] }>(`/api/runs/search?q=${encodeURIComponent(q)}`),

  startRun: (body: { agent: string; prompt: string; cwd?: string; projectId?: string | null; threadId?: string; skills?: string[] }) =>
    request<{ run: RunInfo }>("/api/runs", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** 투명성 — 이 run 에서 CLI 에 실제로 들어간 합성 프롬프트. */
  getRunPrompt: (id: string) =>
    request<{ prompt: string }>(`/api/runs/${id}/prompt`),
  /** 프리뷰 — run 없이, 이 에이전트로 시작하면 들어갈 합성 프롬프트(스킬 작성 확인용). */
  previewRun: (body: { agent: string; prompt?: string; skills?: string[] }) =>
    request<{ prompt: string }>("/api/runs/preview", { method: "POST", body: JSON.stringify(body) }),
  /** CLI raw 출력(진실) — run 상세의 Raw 탭. */
  getRunRaw: (id: string) =>
    request<{ raw: string }>(`/api/runs/${id}/raw`),

  cancelRun: (id: string) =>
    request<{ ok: boolean }>(`/api/runs/${id}/cancel`, { method: "POST" }),

  /** 재실행 — 같은 agent·prompt·project·thread 로 새 run. 실패/👎 다음 한 번 더. */
  rerunRun: (id: string) =>
    request<{ run: RunInfo }>(`/api/runs/${id}/rerun`, { method: "POST" }),

  /** 품질 평가 — 1=👍 -1=👎 null=해제. 에이전트 성과 통계의 원천. */
  rateRun: (id: string, rating: 1 | -1 | null) =>
    request<{ ok: boolean }>(`/api/runs/${id}/rating`, { method: "POST", body: JSON.stringify({ rating }) }),

  /** 에이전트 30일 성과 — 성공률 + 사람 평가. 오피스 인물 카드가 소비. */
  agentStats: (days = 30) =>
    request<{ days: number; stats: { agent: string; runs: number; succeeded: number; failed: number; thumbsUp: number; thumbsDown: number }[] }>(
      `/api/usage/agents?days=${days}`,
    ),

  /** 기록 삭제 — running 은 409(먼저 취소). user+agent 버블이 함께 사라진다. */
  deleteRun: (id: string) =>
    request<{ ok: boolean }>(`/api/runs/${id}`, { method: "DELETE" }),

  /** 사용량 — loom 이 기록한 run 수·비용 집계 (CLI 잔여 쿼터는 비공개라 소비량 기준). */
  getUsage: (days = 30) =>
    request<{
      days: number;
      totals: { runs: number; costUsd: number };
      byAgent: { agent: string; runs: number; costUsd: number }[];
      byDay: { day: string; runs: number; costUsd: number }[];
      month: { costUsd: number; budgetUsd: number | null };
    }>(`/api/usage?days=${days}`),

  // ── 예산 — office/budget.json (초과 시 새 run 거부) ──────────────────────────
  getBudget: () => request<{ budget: BudgetSpec }>("/api/office/budget"),
  putBudget: (budget: BudgetSpec) =>
    request<{ budget: BudgetSpec }>("/api/office/budget", { method: "PUT", body: JSON.stringify(budget) }),

  // ── 프로젝트 공유 메모 — <project>/.loom/notes.md (팀의 프로젝트 기억) ────────
  getNotes: (projectId: string) =>
    request<{ notes: string | null }>(`/api/projects/${projectId}/notes`),
  putNotes: (projectId: string, notes: string) =>
    request<{ ok: boolean }>(`/api/projects/${projectId}/notes`, { method: "PUT", body: JSON.stringify({ notes }) }),

  // ── 스탠드업 — 지난 24h run 기록 기반 데일리 리포트 ─────────────────────────
  getStandup: (projectId: string) =>
    request<{ standup: Standup | null; history: Standup[] }>(`/api/projects/${projectId}/standup`),
  runStandup: (projectId: string, agent: string, lang: "en" | "ko") =>
    request<{ standup: Standup }>(`/api/projects/${projectId}/standup`, {
      method: "POST",
      body: JSON.stringify({ agent, lang }),
    }),

  // ── schedules — cron 반복 실행 (머신-로컬) ─────────────────────────────────
  listSchedules: (projectId: string | null) =>
    request<{ schedules: Schedule[] }>(`/api/schedules?projectId=${projectId ?? "none"}`),
  createSchedule: (body: { name: string; agent: string; prompt: string; cron: string; workflow?: string | null; feature?: "standup" | null; projectId: string | null; enabled?: boolean }) =>
    request<{ schedule: Schedule }>("/api/schedules", { method: "POST", body: JSON.stringify(body) }),
  patchSchedule: (id: string, body: Partial<{ name: string; agent: string; prompt: string; cron: string; enabled: boolean }>) =>
    request<{ schedule: Schedule }>(`/api/schedules/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteSchedule: (id: string) =>
    request<{ ok: boolean }>(`/api/schedules/${id}`, { method: "DELETE" }),
  runScheduleNow: (id: string) =>
    request<{ run: RunInfo }>(`/api/schedules/${id}/run`, { method: "POST" }),

  // ── 휴먼 게이트 — 워크플로우가 사람 승인을 기다리는 지점 ─────────────────────
  listGates: (threadId: string) =>
    request<{ gates: WorkflowGate[] }>(`/api/gates?threadId=${encodeURIComponent(threadId)}`),
  // threadId 없이 — 전역 대기 게이트(헤더 벨). 스케줄 발 게이트는 threadId 가 없어
  // 이걸로만 보인다.
  listAllGates: () => request<{ gates: WorkflowGate[] }>(`/api/gates`),
  approveGate: (id: string) =>
    request<{ ok: boolean }>(`/api/gates/${id}/approve`, { method: "POST" }),
  rejectGate: (id: string) =>
    request<{ ok: boolean }>(`/api/gates/${id}/reject`, { method: "POST" }),

  /** ask 트리거 수동 발화 — 완료된 run 의 결과를 입력으로 워크플로우 시작. */
  fireRunWorkflow: (id: string, workflow: string) =>
    request<{ run: RunInfo }>(`/api/runs/${id}/workflow`, {
      method: "POST",
      body: JSON.stringify({ workflow }),
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
