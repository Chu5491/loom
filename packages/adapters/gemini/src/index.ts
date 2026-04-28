import { defineCliAdapter } from "@loom/adapter-utils";
import type { AdapterConfig, BuiltCommand } from "@loom/core";

export { geminiManifest } from "./manifest.js";
export { geminiProbe } from "./probe.js";
export { geminiListModels } from "./models.js";

export interface GeminiConfig extends AdapterConfig {
  command?: string;
  model?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
  outputFormat?: "text" | "stream-json";
  /** Auto-approve all tool calls. Same as the CLI's --yolo / --approval-mode yolo. */
  yolo?: boolean;
  sandbox?: boolean;
}

export function buildGeminiCommand(config: GeminiConfig = {}): BuiltCommand {
  const command = config.command ?? "gemini";
  const args: string[] = [];
  const outputFormat = config.outputFormat ?? "stream-json";
  args.push("--output-format", outputFormat);
  if (config.model) args.push("--model", config.model);
  if (config.yolo) args.push("--approval-mode", "yolo");
  if (config.sandbox === true) args.push("--sandbox");
  else if (config.sandbox === false) args.push("--sandbox=none");
  if (config.extraArgs?.length) args.push(...config.extraArgs);
  return { command, args };
}

// gemini reads non-interactive prompts via --prompt <text> rather than stdin.
export const geminiAdapter = defineCliAdapter<GeminiConfig>({
  kind: "gemini",
  buildCommand: buildGeminiCommand,
  prompt: { via: "arg", flag: "--prompt" },
  resolveEnv: (cfg) => cfg.env ?? {},
});
