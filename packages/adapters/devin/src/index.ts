import fs from "node:fs";
import path from "node:path";
import { defineCliAdapter } from "@loom/adapter-utils";
import type { AdapterConfig, BuiltCommand, McpServer } from "@loom/core";

export { devinManifest } from "./manifest.js";
export { devinProbe } from "./probe.js";
export { devinListModels } from "./models.js";
export { DEVIN_PRESET_MODELS } from "./preset-models.js";

export interface DevinConfig extends AdapterConfig {
  model?: string;
  command?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
  /** Auto-approve every tool (`--permission-mode dangerous`). Default is the
   *  CLI's "auto" (read-only tools auto-approved, writes prompt). */
  dangerouslySkipPermissions?: boolean;
}

export function buildDevinCommand(config: DevinConfig = {}): BuiltCommand {
  const command = config.command ?? "devin";
  const args: string[] = [];
  if (config.model) args.push("--model", config.model);
  if (config.dangerouslySkipPermissions) {
    args.push("--permission-mode", "dangerous");
  }
  if (config.extraArgs?.length) args.push(...config.extraArgs);
  return { command, args };
}

/** McpServer → devin `.devin/config.local.json` mcpServers 한 엔트리.
 *  검증된 스키마: { command, args, transport:"stdio" } | { url, transport }. */
export function toDevinMcpEntry(s: McpServer): Record<string, unknown> {
  if (s.kind === "stdio") {
    return {
      ...(s.command ? { command: s.command } : {}),
      args: s.args,
      ...(Object.keys(s.env).length > 0 ? { env: s.env } : {}),
      transport: "stdio",
    };
  }
  return {
    ...(s.url ? { url: s.url } : {}),
    ...(Object.keys(s.headers).length > 0 ? { headers: s.headers } : {}),
    transport: s.kind,
  };
}

// Devin runs non-interactively via `--print "<prompt>"` and emits plain text
// (no documented stream-json envelope), so there are no session / tool / cost
// extractors — each Loom run is a fresh turn.
//
// MCP 주입: devin 의 *프로젝트-로컬* 설정 `<cwd>/.devin/config.local.json` 에
// mcpServers 를 merge-write 한다 (실호출 검증됨 — MCP-CANARY-X4K9). CLI root
// (~/.config/devin)는 건드리지 않음. 기존 파일의 다른 항목·사용자 서버는 보존,
// 같은 이름만 이번 run 정의로 교체. 이전 run 이 남긴 loom 서버가 이름이 바뀌면
// stale 로 남을 수 있음 — 로컬 설정 파일 특성상 수용 (다음 run 이 다시 쓴다).
export const devinAdapter = defineCliAdapter<DevinConfig>({
  kind: "devin",
  buildCommand: buildDevinCommand,
  prompt: { via: "arg", flag: "--print" },
  resolveEnv: (cfg) => ({ ...(cfg.env ?? {}) }),
  applyResume: (args, sessionId) => [...args, "--resume", sessionId],
  applyMcpServers: ({ args, servers, cwd }) => {
    if (servers.length > 0) writeDevinMcpConfig(cwd, servers);
    return { args };
  },
});

/** `<cwd>/.devin/config.local.json` 에 mcpServers merge-write.
 *  기존 파일의 다른 키·사용자 서버는 보존, 같은 이름만 교체. exported for tests. */
export function writeDevinMcpConfig(cwd: string, servers: McpServer[]): string {
  const file = path.join(cwd, ".devin", "config.local.json");
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    // 없거나 깨졌으면 새로 시작
  }
  const prev = (existing.mcpServers ?? {}) as Record<string, unknown>;
  const merged = {
    ...existing,
    mcpServers: {
      ...prev,
      ...Object.fromEntries(servers.map((s) => [s.name, toDevinMcpEntry(s)])),
    },
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(merged, null, 2));
  return file;
}
