import type { AdapterConfig } from "./types.js";

export interface SpawnArgs {
  prompt: string;
  cwd: string;
  env: Record<string, string>;
  attachedSpecs?: string[];
  signal?: AbortSignal;
  onStdout: (chunk: string) => void;
  onStderr: (chunk: string) => void;
}

export interface RunHandle {
  pid: number;
  promise: Promise<{ exitCode: number; signal: NodeJS.Signals | null }>;
  kill: () => void;
}

export interface BuiltCommand {
  command: string;
  args: string[];
}

export interface CliAdapter {
  kind: string;
  buildCommand(config: AdapterConfig): BuiltCommand;
  spawn(args: SpawnArgs, config: AdapterConfig): Promise<RunHandle>;
}
