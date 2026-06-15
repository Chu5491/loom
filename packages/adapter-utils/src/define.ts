import type {
  AdapterConfig,
  AdapterKind,
  BuiltCommand,
  CliAdapter,
  DelegationEvent,
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
  kind: AdapterKind;
  /** false = run별 MCP 주입 불가(antigravity). 기본 true. */
  supportsMcpServers?: boolean;
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
  /** Optional: auto-approve the given tool names (claude `--allowedTools`).
   *  Carried by spawnArgs.allowedTools — part of an explicit per-agent
   *  opt-in (e.g. delegation), never injected silently. */
  applyAllowedTools?(args: string[], tools: string[]): string[];
  /** Optional: scan a stdout chunk and return the session id the CLI
   *  emitted, or null if the chunk doesn't contain one. */
  extractSessionId?(chunk: string): string | null;
  /** Optional: recover the session id from the CLI's on-disk session store
   *  for plain-text CLIs that emit no session id in their output. The engine
   *  calls this after the process exits, only when extractSessionId found
   *  nothing. `since` (epoch ms, pre-spawn) disambiguates this run's session
   *  from stale ones. */
  captureSessionFromDisk?(
    ctx: { cwd: string; since: number },
    config: TConfig,
  ): Promise<string | null>;
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
  /** Optional: detect sub-agent delegation events (Task/Agent tool calls). */
  extractDelegations?(chunk: string): DelegationEvent[];
  /** Optional: splice CLI flags / write files / set env vars needed to
   *  expose the agent's loadout (skills + MCP servers) to this run. Called
   *  on every spawn when there's anything to expose (servers OR a loadout
   *  dir). Adapter decides what's relevant.
   *    - claude-code → `--add-dir <loadoutDir>` so Read permits the loadout
   *                     files; `--mcp-config <mcpConfigPath> --strict-mcp-config`
   *                     when servers are assigned.
   *    - gemini      → `--allowed-mcp-server-names <name...>` (filters
   *                     the user's existing settings.json).
   *    - codex       → `-c mcp_servers.<name>.command="..."` per server.
   *    - opencode    → write `<loadoutDir>/xdg/opencode/opencode.json`,
   *                     return env { XDG_CONFIG_HOME, OPENCODE_DISABLE_PROJECT_CONFIG }.
   *    - devin       → write `<cwd>/.devin/config.local.json` (devin의
   *                     프로젝트-로컬 설정 — CLI root 아님).
   *  Returns possibly-modified args + optional env additions. The env
   *  layers on top of (and wins over) project + adapter resolveEnv. */
  applyMcpServers?(input: {
    args: string[];
    servers: McpServer[];
    mcpConfigPath: string | null;
    loadoutDir: string | null;
    /** run 작업 디렉토리 — 프로젝트-로컬 설정 파일을 쓰는 어댑터(devin)용. */
    cwd: string;
  }): {
    args: string[];
    env?: Record<string, string>;
  };
}

export function defineCliAdapter<TConfig extends AdapterConfig = AdapterConfig>(
  def: AdapterDefinition<TConfig>,
): CliAdapter {
  const promptMode: PromptMode = def.prompt ?? { via: "stdin" };

  return {
    kind: def.kind,
    supportsMcpServers: def.supportsMcpServers ?? true,
    buildCommand(config: AdapterConfig): BuiltCommand {
      return def.buildCommand(config as TConfig);
    },
    extractSessionId: def.extractSessionId,
    captureSessionFromDisk: def.captureSessionFromDisk
      ? (ctx, config) => def.captureSessionFromDisk!(ctx, config as TConfig)
      : undefined,
    extractTouchedPaths: def.extractTouchedPaths,
    extractTouchedEdits: def.extractTouchedEdits,
    extractToolUses: def.extractToolUses,
    extractDelegations: def.extractDelegations,
    async spawn(spawnArgs: SpawnArgs, config: AdapterConfig): Promise<RunHandle> {
      const built = def.buildCommand(config as TConfig);
      const cfgEnv = def.resolveEnv?.(config as TConfig) ?? {};
      // Resume support is opt-in per adapter — if the caller passed a
      // session id and the adapter knows how to resume, splice the
      // resume flag into the args before the prompt is applied.
      let baseArgs =
        spawnArgs.resumeSessionId && def.applyResume
          ? def.applyResume(built.args, spawnArgs.resumeSessionId)
          : built.args;
      if (spawnArgs.allowedTools?.length && def.applyAllowedTools) {
        baseArgs = def.applyAllowedTools(baseArgs, spawnArgs.allowedTools);
      }
      // 로드아웃/MCP 적용은 prompt 적용 *전에* — 프롬프트가 argv 마지막에 박히는
      // 어댑터(opencode trailing positional, gemini --prompt)에선 그 뒤에 더
      // 못 넣음. servers가 비어도 loadoutDir만으로 호출 — claude-code의 --add-dir
      // 같은 권한 부여가 servers와 무관하게 필요할 수 있어서.
      const hasLoadout = !!spawnArgs.loadoutDir;
      const hasServers = (spawnArgs.mcpServers?.length ?? 0) > 0;
      const mcpApplied =
        def.applyMcpServers && (hasLoadout || hasServers)
          ? def.applyMcpServers({
              args: baseArgs,
              servers: spawnArgs.mcpServers ?? [],
              mcpConfigPath: spawnArgs.mcpConfigPath ?? null,
              loadoutDir: spawnArgs.loadoutDir ?? null,
              cwd: spawnArgs.cwd,
            })
          : { args: baseArgs };
      const { args, stdin } = applyPrompt(mcpApplied.args, spawnArgs.prompt, promptMode);
      return spawnProcess({
        command: built.command,
        args,
        cwd: spawnArgs.cwd,
        // Priority (last-spread-wins):
        //   spawnArgs.env (project-level) < cfgEnv (adapter resolveEnv →
        //   agent's adapterConfig.env) < mcpApplied.env (run-time overrides
        //   for XDG_CONFIG_HOME / OPENCODE_DISABLE_PROJECT_CONFIG / etc.).
        // mcpApplied.env wins because it's the most specific to this run.
        env: { ...spawnArgs.env, ...cfgEnv, ...(mcpApplied.env ?? {}) },
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
