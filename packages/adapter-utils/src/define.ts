import type {
  AdapterConfig,
  BuiltCommand,
  CliAdapter,
  RunHandle,
  SpawnArgs,
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
    async spawn(spawnArgs: SpawnArgs, config: AdapterConfig): Promise<RunHandle> {
      const built = def.buildCommand(config as TConfig);
      const cfgEnv = def.resolveEnv?.(config as TConfig) ?? {};
      const { args, stdin } = applyPrompt(built.args, spawnArgs.prompt, promptMode);
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
