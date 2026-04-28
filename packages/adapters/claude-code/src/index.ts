import { defineCliAdapter } from "@loom/adapter-utils";
import type { AdapterConfig, BuiltCommand } from "@loom/core";

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

export const claudeCodeAdapter = defineCliAdapter<ClaudeCodeConfig>({
  kind: "claude-code",
  buildCommand: buildClaudeCommand,
  prompt: { via: "stdin" },
  resolveEnv: (cfg) => cfg.env ?? {},
});
