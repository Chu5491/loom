import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineCliAdapter, findSessionPaths, parseJsonLines } from "@loom/adapter-utils";
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
  /** OpenCode agent profile name (--agent). */
  agent?: string;
  /** 추론 강도(opencode --variant) — 프로바이더별로 번역된다: minimal/low/medium/
   *  high/xhigh(OpenAI reasoning_effort), high/max(Anthropic thinking budget),
   *  low/high(Google). claude --effort·codex model_reasoning_effort 의 opencode 짝. */
  variant?: string;
  /** 사고과정(reasoning) 블록을 스트림에 노출(--thinking). 켜야 reasoning 이벤트가
   *  나온다. 추론 토큰이 과금되므로 opt-in. */
  thinking?: boolean;
}

export function buildOpencodeCommand(config: OpencodeConfig = {}): BuiltCommand {
  const command = config.command ?? "opencode";
  const args: string[] = ["run", "--format", "json"];
  if (config.continueSession) args.push("--continue");
  if (config.sessionId) args.push("--session", config.sessionId);
  if (config.model) args.push("--model", config.model);
  if (config.variant) args.push("--variant", config.variant);
  if (config.thinking) args.push("--thinking");
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

/** 순수 — 사용자 opencode 설정에 우리 MCP 서버만 더한다(이름 충돌 시 우리 우선).
 *  사용자의 기존 .mcp 서버·다른 설정은 보존: 통째로 덮어쓰면 run 중 사용자
 *  전역 MCP 가 사라진다. 새 객체를 돌려준다(입력 불변). */
export function mergeOpencodeMcp(
  userConfig: Record<string, unknown>,
  servers: McpServer[],
): Record<string, unknown> {
  const existingMcp =
    userConfig.mcp && typeof userConfig.mcp === "object"
      ? (userConfig.mcp as Record<string, unknown>)
      : {};
  const mcp: Record<string, unknown> = { ...existingMcp };
  for (const s of servers) mcp[s.name] = toOpencodeMcpEntry(s);
  return { ...userConfig, mcp };
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

const parseOpencodeLines = (chunk: string): Generator<OpencodeEvent> => parseJsonLines<OpencodeEvent>(chunk);

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
  // 세션 정리 — opencode 는 XDG_DATA/opencode/storage 아래 ses_… 가 박힌 파일·디렉토리
  //   (session/<proj-hash>/<id>.json · message/<id>/ · todo·session_diff 등 여러 곳)에 저장.
  //   proj-hash 규칙이 불명확해 id 로 통째 찾는다.
  sessionFiles: (sessionId) => {
    const dataRoot = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
    return findSessionPaths(path.join(dataRoot, "opencode", "storage"), sessionId);
  },
  // opencode는 런타임 CLI 플래그로 MCP 서버를 등록할 수 없음. 대신:
  //   1) 사용자의 기존 opencode.json을 읽어 모델/auth 등 다른 설정은 보존
  //   2) 우리 MCP 서버만 .mcp 필드에 합쳐 새 파일을 <loadoutDir>/xdg/opencode/opencode.json에 씀
  //   3) XDG_CONFIG_HOME=<loadoutDir>/xdg 로 spawn → opencode가 우리 파일을 읽음
  //   4) OPENCODE_DISABLE_PROJECT_CONFIG=1 — cwd의 opencode.json은 무시 (loom이 정본)
  applyMcpServers: ({ args, servers, loadoutDir, ephemeral }) => {
    if (!loadoutDir) return { args };
    const env: Record<string, string> = {};

    // MCP 주입: 서버가 있을 때만 XDG_CONFIG_HOME 을 우리 opencode.json 으로 리다이렉트.
    if (servers.length > 0) {
      const xdgRoot = path.join(loadoutDir, "xdg");
      const opencodeDir = path.join(xdgRoot, "opencode");
      fs.mkdirSync(opencodeDir, { recursive: true });
      const merged = mergeOpencodeMcp(readUserOpencodeConfig(), servers);
      fs.writeFileSync(path.join(opencodeDir, "opencode.json"), JSON.stringify(merged, null, 2));
      env.XDG_CONFIG_HOME = xdgRoot;
      env.OPENCODE_DISABLE_PROJECT_CONFIG = "1";
    }

    // 세션 미보존: 비-스레드 run 은 resume 가 없어 세션을 남길 필요가 없다. opencode 는
    // 세션 DB(opencode.db)를 XDG_DATA_HOME 아래 두므로, 그걸 loadoutDir 안 임시 경로로
    // 돌린다 → run 종료 시 loadoutDir 과 함께 삭제돼 사용자 세션 스토어(~/.local/share)에
    // 안 쌓인다. auth.json/account.json 만 실제 위치에서 심링크해 자격증명은 유지 — 안
    // 그러면 인증 모델이 깨진다(무료 big-pickle 은 자격증명이 없어 심링크가 no-op).
    if (ephemeral) {
      const dataRoot = path.join(loadoutDir, "data");
      const ocData = path.join(dataRoot, "opencode");
      fs.mkdirSync(ocData, { recursive: true });
      const realRoot = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
      for (const f of ["auth.json", "account.json"]) {
        const src = path.join(realRoot, "opencode", f);
        if (fs.existsSync(src)) {
          try { fs.symlinkSync(src, path.join(ocData, f)); }
          catch { /* 이미 있으면(드묾) 그대로 — 자격증명 보존 우선 */ }
        }
      }
      env.XDG_DATA_HOME = dataRoot;
    }

    return Object.keys(env).length ? { args, env } : { args };
  },
});
