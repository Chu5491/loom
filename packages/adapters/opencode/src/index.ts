import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineCliAdapter } from "@loom/adapter-utils";
import type { AdapterConfig, BuiltCommand, McpServer, ToolUse, TouchedEdit } from "@loom/core";

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
  const args: string[] = ["run", "--format", "json"];
  if (config.continueSession) args.push("--continue");
  if (config.sessionId) args.push("--session", config.sessionId);
  if (config.model) args.push("--model", config.model);
  if (config.agent) args.push("--agent", config.agent);
  if (config.extraArgs?.length) args.push(...config.extraArgs);
  return { command, args };
}

/** McpServer → opencode.json `mcp` 항목 한 개. opencode 포맷:
 *    stdio  → { type: "local",  command: [bin, ...args], environment: {...}, enabled: true }
 *    http/sse → { type: "remote", url, headers: {...}, enabled: true }
 *  paperclip의 prepareOpenCodeRuntimeConfig가 쓰는 형태와 동일. */
export function toOpencodeMcpEntry(server: McpServer): Record<string, unknown> {
  if (server.kind === "stdio") {
    return {
      type: "local",
      command: [
        ...(server.command ? [server.command] : []),
        ...server.args,
      ],
      ...(Object.keys(server.env).length > 0
        ? { environment: server.env }
        : {}),
      enabled: true,
    };
  }
  return {
    type: "remote",
    ...(server.url ? { url: server.url } : {}),
    ...(Object.keys(server.headers).length > 0 ? { headers: server.headers } : {}),
    enabled: true,
  };
}

/** 사용자의 기존 ~/.config/opencode/opencode.json을 읽어 우리 mcp만 합침.
 *  실패하거나 파일이 없으면 빈 객체로 시작 (모델/auth 같은 사용자 설정은 그대로 유지). */
function readUserOpencodeConfig(): Record<string, unknown> {
  // Windows: %APPDATA% is the standard config root. Unix: ~/.config (XDG default).
  const xdgRoot = process.env.XDG_CONFIG_HOME
    ?? (process.platform === "win32"
      ? process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming")
      : path.join(os.homedir(), ".config"));
  const userPath = path.join(xdgRoot, "opencode", "opencode.json");
  try {
    const raw = fs.readFileSync(userPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ── --format json extraction ───────────────────────────────────────────
// `opencode run --format json` emits NDJSON:
//   { type: "tool_use",    timestamp, sessionID, part: { tool, state: { status, input, output } } }
//   { type: "step_start",  timestamp, sessionID, part: { snapshot } }
//   { type: "step_finish", timestamp, sessionID, part: { ... } }
//   { type: "text",        timestamp, sessionID, part: { text } }
//   { type: "error",       timestamp, sessionID, error }
//
// Tool names: edit, write, bash, read, grep, glob, list, webfetch, websearch,
//   question, skill, task, todowrite, apply_patch, codesearch.
// Input params: filePath (for edit/write/read), oldString/newString (for edit),
//   command (for bash), path (for glob/list).

interface OpencodeEvent {
  type?: string;
  sessionID?: string;
  part?: {
    tool?: string;
    state?: {
      status?: string;
      input?: Record<string, unknown>;
      output?: string;
    };
  };
}

function* parseOpencodeLines(chunk: string): Generator<OpencodeEvent> {
  for (const raw of chunk.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] !== "{") continue;
    try {
      yield JSON.parse(line) as OpencodeEvent;
    } catch {
      // partial / malformed line
    }
  }
}

export function extractOpencodeSessionId(chunk: string): string | null {
  for (const ev of parseOpencodeLines(chunk)) {
    if (typeof ev.sessionID === "string" && ev.sessionID) {
      return ev.sessionID;
    }
  }
  return null;
}

const FILE_EDIT_TOOLS: Record<string, true> = { edit: true, write: true };

export function extractOpencodeTouchedEdits(chunk: string): TouchedEdit[] {
  const out: TouchedEdit[] = [];
  for (const ev of parseOpencodeLines(chunk)) {
    if (ev.type !== "tool_use" || !ev.part?.tool) continue;
    if (!FILE_EDIT_TOOLS[ev.part.tool]) continue;
    const input = ev.part.state?.input;
    const filePath = input?.["filePath"];
    if (typeof filePath !== "string" || !filePath) continue;
    const target = input?.["oldString"];
    out.push({ path: filePath, target: typeof target === "string" ? target : undefined });
  }
  return out;
}

export function extractOpencodeTouchedPaths(chunk: string): string[] {
  return extractOpencodeTouchedEdits(chunk).map((e) => e.path);
}

export function extractOpencodeToolUses(chunk: string): ToolUse[] {
  const out: ToolUse[] = [];
  for (const ev of parseOpencodeLines(chunk)) {
    if (ev.type !== "tool_use" || !ev.part?.tool) continue;
    out.push({
      name: ev.part.tool,
      target: summariseOpencodeInput(ev.part.tool, ev.part.state?.input),
    });
  }
  return out;
}

function summariseOpencodeInput(
  name: string,
  input: Record<string, unknown> | undefined,
): string | undefined {
  if (!input) return undefined;
  const filePath = input["filePath"];
  if (typeof filePath === "string" && filePath) return filePath;
  const pathVal = input["path"];
  if (typeof pathVal === "string" && pathVal) return pathVal;
  if (name === "bash") {
    const cmd = input["command"];
    if (typeof cmd === "string") return cmd.slice(0, 80);
  }
  if (name === "grep" || name === "codesearch") {
    const pat = input["pattern"] ?? input["query"];
    if (typeof pat === "string") return pat;
  }
  if (name === "webfetch") {
    const url = input["url"];
    if (typeof url === "string") return url.slice(0, 80);
  }
  if (name === "websearch") {
    const q = input["query"];
    if (typeof q === "string") return q.slice(0, 80);
  }
  return undefined;
}

// `opencode run` takes the prompt as a trailing positional argument.
export const opencodeAdapter = defineCliAdapter<OpencodeConfig>({
  kind: "opencode",
  buildCommand: buildOpencodeCommand,
  prompt: { via: "arg" },
  resolveEnv: (cfg) => cfg.env ?? {},
  extractSessionId: extractOpencodeSessionId,
  extractTouchedPaths: extractOpencodeTouchedPaths,
  extractTouchedEdits: extractOpencodeTouchedEdits,
  extractToolUses: extractOpencodeToolUses,
  // `opencode run --session <id>` resumes that conversation. Splice it
  // in front of the existing args so the runtime session beats any
  // static `config.sessionId` the user may have set.
  applyResume: (args, sessionId) => ["run", "--session", sessionId, ...args.slice(1)],
  // opencode는 런타임 CLI 플래그로 MCP 서버를 등록할 수 없음. 대신:
  //   1) 사용자의 기존 opencode.json을 읽어 모델/auth 등 다른 설정은 보존
  //   2) 우리 MCP 서버만 .mcp 필드에 합쳐 새 파일을 <loadoutDir>/xdg/opencode/opencode.json에 씀
  //   3) XDG_CONFIG_HOME=<loadoutDir>/xdg 로 spawn → opencode가 우리 파일을 읽음
  //   4) OPENCODE_DISABLE_PROJECT_CONFIG=1 — cwd의 opencode.json은 무시 (loom이 정본)
  applyMcpServers: ({ args, servers, loadoutDir }) => {
    if (!loadoutDir || servers.length === 0) return { args };

    const xdgRoot = path.join(loadoutDir, "xdg");
    const opencodeDir = path.join(xdgRoot, "opencode");
    fs.mkdirSync(opencodeDir, { recursive: true });

    const merged = readUserOpencodeConfig();
    const mcpMap: Record<string, unknown> = {};
    for (const s of servers) mcpMap[s.name] = toOpencodeMcpEntry(s);
    merged.mcp = mcpMap;
    fs.writeFileSync(
      path.join(opencodeDir, "opencode.json"),
      JSON.stringify(merged, null, 2),
    );

    return {
      args,
      env: {
        XDG_CONFIG_HOME: xdgRoot,
        OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      },
    };
  },
});
