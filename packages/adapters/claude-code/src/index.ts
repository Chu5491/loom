import { defineCliAdapter } from "@loom/adapter-utils";
import type { AdapterConfig, BuiltCommand, DelegationEvent, ToolUse, TouchedEdit } from "@loom/core";

export { claudeCodeManifest } from "./manifest.js";
export { claudeCodeProbe } from "./probe.js";
export { claudeCodeListModels, parseAnthropicModels } from "./models.js";

export interface ClaudeCodeConfig extends AdapterConfig {
  command?: string;
  model?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
  outputFormat?: "text" | "json" | "stream-json";
  verbose?: boolean;
  addDirs?: string[];
  dangerouslySkipPermissions?: boolean;
  /** Headless permission mode — acceptEdits 는 파일 편집만 자동 승인. */
  permissionMode?: "acceptEdits" | "plan" | "default";
  /** Reasoning effort: low / medium / high / xhigh / max. Maps to --effort. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

export function buildClaudeCommand(config: ClaudeCodeConfig = {}): BuiltCommand {
  const command = config.command ?? "claude";
  const outputFormat = config.outputFormat ?? "stream-json";
  // stream-json swallows progress without --verbose, so default it on for that format.
  const verbose = config.verbose ?? outputFormat === "stream-json";

  const args: string[] = ["--print", "-", "--output-format", outputFormat];
  if (verbose) args.push("--verbose");
  if (config.model) args.push("--model", config.model);
  if (config.effort) args.push("--effort", config.effort);
  for (const dir of config.addDirs ?? []) args.push("--add-dir", dir);
  if (config.dangerouslySkipPermissions) args.push("--dangerously-skip-permissions");
  if (config.permissionMode && config.permissionMode !== "default") {
    args.push("--permission-mode", config.permissionMode);
  }
  if (config.extraArgs?.length) args.push(...config.extraArgs);

  return { command, args };
}

/** Tools whose `input.file_path` we treat as "this run is touching
 *  this file right now." NotebookEdit uses `notebook_path`. Tools like
 *  Read / Bash / Glob aren't surfaced — those are inspections, not
 *  modifications, and including them would noise up the live indicator. */
const FILE_TOUCH_TOOLS: Record<string, "file_path" | "notebook_path"> = {
  Write: "file_path",
  Edit: "file_path",
  MultiEdit: "file_path",
  NotebookEdit: "notebook_path",
};

/** Walk a chunk for tool_use events and yield {path, target?} per
 *  modification tool call. `target` is `old_string` for Edit /
 *  MultiEdit (so the server can grep for it and pin a line number);
 *  Write has no target — it overwrites the whole file. */
export function extractClaudeTouchedEdits(chunk: string): TouchedEdit[] {
  const out: TouchedEdit[] = [];
  for (const raw of chunk.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] !== "{") continue;
    try {
      const j = JSON.parse(line) as {
        type?: string;
        message?: {
          content?: Array<{
            type?: string;
            name?: string;
            input?: Record<string, unknown>;
          }>;
        };
      };
      if (j.type !== "assistant" || !j.message?.content) continue;
      for (const c of j.message.content) {
        if (c.type !== "tool_use" || !c.name) continue;
        const key = FILE_TOUCH_TOOLS[c.name];
        if (!key) continue;
        const path = c.input?.[key];
        if (typeof path !== "string" || !path) continue;

        if (c.name === "MultiEdit") {
          // MultiEdit packs an array of {old_string,new_string}; emit
          // one location per edit so the server can pin each one.
          const edits = c.input?.["edits"];
          if (Array.isArray(edits)) {
            for (const e of edits) {
              const target = (e as Record<string, unknown>)?.["old_string"];
              out.push({
                path,
                target: typeof target === "string" ? target : undefined,
              });
            }
          } else {
            out.push({ path });
          }
          continue;
        }

        const target = c.input?.["old_string"];
        out.push({
          path,
          target: typeof target === "string" ? target : undefined,
        });
      }
    } catch {
      // partial / malformed line — skip
    }
  }
  return out;
}

/** Back-compat thin wrapper. Older callers that only want the path set
 *  go through here so `extractTouchedPaths` keeps working. */
export function extractClaudeTouchedPaths(chunk: string): string[] {
  return extractClaudeTouchedEdits(chunk).map((e) => e.path);
}

/** Pull *every* tool_use event (not just file edits) so the Office view
 *  can show what each agent is reaching for. Selects a short, readable
 *  summary per tool — file path for file ops, the command for Bash,
 *  the pattern for Grep, the URL for WebFetch, etc. */
export function extractClaudeToolUses(chunk: string): ToolUse[] {
  const out: ToolUse[] = [];
  for (const raw of chunk.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] !== "{") continue;
    try {
      const j = JSON.parse(line) as {
        type?: string;
        message?: {
          content?: Array<{
            type?: string;
            name?: string;
            input?: Record<string, unknown>;
          }>;
        };
      };
      if (j.type !== "assistant" || !j.message?.content) continue;
      for (const c of j.message.content) {
        if (c.type !== "tool_use" || !c.name) continue;
        out.push({ name: c.name, target: summariseToolInput(c.name, c.input) });
      }
    } catch {
      // partial / malformed line — skip
    }
  }
  return out;
}

function summariseToolInput(
  name: string,
  input: Record<string, unknown> | undefined,
): string | undefined {
  if (!input) return undefined;
  // Common file-targeting tools — surface the path.
  const filePath = input["file_path"] ?? input["path"] ?? input["notebook_path"];
  if (typeof filePath === "string" && filePath) return filePath;
  if (name === "Bash") {
    const cmd = input["command"];
    if (typeof cmd === "string") return cmd.slice(0, 80);
  }
  if (name === "Grep" || name === "Glob") {
    const pat = input["pattern"];
    if (typeof pat === "string") return pat;
  }
  if (name === "WebFetch" || name === "WebSearch") {
    const url = input["url"] ?? input["query"];
    if (typeof url === "string") return url.slice(0, 80);
  }
  if (name.startsWith("mcp__")) {
    // For MCP tools, show the first string-ish arg if any. Helps users see
    // which repo / server / parameter the agent reached for.
    for (const v of Object.values(input)) {
      if (typeof v === "string" && v.length > 0) return v.slice(0, 80);
    }
  }
  return undefined;
}

/** Pluck the `session_id` field out of a stream-json line. We scan
 *  per-line because chunks can split mid-event; the run-service buffers
 *  partial chunks so a complete JSON line eventually lands here. */
export function extractClaudeSessionId(chunk: string): string | null {
  for (const raw of chunk.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] !== "{") continue;
    try {
      const j = JSON.parse(line) as { session_id?: unknown };
      if (typeof j.session_id === "string" && j.session_id.length > 0) {
        return j.session_id;
      }
    } catch {
      // partial / malformed line — keep scanning
    }
  }
  return null;
}

const DELEGATION_TOOLS = new Set(["Task", "Agent"]);

export function extractClaudeDelegations(chunk: string): DelegationEvent[] {
  const out: DelegationEvent[] = [];
  for (const raw of chunk.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] !== "{") continue;
    try {
      const j = JSON.parse(line) as {
        type?: string;
        message?: {
          content?: Array<{
            type?: string;
            id?: string;
            name?: string;
            input?: Record<string, unknown>;
            tool_use_id?: string;
            content?: unknown;
            is_error?: boolean;
          }>;
        };
      };
      if (!j.message?.content) continue;
      for (const c of j.message.content) {
        if (c.type === "tool_use" && c.name && DELEGATION_TOOLS.has(c.name) && c.id) {
          const desc =
            (typeof c.input?.["description"] === "string" ? c.input["description"] : null) ??
            (typeof c.input?.["prompt"] === "string" ? c.input["prompt"] : null) ??
            "sub-agent task";
          const agent =
            typeof c.input?.["agent_name"] === "string" ? c.input["agent_name"] :
            typeof c.input?.["subagent_type"] === "string" ? c.input["subagent_type"] :
            undefined;
          out.push({
            phase: "initiate",
            toolCallId: c.id,
            agentName: agent,
            description: desc.length > 200 ? desc.slice(0, 200) + "…" : desc,
          });
        }
        if (c.type === "tool_result" && c.tool_use_id) {
          const isError = c.is_error === true;
          const summary = typeof c.content === "string"
            ? c.content.slice(0, 500)
            : undefined;
          out.push({
            phase: "complete",
            toolCallId: c.tool_use_id,
            status: isError ? "failed" : "succeeded",
            summary,
          });
        }
      }
    } catch {
      // partial / malformed line
    }
  }
  return out;
}

export const claudeCodeAdapter = defineCliAdapter<ClaudeCodeConfig>({
  kind: "claude-code",
  buildCommand: buildClaudeCommand,
  prompt: { via: "stdin" },
  resolveEnv: (cfg) => cfg.env ?? {},
  applyResume: (args, sessionId) => ["--resume", sessionId, ...args],
  // headless 도구별 자동 승인 — loom delegate 등 명시적 opt-in 도구만 온다.
  // variadic 플래그가 뒤따르는 인자/stdin 을 삼키지 않게 `--flag=a,b` 단일 인자로.
  applyAllowedTools: (args, tools) => [...args, `--allowedTools=${tools.join(",")}`],
  extractSessionId: extractClaudeSessionId,
  extractTouchedPaths: extractClaudeTouchedPaths,
  extractTouchedEdits: extractClaudeTouchedEdits,
  extractToolUses: extractClaudeToolUses,
  extractDelegations: extractClaudeDelegations,
  // 로드아웃/MCP 적용:
  //   1) `--add-dir <loadoutDir>` — loadout 디렉터리는 cwd 밖이라 claude-code의
  //      Read 도구가 기본적으로 거부함. 권한을 명시적으로 줘야 에이전트가 자기
  //      skills/<name>.md를 실제로 읽을 수 있음.
  //   2) `--mcp-config <path> --strict-mcp-config` — loom이 미리 그려둔
  //      .mcp.json만 보이게. 사용자의 다른 MCP 설정은 strict 모드로 차단.
  applyMcpServers: ({ args, mcpConfigPath, loadoutDir }) => {
    let next = args;
    if (loadoutDir) next = [...next, "--add-dir", loadoutDir];
    if (mcpConfigPath) {
      next = [...next, "--mcp-config", mcpConfigPath, "--strict-mcp-config"];
    }
    return { args: next };
  },
});
