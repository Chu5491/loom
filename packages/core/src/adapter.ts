import type { AdapterConfig, McpServer } from "./types.js";

export interface SpawnArgs {
  prompt: string;
  cwd: string;
  env: Record<string, string>;
  attachedSpecs?: string[];
  signal?: AbortSignal;
  /** Session id from the most recent successful run in this thread/agent.
   *  Adapters that support session resume use it to continue the prior
   *  conversation; adapters that don't ignore it. */
  resumeSessionId?: string;
  /** Filesystem path to a JSON file in claude-code `.mcp.json` format.
   *  Adapters whose CLI supports `--mcp-config` (claude-code) splice this
   *  in. Others may write their own format from `mcpServers` instead. */
  mcpConfigPath?: string;
  /** Resolved MCP server configs assigned to the agent. Adapters whose
   *  CLI doesn't accept a config-file flag use this to emit per-key
   *  overrides (codex `-c`) or to filter (gemini `--allowed-mcp-server-names`). */
  mcpServers?: McpServer[];
  /** Path to the agent's per-run loadout directory — contains skills/<>.md
   *  and (optionally) mcp.json. Adapters use this to grant the CLI access
   *  to those files (claude-code `--add-dir`) or to render their own
   *  CLI-format config inside it (opencode `<dir>/opencode/opencode.json`
   *  + XDG_CONFIG_HOME override). */
  loadoutDir?: string;
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
  /** Pluck a session id out of a stdout chunk. Run-service feeds every
   *  chunk through this to capture the session id the CLI emits, so the
   *  next turn in the same thread can `--resume` it. Adapters without a
   *  session model leave this undefined. */
  extractSessionId?(chunk: string): string | null;
  /** Pluck file paths out of tool-use events as the CLI streams them.
   *  Run-service surfaces these to the UI so the file tree can flag
   *  "an agent is editing this *right now*" — without it, files only
   *  light up after the run finishes and writes to run_changes. */
  extractTouchedPaths?(chunk: string): string[];
  /** Same as `extractTouchedPaths` but richer: includes the `old_string`
   *  the agent is replacing, so the run-service can grep the file and
   *  pin the edit down to a line number. Adapters that can't surface
   *  a target leave this undefined and the UI falls back to file-level
   *  presence only. */
  extractTouchedEdits?(chunk: string): TouchedEdit[];
  /** Pluck *every* tool_use event (not just file edits) so the Office
   *  view can show what each agent is reaching for in real time —
   *  Read / Bash / Grep / WebFetch / mcp__server__method, etc.
   *  Returns one entry per tool call in chunk order; adapters that
   *  can't surface tool names leave this undefined. */
  extractToolUses?(chunk: string): ToolUse[];
}

export interface TouchedEdit {
  path: string;
  /** The string the agent is about to replace — used by the server
   *  to locate the edit's line. Absent for write-from-scratch tools. */
  target?: string;
}

/** A single tool invocation surfaced from the adapter's stdout stream.
 *  `name` is the raw CLI tool name (e.g. "Read", "Bash", "mcp__github__create_issue").
 *  `target` is a short, user-readable summary the UI can show next to
 *  the tool icon — file path for Read/Edit/Write, command for Bash,
 *  pattern for Grep, URL for WebFetch, etc. Server normalises it. */
export interface ToolUse {
  name: string;
  target?: string;
}
