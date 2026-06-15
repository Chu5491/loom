import fs from "node:fs";
import path from "node:path";
import { defineCliAdapter, spawnCapture, stripAnsi } from "@loom/adapter-utils";
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
// *stream* extractors. 대화 연속성은 stdout 이 아니라 captureDevinSession
// (디스크 저장소)으로 되찾는다 — 아래.
//
// MCP 주입: devin 의 *프로젝트-로컬* 설정 `<cwd>/.devin/config.local.json` 에
// mcpServers 를 merge-write 한다 (실호출 검증됨 — MCP-CANARY-X4K9). CLI root
// (~/.config/devin)는 건드리지 않음. 기존 파일의 다른 항목·사용자 서버는 보존,
// 같은 이름만 이번 run 정의로 교체. 이전 run 이 남긴 loom 서버가 이름이 바뀌면
// stale 로 남을 수 있음 — 로컬 설정 파일 특성상 수용 (다음 run 이 다시 쓴다).
interface DevinSession {
  id?: string;
  last_activity_at?: number; // epoch seconds
}

// devin 은 세션을 ~/.local/share/devin/cli/sessions.db 에 보존하고 `devin list`
// 가 *현재 디렉토리*(cwd) 스코프로 내준다. CLI 를 진실로 삼아(헌법 1조) sqlite 를
// 직접 읽지 않는다 — cwd 로 이미 좁혀지고, 이 run 이 만진 세션만(last_activity ≥
// since) 고른다. resume 은 다음 턴에 --resume <id> 로. 한계: 같은 프로젝트에서
// 두 thread 가 동시에 돌면 cwd 만으로는 구분 못 한다(run 직렬화로 창을 좁힘).
export async function captureDevinSession(
  ctx: { cwd: string; since: number },
  config: DevinConfig,
): Promise<string | null> {
  const command = config.command ?? "devin";
  const { exitCode, stdout } = await spawnCapture(command, ["list", "--format", "json"], {
    cwd: ctx.cwd,
    timeoutMs: 10_000,
  });
  if (exitCode !== 0) return null;
  let sessions: unknown;
  try {
    sessions = JSON.parse(stripAnsi(stdout).trim());
  } catch {
    return null; // 비-JSON(빈 디렉토리 등)
  }
  if (!Array.isArray(sessions)) return null;
  let best: DevinSession | null = null;
  for (const s of sessions as DevinSession[]) {
    if (typeof s.id !== "string" || typeof s.last_activity_at !== "number") continue;
    // last_activity_at 은 epoch 초 — since(ms)와 비교, 2s 여유.
    if (s.last_activity_at * 1000 + 2000 < ctx.since) continue;
    if (!best || s.last_activity_at > (best.last_activity_at ?? 0)) best = s;
  }
  return best?.id ?? null;
}

export const devinAdapter = defineCliAdapter<DevinConfig>({
  kind: "devin",
  buildCommand: buildDevinCommand,
  prompt: { via: "arg", flag: "--print" },
  resolveEnv: (cfg) => ({ ...(cfg.env ?? {}) }),
  applyResume: (args, sessionId) => [...args, "--resume", sessionId],
  captureSessionFromDisk: captureDevinSession,
  applyMcpServers: ({ args, servers, cwd }) => {
    // servers 가 비어도 호출 — 직전 run 이 남긴 transient loom 엔트리를 정리해야
    // 한다(아래). loadoutDir 이 항상 전달되므로 define 이 매 run 훅을 부른다.
    syncDevinMcpConfig(cwd, servers);
    return { args };
  },
});

// loom delegate 서버 이름 — run 마다 runId 가 박힌 URL 이라 영속되면 다음 run 이
// 죽은 runId 도구를 보게 된다(parent_run_not_found). 매 sync 에서 걷어낸다.
const LOOM_DELEGATE = "loom";

/** `<cwd>/.devin/config.local.json` 에 mcpServers 를 sync.
 *  - 사용자의 다른 키·서버는 보존, 이번 run 의 서버만 교체
 *  - transient loom 엔트리는 항상 제거 후 (이번 run 이 delegate 면) 새로 추가
 *  - 쓸 서버가 없고 파일도 없으면 빈 설정을 만들지 않는다
 *  exported for tests. */
export function syncDevinMcpConfig(cwd: string, servers: McpServer[]): string | null {
  const file = path.join(cwd, ".devin", "config.local.json");
  let existing: Record<string, unknown> = {};
  let existed = false;
  try {
    existing = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    existed = true;
  } catch {
    // 없거나 깨졌으면 새로 시작
  }
  const prev = { ...((existing.mcpServers ?? {}) as Record<string, unknown>) };
  const hadLoom = LOOM_DELEGATE in prev;
  delete prev[LOOM_DELEGATE]; // stale transient 엔트리 제거
  const next = { ...prev, ...Object.fromEntries(servers.map((s) => [s.name, toDevinMcpEntry(s)])) };

  // 파일이 없고 쓸 것도 없으면 빈 .devin/ 를 만들지 않는다.
  if (!existed && Object.keys(next).length === 0) return null;
  // 파일은 있지만 바뀐 게 없으면(걷어낼 loom 도 없고 새 서버도 없음) 그대로 둔다.
  if (existed && !hadLoom && servers.length === 0) return null;

  const merged = { ...existing, mcpServers: next };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(merged, null, 2));
  return file;
}
