import type {
  AdapterConfig,
  BuiltCommand,
  CliAdapter,
  RunHandle,
  SpawnArgs,
  TouchedEdit,
} from "@loom/core";
import { spawnProcess } from "./spawn.js";

export type PromptMode =
  | { via: "stdin" }
  | { via: "arg" }
  | { via: "arg"; flag: string };

export interface AdapterDefinition<TConfig extends AdapterConfig = AdapterConfig> {
  kind: string;
  buildCommand(config: TConfig): BuiltCommand;
  /** Where the user prompt is injected. Default: stdin. */
  prompt?: PromptMode;
  /** Per-adapter env overrides. Merged before the spawn-time env. */
  resolveEnv?(config: TConfig): Record<string, string>;
  /** Optional: insert resume args (e.g. `--resume <id>`) when the
   *  caller has a session id from a prior run. Adapters that don't
   *  support session resume leave this undefined and the session id
   *  is silently ignored. */
  applyResume?(args: string[], sessionId: string): string[];
  /** Optional: scan a stdout chunk and return the session id the CLI
   *  emitted, or null if the chunk doesn't contain one. */
  extractSessionId?(chunk: string): string | null;
  /** Optional: scan a stdout chunk for tool-use events and return the
   *  file paths the agent is currently editing. */
  extractTouchedPaths?(chunk: string): string[];
  /** Optional: same as extractTouchedPaths but with the replace target
   *  for line-level localisation. */
  extractTouchedEdits?(chunk: string): TouchedEdit[];
}

export function defineCliAdapter<TConfig extends AdapterConfig = AdapterConfig>(
  def: AdapterDefinition<TConfig>,
): CliAdapter {
  const promptMode: PromptMode = def.prompt ?? { via: "stdin" };

  return {
    kind: def.kind,
    buildCommand(config: AdapterConfig): BuiltCommand {
      return def.buildCommand(config as TConfig);
    },
    extractSessionId: def.extractSessionId,
    extractTouchedPaths: def.extractTouchedPaths,
    extractTouchedEdits: def.extractTouchedEdits,
    async spawn(spawnArgs: SpawnArgs, config: AdapterConfig): Promise<RunHandle> {
      const built = def.buildCommand(config as TConfig);
      const cfgEnv = def.resolveEnv?.(config as TConfig) ?? {};
      // Resume support is opt-in per adapter — if the caller passed a
      // session id and the adapter knows how to resume, splice the
      // resume flag into the args before the prompt is applied.
      const baseArgs =
        spawnArgs.resumeSessionId && def.applyResume
          ? def.applyResume(built.args, spawnArgs.resumeSessionId)
          : built.args;
      const { args, stdin } = applyPrompt(baseArgs, spawnArgs.prompt, promptMode);
      return spawnProcess({
        command: built.command,
        args,
        cwd: spawnArgs.cwd,
        env: { ...cfgEnv, ...spawnArgs.env },
        stdin,
        signal: spawnArgs.signal,
        onStdout: spawnArgs.onStdout,
        onStderr: spawnArgs.onStderr,
      });
    },
  };
}

/** Exposed for tests and adapters that need to inspect the final invocation. */
export function applyPrompt(
  baseArgs: string[],
  prompt: string,
  mode: PromptMode,
): { args: string[]; stdin: string } {
  if (mode.via === "stdin") {
    return { args: baseArgs, stdin: prompt };
  }
  if ("flag" in mode) {
    return { args: [...baseArgs, mode.flag, prompt], stdin: "" };
  }
  return { args: [...baseArgs, prompt], stdin: "" };
}
