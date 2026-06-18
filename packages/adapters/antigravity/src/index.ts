import fs from "node:fs";
import path from "node:path";
import { defineCliAdapter, homePath } from "@loom/adapter-utils";
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
  /** print 모드 대기 상한(Go duration, 예 "30m"). agy 기본은 5m0s 라, 5분 넘는
   *  작업(위임/회의 패널)이 agy 자체에서 잘린다 — loom run 한도까지 늘려 준다. */
  printTimeout?: string;
}

// agy print 기본 타임아웃은 5m — 코딩 에이전트엔 짧다. loom 의 위임(10m)·회의(20m)
// 한도를 넘게 넉넉히. 너무 길면 좀비를 방치하니 30m 로 절충(필요시 config 로 상향).
const DEFAULT_PRINT_TIMEOUT = "30m";

export function buildAntigravityCommand(config: AntigravityConfig = {}): BuiltCommand {
  const command = config.command ?? "agy";
  const args: string[] = [];
  // 모델은 --model 플래그로 — ANTIGRAVITY_MODEL env 는 현행 agy 바이너리가
  // 참조하지 않아(strings 검사 0건) 조용히 기본 모델로 돌아가는 함정이었다.
  if (config.model) args.push("--model", config.model);
  // print 모드 자체 타임아웃을 늘려 5분 넘는 답변이 잘리지 않게(미설정 시 agy 기본 5m).
  args.push("--print-timeout", config.printTimeout ?? DEFAULT_PRINT_TIMEOUT);
  if (config.dangerouslySkipPermissions) args.push("--dangerously-skip-permissions");
  if (config.sandbox) args.push("--sandbox");
  if (config.extraArgs?.length) args.push(...config.extraArgs);
  return { command, args };
}

// ── 출력 파싱 ───────────────────────────────────────────────────────────
// 주의: 실제 `agy --print` 는 **평문**만 출력한다 — `--output-format`/stream-json
// 모드가 없다(`agy --help` 로 확인). 따라서 아래 JSON 추출기들은 현행 agy 출력에
// 대해 사실상 동작하지 않는 fallback 이다. 세션 연속성은 stdout 이 아니라
// captureAntigravitySession(디스크 저장소)으로 되찾는다(아래).
//   (만약 미래의 agy 가 NDJSON 을 내보내면 이 추출기들이 의미를 갖는다)
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

// agy 는 대화를 ~/.gemini/antigravity-cli/conversations/<conversation-id>.db 로
// 보존한다 — 파일명이 곧 `--conversation` 이 받는 id 다. 평문 출력이라 stdout 에선
// 못 잡으니, run 직후 이 run 이 만진(newest, mtime ≥ since) .db 를 골라 그 id 를
// 되찾는다. 한계: 디스크에 loom thread 태그가 없어 같은 시간대에 agy 스레드 둘이
// 겹치면 교차될 수 있다 — loom 의 run 직렬화로 그 창을 좁게 유지한다.
const AGY_CONVERSATIONS = [".gemini", "antigravity-cli", "conversations"];

export async function captureAntigravitySession(ctx: { cwd: string; since: number }): Promise<string | null> {
  const dir = homePath(...AGY_CONVERSATIONS);
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null; // 저장소가 아직 없음(첫 대화 전)
  }
  let best: { id: string; mtime: number } | null = null;
  for (const name of entries) {
    if (!name.endsWith(".db")) continue;
    let mtime: number;
    try {
      mtime = fs.statSync(path.join(dir, name)).mtimeMs;
    } catch {
      continue; // 경합 중 사라진 파일 — 건너뜀
    }
    // 1s 여유 — mtime 해상도와 spawn 직전 since 의 미세 오차 흡수.
    if (mtime + 1000 < ctx.since) continue;
    if (!best || mtime > best.mtime) best = { id: name.slice(0, -3), mtime };
  }
  return best?.id ?? null;
}

export const antigravityAdapter = defineCliAdapter<AntigravityConfig>({
  kind: "antigravity",
  // agy 는 run별 MCP 주입 경로가 없음(플러그인은 CLI root 전역 설치뿐 — 헌법 3조).
  // 위임은 loadout 셸 브리지(delegate.sh)로 제공된다.
  supportsMcpServers: false,
  buildCommand: buildAntigravityCommand,
  prompt: { via: "arg", flag: "--print" },
  resolveEnv: (cfg) => cfg.env ?? {},
  applyResume: (args, sessionId) => [...args, "--conversation", sessionId],
  // 평문 출력이라 stdout 추출은 항상 빈손 — 세션은 디스크에서 되찾는다.
  extractSessionId: extractAntigravitySessionId,
  captureSessionFromDisk: (ctx) => captureAntigravitySession(ctx),
  // 세션 정리 — agy 대화 = ~/.gemini/antigravity-cli/conversations/<id>.db. 파일명이 곧 id.
  sessionFiles: (sessionId) => {
    const p = homePath(...AGY_CONVERSATIONS, `${sessionId}.db`);
    return fs.existsSync(p) ? [p] : [];
  },
  extractTouchedPaths: extractAntigravityTouchedPaths,
  extractTouchedEdits: extractAntigravityTouchedEdits,
  extractToolUses: extractAntigravityToolUses,
  applyMcpServers: ({ args, loadoutDir }) => {
    let next = args;
    if (loadoutDir) next = [...next, "--add-dir", loadoutDir];
    return { args: next };
  },
});
