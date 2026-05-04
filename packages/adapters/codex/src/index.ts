import { defineCliAdapter } from "@loom/adapter-utils";
import type { AdapterConfig, BuiltCommand, McpServer } from "@loom/core";

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

/** McpServer → codex `-c` 오버라이드 인자들.
 *
 *  codex의 [mcp_servers.NAME] 섹션이 받는 키 (TOML):
 *    stdio: command, args, env (object), cwd?, env_vars?
 *    http : url, http_headers (object), bearer_token_env_var?
 *    sse  : 미지원. SSE 서버는 HTTP로 fallback (url + http_headers)으로 처리.
 *           일부 서버는 같은 url을 SSE/HTTP 둘 다 노출하므로 이 fallback이 동작할 수도.
 *
 *  Ref: https://developers.openai.com/codex/config-reference */
export function toCodexMcpOverrides(server: McpServer): string[] {
  const prefix = `mcp_servers.${server.name}`;
  const out: string[] = [];
  if (server.kind === "stdio") {
    if (server.command) {
      out.push("-c", `${prefix}.command=${JSON.stringify(server.command)}`);
    }
    if (server.args.length > 0) {
      out.push("-c", `${prefix}.args=${JSON.stringify(server.args)}`);
    }
    for (const [k, v] of Object.entries(server.env)) {
      out.push("-c", `${prefix}.env.${k}=${JSON.stringify(v)}`);
    }
  } else {
    // http + sse 모두 url + http_headers — codex가 SSE 별도 처리 안 함.
    if (server.url) {
      out.push("-c", `${prefix}.url=${JSON.stringify(server.url)}`);
    }
    for (const [k, v] of Object.entries(server.headers)) {
      out.push("-c", `${prefix}.http_headers.${k}=${JSON.stringify(v)}`);
    }
  }
  out.push("-c", `${prefix}.enabled=true`);
  return out;
}

export const codexAdapter = defineCliAdapter<CodexConfig>({
  kind: "codex",
  buildCommand: buildCodexCommand,
  prompt: { via: "stdin" },
  resolveEnv: (cfg) => cfg.env ?? {},
  // codex는 `-c key=value`로 TOML 한 줄씩 덮어쓰기. 서버마다 command/args/env를
  // dot-path로 풀어 인자에 넣음. 트레일링 `-` (stdin marker) 앞에 splice.
  applyMcpServers: ({ args, servers }) => {
    if (servers.length === 0) return { args };
    const overrides = servers.flatMap(toCodexMcpOverrides);
    const last = args[args.length - 1];
    if (last === "-") {
      return { args: [...args.slice(0, -1), ...overrides, "-"] };
    }
    return { args: [...args, ...overrides] };
  },
});
