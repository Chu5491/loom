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
  // gemini는 런타임에 새 MCP 서버를 등록할 수 없음 — 사용자가 자기
  // ~/.gemini/settings.json에 등록해둔 서버 중에서 화이트리스트로 제한만 가능.
  // 따라서 loom의 권한 모델은 "gemini가 이미 알고 있는 서버 중 이 에이전트에
  // 허용된 이름들로 추렴"으로 동작. 설정에 없는 이름은 그냥 묻혀버림.
  applyMcpServers: ({ args, servers }) => {
    if (servers.length === 0) return { args };
    return {
      args: [
        ...args,
        "--allowed-mcp-server-names",
        ...servers.map((s) => s.name),
      ],
    };
  },
});
