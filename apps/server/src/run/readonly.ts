// 읽기 전용 run(회의실 패널·의장 등) — 코드는 읽되 파일 쓰기·명령 실행은 차단한다.
// 에이전트가 평소 쥔 쓰기 권한(bypass/sandbox/auto)을 무시하고 각 CLI 네이티브 읽기전용
// 모드로 매핑. 헌법: 프롬프트는 안 건드리고 실행 플래그만 바꾼다(자동주입 아님).
//   claude       → --permission-mode plan (분석만, 실행 안 함)
//   codex        → --sandbox read-only
//   factory      → readonly (droid 기본 read-only — --auto 미부여)
//   antigravity  → --sandbox (best-effort)
//   devin/opencode → bypass 미부여로 기본 읽기-우선 (best-effort: 네이티브 강제 수단 없음)
import type { AdapterConfig, AdapterKind } from "@loom/core";

export function readonlyConfig(kind: AdapterKind): AdapterConfig {
  // 공통 — 어떤 경로(에이전트 config·엔진 토글)로 들어온 쓰기 권한 우회도 끈다.
  const noBypass = { dangerouslySkipPermissions: false };
  switch (kind) {
    case "claude-code":
      return { ...noBypass, permissionMode: "plan" };
    case "codex":
      return { ...noBypass, sandboxMode: "read-only", dangerouslyBypassApprovalsAndSandbox: false };
    case "factory":
      return { ...noBypass, readonly: true };
    case "antigravity":
      return { ...noBypass, sandbox: true };
    case "devin":
    case "opencode":
      return { ...noBypass };
  }
}
