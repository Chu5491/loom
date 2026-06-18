import { defineCliAdapter, homePath, findSessionPaths } from "@loom/adapter-utils";
import type { AdapterConfig, BuiltCommand } from "@loom/core";

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
  /** droid 가 보는 작업 디렉토리(`--cwd`). spawn cwd 와 구분. */
  cwd?: string;
}

export function buildDroidCommand(config: DroidConfig = {}): BuiltCommand {
  const command = config.command ?? "droid";
  // `droid exec` = 비대화 1회 실행. `--output-format json` 은 완료 시 단일 객체
  //   {type:"result", is_error, result, session_id, usage:{input_tokens, output_tokens}}
  // 를 낸다(실측, droid 0.150.1). parse.ts 가 result/is_error/session_id + usage 토큰을
  // 잡는다 — cost 직접값은 없어 엔진이 단가로 추정(codex 와 같은 결). 도구/파일 단위
  // 이벤트만 없다(stream-jsonrpc 필요) → 활동 카드가 제한적.
  const args: string[] = ["exec", "--output-format", "json"];
  // 자율성: bypass 면 권한 우회, 아니면 --auto(기본 low). 기본 read-only 면 파일 편집이
  // 막혀 코딩이 조용히 실패하므로 최소 low 를 준다(codex workspace-write 와 같은 결).
  if (config.dangerouslySkipPermissions) {
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

/** `droid exec --output-format json` 최종 객체에서 session_id 를 캡처 — 다음 턴
 *  `--session-id` 로 재생(스레드 연속성). 주의: json 이 단일-라인(machine) 이라고
 *  가정한다 — pretty-print 라면 라인 파서가 못 읽으니 인증 후 실측 필요. */
export function extractDroidSessionId(chunk: string): string | null {
  for (const raw of chunk.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] !== "{") continue;
    try {
      const j = JSON.parse(line) as { type?: string; session_id?: string };
      if (j.type === "result" && typeof j.session_id === "string" && j.session_id) {
        return j.session_id;
      }
    } catch {
      // partial / malformed line
    }
  }
  return null;
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
  // 도구/파일 단위 추출기(extractToolUses/Touched*)는 미정의 — droid json 은 토큰(usage)은
  //   주지만 도구/파일 이벤트는 없다. droid 에서 그걸 받는 유일한 채널은 stream-jsonrpc 인데,
  //   이는 *양방향* JSON-RPC(stdin: droid.initialize_session→add_user_message, stdout:
  //   session_notification + request_permission/ask_user 역요청)라 loom 의 단방향 spawn
  //   (prompt 1회→stdout 파싱) 모델과 구조가 다르다. 도입하려면 어댑터가 RPC 클라이언트를
  //   구현해야 함 → 1차 보류. 인증 후 단방향 stream-json 스키마가 확인되면 그쪽으로 확장.
  //   MCP 도 `droid mcp`·.factory/mcp.json 경로가 있으나 스키마 미검증이라 함께 보류.
});
