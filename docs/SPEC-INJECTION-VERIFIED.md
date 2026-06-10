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
| claude-code | ✅ | ✅ 카나리 | `--mcp-config <loadout>/mcp.json --strict-mcp-config` | ✅ MCP-CANARY-X4K9 | ✅ strict |
| codex | ✅ | ✅ (Phase A) | `-c mcp_servers.<n>.command=…` (+ `${ENV}` 치환됨) | (로그아웃) | ✅ |
| opencode | ✅ | ✅ 카나리 | `XDG_CONFIG_HOME=<loadout>/xdg` + opencode.json | (대표=claude) | ✅ disable-project-config |
| antigravity | ✅ | ✅ 카나리 | ✗ 불가 (`--add-dir`만) | ✗ | ✅ |
| devin | ✅ | ✅ 카나리 | **`<cwd>/.devin/config.local.json` merge-write** | ✅ MCP-CANARY-X4K9 | ✅ project-local |

## 핵심 결론

1. **규약·스킬·격리: 5개 CLI 전부 통과.** 모든 CLI가 자기 root를 무시하고 office 정의만 사용.
2. **MCP 실제 tool 주입+호출: claude / codex / opencode / devin 4개 가능.**
   - devin은 `devin mcp add`가 쓰는 것과 동일한 `<cwd>/.devin/config.local.json`(프로젝트-로컬,
     CLI root 아님)에 mcpServers를 merge-write. 어댑터가 자동화(unit test). 엔진경로 실호출 검증.
3. **antigravity만 MCP callable 주입 불가** — `agy`는 프로젝트-로컬 config가 없고 MCP는
   `~/.gemini`(CLI root)로만 가능. 격리 원칙상 주입 안 함. office MCP는 프롬프트로만 인지.

## 도중 발견·수정한 실제 버그

- **loadout MCP 블록이 `(call as mcp__<name>__<method>)`를 강제** — 이건 claude-code 전용
  네이밍. devin은 그 이름의 툴을 못 찾아 호출 실패(NO-MCP-ACCESS)했음. → 중립 문구로 수정
  (`run/compose.ts`). 이후 devin MCP 엔진경로 정상.
- **주의(검증 경험)**: 큰 프롬프트(긴 규약 + 무관한 스킬)는 일부 모델(devin swe)의 주의를
  분산시켜 MCP 호출을 건너뛰게 함. 최소 프롬프트에선 정상. → 향후 loadout 블록 간결화 고려.

## 검증 도구 (재현용)

- `scripts/capture-cli.mjs` — 가짜 CLI, 받은 invocation 덤프
- `scripts/canary-mcp.mjs` — 최소 MCP stdio 서버, 카나리 토큰 반환

재현: office에 카나리 skill + canary mcp + 5개 probe 에이전트(command=capture) 생성 →
run → `data/logs/<id>.log` 분석.
