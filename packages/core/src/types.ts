export type AgentRole = "engineer" | "researcher" | "reviewer" | "writer" | "other";

export type AdapterKind = "claude-code" | "gemini" | "codex" | "cursor" | string;

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface Project {
  id: string;
  name: string;
  /** Absolute path on disk. Becomes the default `cwd` for runs of agents in this project. */
  path: string;
  description: string | null;
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
  role: AgentRole | null;
  adapterKind: AdapterKind;
  adapterConfig: AdapterConfig;
  /** Optional override of the project's path for this agent. */
  defaultCwd: string | null;
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

export interface Run {
  id: string;
  agentId: string;
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
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}
