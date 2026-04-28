import { defineCliAdapter } from "@loom/adapter-utils";
import type { AdapterConfig, BuiltCommand } from "@loom/core";

export { codexManifest } from "./manifest.js";
export { codexProbe } from "./probe.js";
export { codexListModels } from "./models.js";

export interface CodexConfig extends AdapterConfig {
  command?: string;
  model?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
  /** Reasoning effort for o-series models (e.g. 'low', 'medium', 'high'). */
  reasoningEffort?: string;
  search?: boolean;
  dangerouslyBypassApprovalsAndSandbox?: boolean;
  /** Override the working dir codex sees (--cd). Distinct from spawn cwd. */
  cd?: string;
}

export function buildCodexCommand(config: CodexConfig = {}): BuiltCommand {
  const command = config.command ?? "codex";
  // Trailing `-` tells `codex exec` to read the prompt from stdin.
  const args: string[] = ["exec", "--json"];
  if (config.search) args.push("--search");
  if (config.dangerouslyBypassApprovalsAndSandbox) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  }
  if (config.model) args.push("--model", config.model);
  if (config.reasoningEffort) {
    args.push("-c", `model_reasoning_effort=${JSON.stringify(config.reasoningEffort)}`);
  }
  if (config.cd) args.push("--cd", config.cd);
  if (config.extraArgs?.length) args.push(...config.extraArgs);
  args.push("-");
  return { command, args };
}

export const codexAdapter = defineCliAdapter<CodexConfig>({
  kind: "codex",
  buildCommand: buildCodexCommand,
  prompt: { via: "stdin" },
  resolveEnv: (cfg) => cfg.env ?? {},
});
