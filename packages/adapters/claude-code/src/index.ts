import { defineCliAdapter } from "@loom/adapter-utils";
import type { AdapterConfig, BuiltCommand, ToolUse, TouchedEdit } from "@loom/core";

export { claudeCodeManifest } from "./manifest.js";
export { claudeCodeProbe } from "./probe.js";
export { claudeCodeListModels } from "./models.js";

export interface ClaudeCodeConfig extends AdapterConfig {
  command?: string;
  model?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
  outputFormat?: "text" | "json" | "stream-json";
  verbose?: boolean;
  addDirs?: string[];
  dangerouslySkipPermissions?: boolean;
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
  for (const raw of chunk.split("\n")) {
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
  for (const raw of chunk.split("\n")) {
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
  for (const raw of chunk.split("\n")) {
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

export const claudeCodeAdapter = defineCliAdapter<ClaudeCodeConfig>({
  kind: "claude-code",
  buildCommand: buildClaudeCommand,
  prompt: { via: "stdin" },
  resolveEnv: (cfg) => cfg.env ?? {},
  applyResume: (args, sessionId) => ["--resume", sessionId, ...args],
  extractSessionId: extractClaudeSessionId,
  extractTouchedPaths: extractClaudeTouchedPaths,
  extractTouchedEdits: extractClaudeTouchedEdits,
  extractToolUses: extractClaudeToolUses,
  // MCP 주입 — loom이 미리 그려둔 .mcp.json 경로를 그대로 --mcp-config에. strict
  // 모드를 같이 켜서 사용자의 ~/.claude/settings.json 등 다른 출처는 무시
  // (loom이 권한 부여한 서버만 보임).
  applyMcpServers: ({ args, mcpConfigPath }) => {
    if (!mcpConfigPath) return args;
    return [...args, "--mcp-config", mcpConfigPath, "--strict-mcp-config"];
  },
});
