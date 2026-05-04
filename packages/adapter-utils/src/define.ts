import type {
  AdapterConfig,
  BuiltCommand,
  CliAdapter,
  McpServer,
  RunHandle,
  SpawnArgs,
  ToolUse,
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
  /** Optional: scan a stdout chunk for *every* tool_use event (not just
   *  file edits) so the Office view can show what each agent is reaching
   *  for in real time — Read / Bash / Grep / mcp__server__method, etc. */
  extractToolUses?(chunk: string): ToolUse[];
  /** Optional: splice CLI flags / write files needed to expose the given
   *  MCP servers to this run.
   *    - claude-code → `--mcp-config <mcpConfigPath> --strict-mcp-config`
   *    - gemini      → `--allowed-mcp-server-names <name...>` (filters
   *                     the user's existing settings.json)
   *    - codex       → `-c mcp_servers.<name>.command="..."` per server
   *    - opencode    → no runtime override; this hook stays undefined.
   *  Receives both the raw McpServer[] and the path to the pre-rendered
   *  claude-code-format JSON if it was written. */
  applyMcpServers?(args: {
    args: string[];
    servers: McpServer[];
    mcpConfigPath: string | null;
  }): string[];
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
    extractToolUses: def.extractToolUses,
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
      // MCP 주입은 prompt 적용 *전에* 한다. 프롬프트가 argv 마지막에 박히는
      // 어댑터(opencode, gemini-via-arg)에선 그 뒤에 더 못 넣음.
      const argsWithMcp =
        def.applyMcpServers && (spawnArgs.mcpServers?.length ?? 0) > 0
          ? def.applyMcpServers({
              args: baseArgs,
              servers: spawnArgs.mcpServers!,
              mcpConfigPath: spawnArgs.mcpConfigPath ?? null,
            })
          : baseArgs;
      const { args, stdin } = applyPrompt(argsWithMcp, spawnArgs.prompt, promptMode);
      return spawnProcess({
        command: built.command,
        args,
        cwd: spawnArgs.cwd,
        // Priority (last-spread-wins): caller spawnArgs.env (project-level)
        // < cfgEnv (adapter resolveEnv → agent's adapterConfig.env). Agent
        // settings override project defaults; adapter knows its own needs.
        env: { ...spawnArgs.env, ...cfgEnv },
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
