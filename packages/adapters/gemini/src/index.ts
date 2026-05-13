import { defineCliAdapter } from "@loom/adapter-utils";
import type { AdapterConfig, BuiltCommand, ToolUse, TouchedEdit } from "@loom/core";

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

// ── stream-json extraction ─────────────────────────────────────────────
// gemini's `--output-format stream-json` emits NDJSON with event types:
//   init        → { type: "init", session_id, model }
//   tool_use    → { type: "tool_use", tool_name, tool_id, parameters }
//   tool_result → { type: "tool_result", tool_id, status, output }
//   message     → { type: "message", role, content }
//   result      → { type: "result", status, stats }
//
// Tool names: replace (edit), write_file, read_file, run_shell_command,
//   grep_search, glob, google_web_search, web_fetch, invoke_agent, list_directory.
// File-path parameter is always `file_path`.

interface GeminiStreamEvent {
  type?: string;
  session_id?: string;
  tool_name?: string;
  parameters?: Record<string, unknown>;
}

function* parseLines(chunk: string): Generator<GeminiStreamEvent> {
  for (const raw of chunk.split("\n")) {
    const line = raw.trim();
    if (!line || line[0] !== "{") continue;
    try {
      yield JSON.parse(line) as GeminiStreamEvent;
    } catch {
      // partial / malformed line
    }
  }
}

export function extractGeminiSessionId(chunk: string): string | null {
  for (const ev of parseLines(chunk)) {
    if (ev.type === "init" && typeof ev.session_id === "string" && ev.session_id) {
      return ev.session_id;
    }
  }
  return null;
}

const FILE_EDIT_TOOLS: Record<string, true> = { replace: true, write_file: true };

export function extractGeminiTouchedEdits(chunk: string): TouchedEdit[] {
  const out: TouchedEdit[] = [];
  for (const ev of parseLines(chunk)) {
    if (ev.type !== "tool_use" || !ev.tool_name) continue;
    if (!FILE_EDIT_TOOLS[ev.tool_name]) continue;
    const path = ev.parameters?.["file_path"];
    if (typeof path !== "string" || !path) continue;
    const target = ev.parameters?.["old_string"];
    out.push({ path, target: typeof target === "string" ? target : undefined });
  }
  return out;
}

export function extractGeminiTouchedPaths(chunk: string): string[] {
  return extractGeminiTouchedEdits(chunk).map((e) => e.path);
}

export function extractGeminiToolUses(chunk: string): ToolUse[] {
  const out: ToolUse[] = [];
  for (const ev of parseLines(chunk)) {
    if (ev.type !== "tool_use" || !ev.tool_name) continue;
    out.push({ name: ev.tool_name, target: summariseGeminiInput(ev.tool_name, ev.parameters) });
  }
  return out;
}

function summariseGeminiInput(
  name: string,
  params: Record<string, unknown> | undefined,
): string | undefined {
  if (!params) return undefined;
  const filePath = params["file_path"];
  if (typeof filePath === "string" && filePath) return filePath;
  if (name === "run_shell_command") {
    const cmd = params["command"];
    if (typeof cmd === "string") return cmd.slice(0, 80);
  }
  if (name === "grep_search" || name === "glob") {
    const pat = params["pattern"];
    if (typeof pat === "string") return pat;
  }
  if (name === "google_web_search") {
    const q = params["query"];
    if (typeof q === "string") return q.slice(0, 80);
  }
  if (name === "web_fetch") {
    const url = params["url"];
    if (typeof url === "string") return url.slice(0, 80);
  }
  if (name === "invoke_agent") {
    const agent = params["agent_name"];
    if (typeof agent === "string") return agent;
  }
  return undefined;
}

// gemini reads non-interactive prompts via --prompt <text> rather than stdin.
export const geminiAdapter = defineCliAdapter<GeminiConfig>({
  kind: "gemini",
  buildCommand: buildGeminiCommand,
  prompt: { via: "arg", flag: "--prompt" },
  resolveEnv: (cfg) => cfg.env ?? {},
  extractSessionId: extractGeminiSessionId,
  extractTouchedPaths: extractGeminiTouchedPaths,
  extractTouchedEdits: extractGeminiTouchedEdits,
  extractToolUses: extractGeminiToolUses,
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
