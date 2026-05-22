import { defineCliAdapter } from "@loom/adapter-utils";
import type { AdapterConfig, BuiltCommand, McpServer, ToolUse, TouchedEdit } from "@loom/core";

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

// ── --json NDJSON extraction ───────────────────────────────────────────
// `codex exec --json` emits NDJSON with event types:
//   thread.started  → { type: "thread.started", thread_id }
//   item.started    → { type: "item.started", item: { id, type, ... } }
//   item.completed  → { type: "item.completed", item: { id, type, ... } }
//   item.updated    → { type: "item.updated", item: { id, type, ... } }
//   turn.completed  → { type: "turn.completed", usage: { ... } }
//
// Item types: file_change, command_execution, agent_message, mcp_tool_call,
//   web_search, reasoning, plan_update.
//
// file_change items carry `changes: [{ path, kind }]`.
// command_execution items carry `command` (string).

interface CodexEvent {
  type?: string;
  thread_id?: string;
  item?: {
    id?: string;
    type?: string;
    command?: string;
    changes?: Array<{ path?: string; kind?: string }>;
    text?: string;
  };
}

function* parseCodexLines(chunk: string): Generator<CodexEvent> {
  for (const raw of chunk.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] !== "{") continue;
    try {
      yield JSON.parse(line) as CodexEvent;
    } catch {
      // partial / malformed line
    }
  }
}

export function extractCodexSessionId(chunk: string): string | null {
  for (const ev of parseCodexLines(chunk)) {
    if (ev.type === "thread.started" && typeof ev.thread_id === "string" && ev.thread_id) {
      return ev.thread_id;
    }
  }
  return null;
}

export function extractCodexTouchedEdits(chunk: string): TouchedEdit[] {
  const out: TouchedEdit[] = [];
  for (const ev of parseCodexLines(chunk)) {
    if (!ev.item || ev.item.type !== "file_change") continue;
    if (!Array.isArray(ev.item.changes)) continue;
    for (const change of ev.item.changes) {
      if (typeof change.path === "string" && change.path) {
        out.push({ path: change.path });
      }
    }
  }
  return out;
}

export function extractCodexTouchedPaths(chunk: string): string[] {
  return extractCodexTouchedEdits(chunk).map((e) => e.path);
}

export function extractCodexToolUses(chunk: string): ToolUse[] {
  const out: ToolUse[] = [];
  for (const ev of parseCodexLines(chunk)) {
    if (!ev.item?.type) continue;
    // item.started / item.completed / item.updated 모두 처리
    const t = ev.item.type;
    if (t === "command_execution") {
      const cmd = ev.item.command;
      out.push({ name: "bash", target: typeof cmd === "string" ? cmd.slice(0, 80) : undefined });
    } else if (t === "file_change") {
      const changes = ev.item.changes;
      if (Array.isArray(changes)) {
        for (const c of changes) {
          if (typeof c.path === "string") {
            out.push({ name: "apply_patch", target: c.path });
          }
        }
      }
    } else if (t === "mcp_tool_call") {
      out.push({ name: "mcp_tool_call", target: undefined });
    } else if (t === "web_search") {
      out.push({ name: "web_search", target: undefined });
    }
  }
  return out;
}

export const codexAdapter = defineCliAdapter<CodexConfig>({
  kind: "codex",
  buildCommand: buildCodexCommand,
  prompt: { via: "stdin" },
  resolveEnv: (cfg) => cfg.env ?? {},
  extractSessionId: extractCodexSessionId,
  extractTouchedPaths: extractCodexTouchedPaths,
  extractTouchedEdits: extractCodexTouchedEdits,
  extractToolUses: extractCodexToolUses,
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
