# CLI 도구별 능력 매트릭스 & 활용 분석

5개 CLI 어댑터(claude-code / codex / opencode / antigravity / devin)의 사용법·출력·
활동 캡처를 실측(2026-06-17, 전 CLI 인증 상태)으로 정리한다. 목적: **에이전트 활동
내역(비용·도구·파일·토큰·세션)의 완성도**를 어디까지 끌어올릴 수 있는지, 무엇이 CLI
한계인지 명확히 하고, 아직 안 쓰는 유용한 기능을 식별한다.

> 참조 문서: codex `developers.openai.com/codex/cli/reference` · claude
> `code.claude.com/docs` · opencode `opencode.ai/docs` · antigravity
> `antigravity.google/docs/cli-using` · devin `docs.devin.ai/.../devin-cli`

---

## 완성도 매트릭스

| CLI | 비실행 모드 | 출력 | 비용 | 토큰 | 도구 | 파일 | 세션 resume | MCP 주입 |
|-----|------------|------|------|------|------|------|------------|----------|
| **claude-code** | `-p`/`--print` | stream-json | ✅ 실값(`total_cost_usd`) | ✅ | ✅ stream(`tool_use`) | ✅ stream | ✅ `--session-id`(caller-set UUID) | ✅ `--mcp-config --strict-mcp-config` |
| **codex** | `exec` | stream-json | 🟡 추정(토큰×단가) | ✅ | ✅ stream(`item.completed`) | ✅ stream | ✅ `resume` | ✅ `-c mcp_servers.*` |
| **opencode** | `run` | stream-json | ✅ 실값(무료모델=$0) | ✅ | ✅ stream(`tool_use`) | ✅ stream | ✅ `--session` | ✅ XDG_CONFIG_HOME |
| **antigravity** | `--print` | 거의 평문 | ❌ **불가**(CLI 미노출) | ❌ | ✅ stream(`tool_use`) | ✅ stream | ✅ 디스크 캡처 | ❌ **불가**(CLI 구조 한계) |
| **devin** | `-p`/`--print` | 평문 | 🟡 추정(`--export` 토큰) | ✅ `--export` | ✅ **`--export`**(tool_calls) | ✅ git 복원 | ✅ 디스크 캡처(`devin list`) | ✅ `<cwd>/.devin/config.local.json` |

**집계:** 비용 4/5 · 토큰 4/5 · 도구 **5/5** · 파일 **5/5** · 세션 5/5 · MCP 4/5.
유일한 실질 공백 = **antigravity 비용/토큰**(Gemini CLI 가 어떤 모드에서도 미노출)과
**antigravity MCP**(CLI 구조상 run별 주입 불가). 둘 다 CLI 한계 — loom 으론 해결 불가.

---

## CLI별 상세

### claude-code (`claude`, 2.1.170)
- **실행:** `claude -p --output-format stream-json` · 프롬프트 stdin · 모델 `--model`.
- **활동:** `{type:"result", total_cost_usd, session_id}` 최종 + `{type:"assistant",
  message.content[text|tool_use]}` 로 텍스트·도구·파일을 실시간으로. 가장 완전.
- **세션:** caller-set UUID(`--session-id <uuid>`) — 5 CLI 중 유일하게 우리가 ID 를 정함.
- **아직 안 쓰는 유용 기능(검토 가치):**
  - `--max-budget-usd <amount>` — **run 단위 하드 예산 상한**. 지금은 사후 집계만 →
    CLI 레벨에서 미리 막을 수 있다. office/budget.json 과 연동 후보.
  - `--json-schema <schema>` — 구조화 출력 검증. loom-report 추출을 펜스 파싱 대신
    스키마 강제로 더 견고하게.
  - `--effort <low|medium|high|xhigh|max>` — reasoning 다이얼(이미 `reasoning` 매핑).
  - `--agents <json>` — 인라인 서브에이전트 정의(위임 대안).
  - `--include-partial-messages` — 토큰 단위 스트리밍(현재 라인 단위로 충분).

### codex (`codex`, 0.139.0)
- **실행:** `codex exec --json` · 프롬프트 stdin · 모델 `-m`.
- **활동:** `turn.completed{usage}` 로 토큰(비용은 **미제공** → 엔진이 단가표로 추정),
  `item.completed{command_execution|file edit}` 로 도구(shell)·파일. Apache-2.0, 래핑
  공식 지원.
- **아직 안 쓰는 유용 기능:**
  - `codex review` — **전용 코드리뷰 비실행 모드**. Reviewer 에이전트를 이걸로 특화 가능.
  - `codex apply` — 마지막 diff 를 `git apply`. 휴먼 게이트 후 적용 패턴.
  - `--search` — 네이티브 웹 검색 도구.
  - `-s/--sandbox <read-only|workspace-write|danger-full-access>` — OS 샌드박스 등급.

### opencode (`opencode`, 1.17.3)
- **실행:** `opencode run` · 프롬프트 trailing arg · 모델 `-m provider/model` · MCP 는
  XDG_CONFIG_HOME 리다이렉트.
- **활동:** `step_finish{part:{cost, tokens}}` 로 **실비용**(유료 모델 실값, 무료 모델은
  $0 — 현재 Tester 의 big-pickle 이 무료라 $0), `tool_use` 로 도구·파일. BYOK(MIT).
- **아직 안 쓰는 유용 기능:**
  - `opencode stats` — 토큰·비용 통계(스트림에 이미 있어 불필요하나 교차검증용).
  - `opencode export [sessionID]` / `import` — 세션 JSON 내보내기/가져오기.
  - `opencode serve` / `attach` — 헤드리스 서버 + attach(장기 세션 풀링 후보).

### antigravity (`agy`, 1.0.8)
- **실행:** `agy --print` · 프롬프트 arg · 모델 `--model` · 권한 `--dangerously-skip-permissions`.
- **활동:** `tool_use{tool_name, parameters}` 로 도구·파일은 잡힌다. **비용·토큰은 어떤
  플래그·서브커맨드로도 미노출**(`agy --help`: changelog/install/models/plugin/update 뿐 —
  stats·export·usage 전무). Gemini CLI 의 구조적 한계.
- **MCP:** run별 주입 불가(CLI 가 `~/.gemini/settings.json` 만 봄). UI 에 명시.
- **정책 주의:** [[cli-policy-findings]] — Gemini 직접 호출 금지 이슈로 antigravity 전환.

### devin (`devin`, 2026.5.26-8)
- **실행:** `devin -p` · 프롬프트 arg · 모델 `--model` · 권한 `--permission-mode auto|dangerous`.
- **출력은 평문** — stdout 엔 활동 메타데이터가 0. 대신 **`--export <path>`** 가 턴마다
  ATIF(v1.4) 대화 파일을 떨군다:
  - `steps[].metadata.metrics.{input,output,cache_read}_tokens` → 토큰 → 비용 추정.
  - `steps[].tool_calls[].{function_name, arguments}` → 도구(find_file_by_name, read, …).
  - loom 은 `<cwd>/.loom-devin-export.json` 에 써서 종료 후 `captureActivityFromDisk` 로
    읽고 **파일을 지운다**(정리). 파일 변경은 git 작업트리 복원으로 별도 귀속.
  - **주의:** devin 은 ACU(compute unit) 과금 → 토큰×단가 USD 는 codex 처럼 *근사치*.
- **아직 안 쓰는 유용 기능:**
  - `--agent-config <file>` — **선언적 에이전트 설정**(시스템 지시·도구 가시성·권한).
    office 에이전트 → devin agent-config 매핑으로 페르소나/도구 제어 강화 후보.
  - `rules` / `skills` 서브커맨드 — devin 네이티브 규약·스킬.
  - `--sandbox` — OS 레벨(seatbelt/bwrap) 권한 강제.

---

## 결론: 무엇이 가능하고 무엇이 한계인가

- **활동 캡처는 사실상 완성:** 도구·파일·세션은 **5/5**, 비용·토큰은 **4/5**. 평문 CLI
  (devin)도 export+git 로 stream-json CLI 와 동등 수준까지 끌어올렸다.
- **남은 공백 = antigravity 의 비용/토큰 + MCP** — 둘 다 Gemini CLI 가 정보를 주지
  않거나 구조가 막혀 loom 코드로는 못 채운다. UI 에 "이 CLI 는 비용 미보고" 명시가
  정직한 처리.
- **다음 단계 후보(가치순):** claude `--max-budget-usd`(예산 하드캡) · claude
  `--json-schema`(loom-report 견고화) · codex `review`(리뷰 특화) · devin `--agent-config`.
