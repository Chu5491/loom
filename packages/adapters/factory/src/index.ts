import fs from "node:fs";
import path from "node:path";
import { defineCliAdapter, homePath, findSessionPaths } from "@loom/adapter-utils";
import type { AdapterConfig, BuiltCommand, McpServer } from "@loom/core";

export { factoryManifest } from "./manifest.js";
export { factoryProbe } from "./probe.js";
export { factoryListModels } from "./models.js";
export { DROID_PRESET_MODELS } from "./preset-models.js";

export interface DroidConfig extends AdapterConfig {
  command?: string;
  model?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
  /** 추론 강도(`-r/--reasoning-effort`) — 모델별로 해석. */
  reasoningEffort?: string;
  /** 자율성 레벨(`--auto`): low(파일편집) · medium(명령·git) · high(push 등 비가역).
   *  기본 low — droid 기본은 read-only 라 최소 low 를 줘야 파일 편집·코딩이 가능. */
  auto?: "low" | "medium" | "high";
  /** 모든 권한 확인 우회(`--skip-permissions-unsafe`). 엔진 공통 bypass 토글과 매핑.
   *  격리 환경 전용. */
  dangerouslySkipPermissions?: boolean;
  /** 읽기 전용(회의실 등) — --auto 를 안 줘 droid 기본 read-only 로 둔다(쓰기 차단). */
  readonly?: boolean;
  /** droid 가 보는 작업 디렉토리(`--cwd`). spawn cwd 와 구분. */
  cwd?: string;
}

export function buildDroidCommand(config: DroidConfig = {}): BuiltCommand {
  const command = config.command ?? "droid";
  // `droid exec -o stream-json` = 비대화 1회, 단방향 JSONL 스트림(실측 droid 0.150.1):
  //   {type:"system",subtype:"init",session_id} · {type:"message",role,text} ·
  //   {type:"reasoning",text} · {type:"tool_call",toolName,parameters{file_path,...}} ·
  //   {type:"completion",finalText,usage{input/output/cache_read_input_tokens}} 최종.
  // parse.ts 가 text/reasoning/tool/file/usage 로 매핑(claude·codex 수준 활동). cost 직접값은
  // 없어 엔진이 토큰×단가 추정(캐시분 할인). 단방향이라 stream-jsonrpc(양방향) 불필요.
  const args: string[] = ["exec", "--output-format", "stream-json"];
  // 자율성: readonly(회의 등)면 --auto 를 안 줘 droid 기본 read-only(쓰기 차단). 아니면
  // bypass 면 권한 우회, 아니면 --auto(기본 low). 기본 read-only 면 파일 편집이 막혀
  // 코딩이 조용히 실패하므로 최소 low 를 준다(codex workspace-write 와 같은 결).
  if (config.readonly) {
    // 권한 플래그 미부여 → droid 기본 read-only
  } else if (config.dangerouslySkipPermissions) {
    args.push("--skip-permissions-unsafe");
  } else {
    args.push("--auto", config.auto ?? "low");
  }
  if (config.model) args.push("--model", config.model);
  if (config.reasoningEffort) args.push("--reasoning-effort", config.reasoningEffort);
  if (config.cwd) args.push("--cwd", config.cwd);
  if (config.extraArgs?.length) args.push(...config.extraArgs);
  return { command, args };
}

/** stream-json 은 모든 이벤트가 session_id 를 갖는다(init 부터, 실측). 첫 등장값을
 *  캡처해 다음 턴 `--session-id` 로 재생(스레드 연속성). */
export function extractDroidSessionId(chunk: string): string | null {
  for (const raw of chunk.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] !== "{") continue;
    try {
      const j = JSON.parse(line) as { session_id?: unknown };
      if (typeof j.session_id === "string" && j.session_id) return j.session_id;
    } catch {
      // partial / malformed line
    }
  }
  return null;
}

const LOOM_DELEGATE = "loom";

/** McpServer → droid `.factory/mcp.json` 항목. claude `.mcp.json` 과 동일 스키마:
 *    stdio    → { type:"stdio", command, args, env }
 *    http/sse → { type:"http"|"sse", url, headers }
 *  exported for tests. */
export function toDroidMcpEntry(s: McpServer): Record<string, unknown> {
  if (s.kind === "stdio") {
    return {
      type: "stdio",
      ...(s.command ? { command: s.command } : {}),
      args: s.args,
      ...(Object.keys(s.env).length > 0 ? { env: s.env } : {}),
    };
  }
  return {
    type: s.kind,
    ...(s.url ? { url: s.url } : {}),
    ...(Object.keys(s.headers).length > 0 ? { headers: s.headers } : {}),
  };
}

/** `<cwd>/.factory/mcp.json` 에 mcpServers 를 merge-write. droid 는 MCP 설정파일
 *  경로 플래그가 없어(claude --mcp-config 와 달리) 이 프로젝트-로컬 파일을 자동으로
 *  읽는다 — user > folder > project 계층의 project 단계(헌법3: 전역 ~/.factory 불가침).
 *  devin 의 .devin/config.local.json 과 같은 패턴. 사용자의 기존 서버는 보존하고 같은
 *  이름만 이번 run 정의로 교체, runId 가 박힌 stale loom delegate 엔트리는 매번 제거.
 *  주입할 것도 정리할 기존 파일도 없으면 빈 파일을 만들지 않는다(repo 오염 최소화).
 *  exported for tests. */
export function syncFactoryMcpConfig(cwd: string, servers: McpServer[]): string | null {
  const file = path.join(cwd, ".factory", "mcp.json");
  let existing: Record<string, unknown> = {};
  let hadFile = false;
  try {
    existing = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    hadFile = true;
  } catch {
    // 없거나 깨졌으면 새로 시작
  }
  const prev = { ...((existing.mcpServers ?? {}) as Record<string, unknown>) };
  delete prev[LOOM_DELEGATE]; // stale transient loom 엔트리 제거
  const next = { ...prev, ...Object.fromEntries(servers.map((s) => [s.name, toDroidMcpEntry(s)])) };
  if (!hadFile && Object.keys(next).length === 0) return null;
  const merged = { ...existing, mcpServers: next };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(merged, null, 2));
  return file;
}

export const factoryAdapter = defineCliAdapter<DroidConfig>({
  kind: "factory",
  buildCommand: buildDroidCommand,
  // 프롬프트는 stdin 으로 — `echo "<prompt>" | droid exec`. arg 인용/길이 문제를 피함.
  prompt: { via: "stdin" },
  // droid 는 시스템 프롬프트 채널을 지원(`--append-system-prompt`) — claude 처럼 rules+
  // 페르소나를 시스템으로 분리. 미지원 CLI 와 달리 엔진이 system 을 따로 넘긴다.
  supportsSystemPrompt: true,
  applySystemPrompt: (args, system) => [...args, "--append-system-prompt", system],
  resolveEnv: (cfg) => cfg.env ?? {},
  // 세션 이어가기: 이전 run 이 발급한 session_id 를 `--session-id` 로 재생.
  applyResume: (args, sessionId) => [...args, "--session-id", sessionId],
  extractSessionId: extractDroidSessionId,
  // 세션 정리 — droid 세션 = ~/.factory/sessions 아래(인증 후 생성, 레이아웃 미검증) — id 로 찾는다.
  sessionFiles: (sessionId) => findSessionPaths(homePath(".factory", "sessions"), sessionId),
  // MCP 주입 — 프로젝트-로컬 <cwd>/.factory/mcp.json 자동읽기(devin 패턴, 헌법3 준수).
  // servers 가 비어도 호출되지만(loadoutDir 항상 전달) sync 가 빈 파일은 안 만든다.
  // 검증됨(2026-06-19): `droid mcp list` 가 이 파일을 [project] 스코프로 읽는다 —
  // *프로세스 cwd* 기준(droid --cwd 플래그가 아니라 spawn cwd). loom 이 그 cwd 에
  // 쓰므로 일치. exec 중 실제 도구 호출만 유료 키 라이브 게이트로 남음.
  applyMcpServers: ({ args, servers, cwd }) => {
    syncFactoryMcpConfig(cwd, servers);
    return { args };
  },
  // 활동(텍스트·reasoning·도구·파일·토큰)은 -o stream-json 출력을 server parse.ts 가
  //   직접 매핑한다 — 어댑터 레벨 extractToolUses/Touched* 불필요(stream 이 풍부).
  //   stream-json 전체 스키마는 custom 로컬모델로 실측 검증(2026-06-19).
});
