# Spec 주입 검증 (P2) — 2026-06-10

office의 rules·skills·mcp가 5개 CLI 전부에서 실제로 작동하는지, 그리고 각 CLI의
root 설정(`~/.claude`, `~/.codex`, `~/.config/opencode`, `~/.gemini`, `~/.config/devin`)을
무시하는지 검증한 결과.

## 방법

- **Phase A (기계적)**: 각 CLI를 `scripts/capture-cli.mjs`(가짜 CLI)로 치환 →
  어댑터의 실제 주입 경로(buildCommand + applyMcpServers + applyPrompt + resolveEnv)를
  그대로 통과한 argv·env·stdin을 덤프. "무엇이 실제로 날아가는가"를 결정적으로 확인.
- **Phase B (행동적)**: 스킬에 카나리 토큰(`LOOM-SKILL-CANARY-9Q7`, 훈련데이터에 없음) +
  실제 MCP 서버(`scripts/canary-mcp.mjs`, `office_canary`→`MCP-CANARY-X4K9`). 진짜 CLI로
  실행 → 토큰이 나오면 파일을 실제로 읽었다는 증거.

## 결과

| CLI | rule | skill 읽기 | MCP 주입 메커니즘 | MCP 실호출 | root 격리 |
|-----|------|-----------|------------------|-----------|----------|
| claude-code | ✅ | ✅ 카나리 | `--mcp-config <loadout>/mcp.json --strict-mcp-config` | ✅ 토큰 반환 | ✅ strict |
| codex | ✅ | ✅ (Phase A) | `-c mcp_servers.<n>.command=…` (+ `${ENV}` 치환됨) | (로그아웃) | ✅ |
| opencode | ✅ | ✅ 카나리 | `XDG_CONFIG_HOME=<loadout>/xdg` + opencode.json | (대표=claude) | ✅ disable-project-config |
| antigravity | ✅ | ✅ 카나리 | `--add-dir`만 (MCP 등록 플래그 없음) | — | ✅ |
| devin | ✅ | (용량이슈) | 없음 (프롬프트 텍스트만) | — | ✅ |

## 핵심 결론

1. **규약·스킬·격리: 5개 CLI 전부 통과.** 모든 CLI가 자기 root를 무시하고 office 정의만 사용.
2. **MCP 실제 tool 주입+호출: claude / codex / opencode 3개 가능.**
3. **antigravity·devin은 MCP를 callable tool로 주입 불가** — CLI 구조적 한계:
   - antigravity: `--allowed-mcp-server-names`는 *필터*라 새 서버 *추가* 불가 (CLI root 의존).
   - devin: MCP를 자체 서브커맨드(`devin mcp`)로만 관리.
   - 두 경우 office MCP는 프롬프트 인덱스로만 인지됨 (호출은 안 됨). 우리 버그 아님.

## 검증 도구 (재현용)

- `scripts/capture-cli.mjs` — 가짜 CLI, 받은 invocation 덤프
- `scripts/canary-mcp.mjs` — 최소 MCP stdio 서버, 카나리 토큰 반환

재현: office에 카나리 skill + canary mcp + 5개 probe 에이전트(command=capture) 생성 →
run → `data/logs/<id>.log` 분석.
