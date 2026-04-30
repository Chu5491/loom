import { defineCliAdapter } from "@loom/adapter-utils";
import type { AdapterConfig, BuiltCommand } from "@loom/core";

export { opencodeManifest } from "./manifest.js";
export { opencodeProbe } from "./probe.js";
export { opencodeListModels } from "./models.js";

export interface OpencodeConfig extends AdapterConfig {
  command?: string;
  /** "<provider>/<model>" e.g. "anthropic/claude-sonnet-4-5". */
  model?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
  /** Continue the most recent session instead of starting fresh. */
  continueSession?: boolean;
  /** Resume a specific session by id. */
  sessionId?: string;
  /** Tools to allow / deny — passed through verbatim. */
  agent?: string;
}

export function buildOpencodeCommand(config: OpencodeConfig = {}): BuiltCommand {
  const command = config.command ?? "opencode";
  const args: string[] = ["run"];
  if (config.continueSession) args.push("--continue");
  if (config.sessionId) args.push("--session", config.sessionId);
  if (config.model) args.push("--model", config.model);
  if (config.agent) args.push("--agent", config.agent);
  if (config.extraArgs?.length) args.push(...config.extraArgs);
  return { command, args };
}

// `opencode run` takes the prompt as a trailing positional argument.
export const opencodeAdapter = defineCliAdapter<OpencodeConfig>({
  kind: "opencode",
  buildCommand: buildOpencodeCommand,
  prompt: { via: "arg" },
  resolveEnv: (cfg) => cfg.env ?? {},
  // `opencode run --session <id>` resumes that conversation. Splice it
  // in front of the existing args so the runtime session beats any
  // static `config.sessionId` the user may have set.
  applyResume: (args, sessionId) => ["run", "--session", sessionId, ...args.slice(1)],
});
