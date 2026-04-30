import { defineCliAdapter } from "@loom/adapter-utils";
import type { AdapterConfig, BuiltCommand, TouchedEdit } from "@loom/core";

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
});
