import type { AdapterConfig, AdapterKind, McpServer } from "./types.js";

export interface SpawnArgs {
  prompt: string;
  /** 시스템 프롬프트(rules+페르소나) — 시스템 채널을 지원하는 CLI(claude
   *  --append-system-prompt)만 별도로 받는다. 미지원 CLI 는 엔진이 prompt 에 합쳐
   *  보내므로 비어 온다. */
  systemPrompt?: string;
  cwd: string;
  env: Record<string, string>;
  attachedSpecs?: string[];
  signal?: AbortSignal;
  /** Session id from the most recent successful run in this thread/agent.
   *  Adapters that support session resume use it to continue the prior
   *  conversation; adapters that don't ignore it. */
  resumeSessionId?: string;
  /** Caller-assigned session id (a fresh UUID) for CLIs that let the caller
   *  set it (claude-code `--session-id`). The engine mints it for fresh
   *  (non-resume) runs on such CLIs so the on-disk session path is known
   *  before spawn → deterministic cleanup. Mutually exclusive with
   *  resumeSessionId. Adapters without `applySessionId` ignore it. */
  assignSessionId?: string;
  /** Tool names to auto-approve (e.g. loom's delegate — part of the explicit
   *  delegation opt-in). Adapters that support it splice the flag in
   *  (claude `--allowedTools`); others ignore it. */
  allowedTools?: string[];
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
  kind: AdapterKind;
  /** false = 이 CLI 는 run별 MCP 서버 주입이 구조적으로 불가(antigravity).
   *  위임(delegate)은 MCP 도구 대신 loadout 의 셸 브리지로 제공된다. */
  supportsMcpServers: boolean;
  /** 시스템 프롬프트 채널 지원 — true 면 엔진이 system 을 SpawnArgs.systemPrompt 로
   *  따로 넘기고(claude --append-system-prompt), false 면 prompt 에 합쳐 보낸다. */
  supportsSystemPrompt: boolean;
  /** true = 이 CLI 는 caller 가 세션 id 를 지정할 수 있다(claude `--session-id`).
   *  엔진은 fresh run 에 UUID 를 발급해 SpawnArgs.assignSessionId 로 넘기고 세션
   *  경로를 spawn 전에 알아 정리를 결정적으로 한다. false 면 CLI 가 자체 발급한 id 를
   *  스트림/디스크에서 사후 캡처한다. */
  assignsSessionId: boolean;
  buildCommand(config: AdapterConfig): BuiltCommand;
  spawn(args: SpawnArgs, config: AdapterConfig): Promise<RunHandle>;
  /** Pluck a session id out of a stdout chunk. Run-service feeds every
   *  chunk through this to capture the session id the CLI emits, so the
   *  next turn in the same thread can `--resume` it. Adapters without a
   *  session model leave this undefined. */
  extractSessionId?(chunk: string): string | null;
  /** Recover the session id from the CLI's *own on-disk session store*,
   *  for plain-text CLIs (antigravity, devin) that emit no machine-readable
   *  session id in their output — `extractSessionId` is structurally
   *  impossible there. The run engine calls this once, after the process
   *  exits, and only when nothing was captured from the stream. `since` is
   *  an epoch-ms stamp taken just before spawn so the adapter can pick the
   *  conversation this run touched, not a stale one. Reading the store is
   *  fine — CLI root 불가침은 *쓰기* 금지(헌법 3조); the id is replayed next
   *  turn via `applyResume`. */
  captureSessionFromDisk?(
    ctx: { cwd: string; since: number },
    config: AdapterConfig,
  ): Promise<string | null>;
  /** Recover the agent's activity (tokens, cache, tool calls) from the CLI's
   *  own on-disk export, for plain-text CLIs (devin) whose stdout carries no
   *  machine-readable activity. Called after exit. Tokens feed the engine's cost
   *  estimate (devin bills in ACU → approximate USD; the export carries no real
   *  USD cost). `tools` backfills the activity card / task detail so a plain-text
   *  CLI shows what it reached for, like the stream-json CLIs. `since` (epoch-ms,
   *  pre-spawn) lets the adapter ignore a stale export. Disk *read* only (헌법 3조). */
  captureActivityFromDisk?(
    ctx: { cwd: string; since: number },
    config: AdapterConfig,
  ): Promise<{
    inputTokens?: number;
    outputTokens?: number;
    /** input 중 캐시 적중분 — 비용 추정 시 할인 단가 적용(없으면 미적용). */
    cachedInputTokens?: number;
    tools?: { name: string; target?: string }[];
  } | null>;
  /** loom 이 만든 이 세션이 자기 CLI store 에 남긴 파일 경로들(정리용). 사용자가
   *  대화를 삭제할 때 어느 파일을 지울지 어댑터가 안다 — 저장 레이아웃이 CLI마다
   *  달라(파일 1개·여러 곳·하이브리드) 어댑터가 흡수한다. 존재하는 경로만 반환하고,
   *  정리 미지원 CLI 는 undefined. 헌법 3조는 CLI 전역설정 *주입/오염* 금지이지,
   *  사용자가 요청한 자기 세션 정리 금지가 아니다 — 산출만 하고 실제 삭제는 서버가 한다. */
  sessionFiles?(sessionId: string, cwd: string): string[];
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
  /** Detect sub-agent delegation events (Task/Agent tool calls) and
   *  their completions. Returns initiation events when the CLI starts
   *  a sub-task, and completion events when tool_result arrives. */
  extractDelegations?(chunk: string): DelegationEvent[];
}

export interface TouchedEdit {
  path: string;
  /** The string the agent is about to replace — used by the server
   *  to locate the edit's line. Absent for write-from-scratch tools. */
  target?: string;
}

/** Sub-agent delegation event detected from the CLI's tool stream.
 *  "initiate" fires when a Task/Agent tool_use is parsed;
 *  "complete" fires when the corresponding tool_result arrives. */
export type DelegationEvent =
  | {
      phase: "initiate";
      toolCallId: string;
      agentName?: string;
      description: string;
    }
  | {
      phase: "complete";
      toolCallId: string;
      status: "succeeded" | "failed";
      summary?: string;
    };

/** A single tool invocation surfaced from the adapter's stdout stream.
 *  `name` is the raw CLI tool name (e.g. "Read", "Bash", "mcp__github__create_issue").
 *  `target` is a short, user-readable summary the UI can show next to
 *  the tool icon — file path for Read/Edit/Write, command for Bash,
 *  pattern for Grep, URL for WebFetch, etc. Server normalises it. */
export interface ToolUse {
  name: string;
  target?: string;
}
