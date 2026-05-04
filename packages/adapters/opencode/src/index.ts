import fs from "node:fs";
import path from "node:path";
import { defineCliAdapter } from "@loom/adapter-utils";
import type { AdapterConfig, BuiltCommand, McpServer } from "@loom/core";

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
  const xdgRoot = process.env.XDG_CONFIG_HOME ?? path.join(process.env.HOME ?? "", ".config");
  const userPath = path.join(xdgRoot, "opencode", "opencode.json");
  try {
    const raw = fs.readFileSync(userPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
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
