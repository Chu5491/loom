// 서버와 웹 클라이언트가 공유하는 API 응답 타입.
// 도메인 모델(Project, Agent, Run, …)은 types.ts,
// 여기는 Git · Insights · Settings 등 2차 타입 전용.

// ─── Git ──────────────────────────────────────────────────────────────────

export interface GitWorkingChange {
  path: string;
  fromPath?: string;
  /** porcelain v1 의 1글자 코드 (M/A/D/R/C/U/?/!) */
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
  kind: "local" | "remote";
}

export interface GitStashEntry {
  index: number;
  message: string;
  branch: string | null;
  createdAt: string;
}

export interface GitCommitInfo {
  sha: string;
  shortSha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  subject: string;
  body: string;
  files: GitWorkingChange[];
}

export interface GitCollaborator {
  name: string;
  email: string;
  avatarUrl: string;
  commitCount: number;
  lastCommitAt: string;
}

export interface GhProbe {
  installed: boolean;
  version: string;
}

export interface GitCreatePrResult {
  ok: true;
  url: string;
  output: string;
}

// ─── Insights ─────────────────────────────────────────────────────────────

export interface InsightsSummary {
  totalRuns: number;
  totalCostUsd: number;
  successRate: number;
  activeRuns: number;
  activeAgents: number;
}

export interface InsightsDaily {
  day: string;
  runs: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  costUsd: number;
}

export interface InsightsAgent {
  agentId: string;
  agentName: string;
  adapterKind: string;
  runs: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  costUsd: number;
  avgDurationSecs: number | null;
}

export interface InsightsFile {
  path: string;
  touches: number;
  additions: number;
  deletions: number;
  lastTouchedAt: string;
}

export interface ProjectInsights {
  windowDays: number;
  summary: InsightsSummary;
  daily: InsightsDaily[];
  agents: InsightsAgent[];
  files: InsightsFile[];
}

export interface InsightsProject {
  projectId: string;
  projectName: string;
  runs: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  costUsd: number;
  lastRunAt: string | null;
}

export interface InsightsWorkspaceAgent extends InsightsAgent {
  projectId: string;
  projectName: string;
}

export interface WorkspaceInsights {
  windowDays: number;
  summary: InsightsSummary & { activeProjects: number };
  daily: InsightsDaily[];
  projects: InsightsProject[];
  agents: InsightsWorkspaceAgent[];
}

// ─── Settings ─────────────────────────────────────────────────────────────

export interface LoomSettings {
  globalRule: string;
  updatedAt: string;
}

export interface ApiKeyStatus {
  configured: boolean;
  source: "db" | "env" | "none";
}

export interface ApiKeyStatuses {
  smithery: ApiKeyStatus;
  skillsSh: ApiKeyStatus;
}

// ─── Gemini Sync ──────────────────────────────────────────────────────────

export interface GeminiSyncStatus {
  enabled: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  loomManagedNames: string[];
  userManagedNames: string[];
  conflicts: string[];
  settingsPath: string;
}

export interface GeminiSyncReport {
  ok: boolean;
  error?: string;
  skipped?: "disabled";
  removedFromSettings: string[];
  addedToSettings: string[];
  conflicts: string[];
  backupPath: string | null;
}
