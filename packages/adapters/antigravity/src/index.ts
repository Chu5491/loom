import { defineCliAdapter } from "@loom/adapter-utils";
import type { AdapterConfig, BuiltCommand, ToolUse, TouchedEdit } from "@loom/core";

export { antigravityManifest } from "./manifest.js";
export { antigravityProbe } from "./probe.js";
export { antigravityListModels, parseModelLines } from "./models.js";
export { ANTIGRAVITY_PRESET_MODELS } from "./preset-models.js";

export interface AntigravityConfig extends AdapterConfig {
  model?: string;
  command?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
  /** Auto-approve all tool permission requests without prompting. */
  dangerouslySkipPermissions?: boolean;
  sandbox?: boolean;
}

export function buildAntigravityCommand(config: AntigravityConfig = {}): BuiltCommand {
  const command = config.command ?? "agy";
  const args: string[] = [];
  if (config.dangerouslySkipPermissions) args.push("--dangerously-skip-permissions");
  if (config.sandbox) args.push("--sandbox");
  if (config.extraArgs?.length) args.push(...config.extraArgs);
  return { command, args };
}

// ── stream-json extraction ─────────────────────────────────────────────
// Antigravity CLI (Google's successor to Gemini CLI, 2026-06-18) uses
// the same stream-json NDJSON format:
//   init        → { type: "init", session_id, model }
//   tool_use    → { type: "tool_use", tool_name, tool_id, parameters }
//   tool_result → { type: "tool_result", tool_id, status, output }
//   message     → { type: "message", role, content }
//   result      → { type: "result", status, stats }

interface StreamEvent {
  type?: string;
  session_id?: string;
  tool_name?: string;
  parameters?: Record<string, unknown>;
}

function* parseLines(chunk: string): Generator<StreamEvent> {
  for (const raw of chunk.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] !== "{") continue;
    try {
      yield JSON.parse(line) as StreamEvent;
    } catch {
      // partial / malformed line
    }
  }
}

export function extractAntigravitySessionId(chunk: string): string | null {
  for (const ev of parseLines(chunk)) {
    if (ev.type === "init" && typeof ev.session_id === "string" && ev.session_id) {
      return ev.session_id;
    }
  }
  return null;
}

const FILE_EDIT_TOOLS: Record<string, true> = { replace: true, write_file: true };

export function extractAntigravityTouchedEdits(chunk: string): TouchedEdit[] {
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

export function extractAntigravityTouchedPaths(chunk: string): string[] {
  return extractAntigravityTouchedEdits(chunk).map((e) => e.path);
}

export function extractAntigravityToolUses(chunk: string): ToolUse[] {
  const out: ToolUse[] = [];
  for (const ev of parseLines(chunk)) {
    if (ev.type !== "tool_use" || !ev.tool_name) continue;
    out.push({ name: ev.tool_name, target: summariseInput(ev.tool_name, ev.parameters) });
  }
  return out;
}

function summariseInput(
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

export const antigravityAdapter = defineCliAdapter<AntigravityConfig>({
  kind: "antigravity",
  // agy 는 run별 MCP 주입 경로가 없음(플러그인은 CLI root 전역 설치뿐 — 헌법 3조).
  // 위임은 loadout 셸 브리지(delegate.sh)로 제공된다.
  supportsMcpServers: false,
  buildCommand: buildAntigravityCommand,
  prompt: { via: "arg", flag: "--print" },
  resolveEnv: (cfg) => {
    const env: Record<string, string> = { ...(cfg.env ?? {}) };
    if (cfg.model) env["ANTIGRAVITY_MODEL"] = cfg.model;
    return env;
  },
  applyResume: (args, sessionId) => [...args, "--conversation", sessionId],
  extractSessionId: extractAntigravitySessionId,
  extractTouchedPaths: extractAntigravityTouchedPaths,
  extractTouchedEdits: extractAntigravityTouchedEdits,
  extractToolUses: extractAntigravityToolUses,
  applyMcpServers: ({ args, loadoutDir }) => {
    let next = args;
    if (loadoutDir) next = [...next, "--add-dir", loadoutDir];
    return { args: next };
  },
});
