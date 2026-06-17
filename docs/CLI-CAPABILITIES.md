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
### 구현된 고도화(2026-06-17)
- **antigravity `--print-timeout 30m`** — agy print 모드 5분 자체 종료로 긴 답변이
  잘리던 버그 수정.
- **codex 비-bypass `--sandbox workspace-write`** — 기본 read-only 로 편집이 막혀
  코딩이 조용히 실패하던 것 해소(exec 는 비실행이라 승인 안 물음).
- **parse.ts 확장** — claude MultiEdit/NotebookEdit→파일, codex mcp_tool_call/
  web_search→도구.
- **claude `--max-budget-usd`** — 남은 월 예산(전체·perAgent 중 빡빡한 쪽)을 run
  하드캡으로 → 시작 전 차단만으론 못 막던 "run 도중 초과"를 CLI 레벨 차단.

### 구현된 고도화 (2차, 2026-06-17)
- **위임 단일화** — specialist(Planner·Reviewer·Frontend·backend)의 `delegate` 제거,
  **마스터만 위임**. 작업 트리가 얕은 별 구조로 단순화(추적·시각화·비용 안정).
- **④ claude `--setting-sources project,local`** — 사용자 전역 `~/.claude` 개인설정을
  배제하고 loom 명시 spec 만(헌법2 정합 + 캐시↑). 라이브 검증 통과($0.056).
- **⑤ codex `--ephemeral`** — 스레드(resume) 아닌 run(기능·워크플로우)은 세션 미보존.
- **②는 이미 구현돼 있었음** — antigravity `--add-dir loadoutDir` 가 이미 스킬 로드아웃을
  노출 중(어댑터 `applyMcpServers`). 추가 작업 불필요(검증).

### 남은 후보(가치순)
- **③ devin `--agent-config`** — 스키마 검증 완료(strict 파서): `system_instructions`,
  `allowed_tools`, `permissions`, `mcp_servers`, `extensions`. 핵심 가치는
  `system_instructions`(페르소나를 시스템 레벨로)인데, 제대로 하려면 **시스템/유저
  프롬프트 분리 리팩터**(compose.ts + 어댑터 계약) 필요 — 깔끔한 후속으로 분리.
- codex `--output-schema` / claude `--json-schema` — 출력 스키마 강제(산문+리포트 충돌).
- codex `review`/`apply` · opencode `serve`/`attach`(세션 풀링).

---

# 부록: CLI별 전체 기능 카탈로그 (help + 문서 전수)

각 CLI 의 `--help` + 공식 문서를 빠짐없이 훑어, 헤드리스 래핑 관점에서 **loom 이 쓰는
것 / 안 쓰는 것 / 활용 기회**를 정리한다. (✅=현재 사용, ◯=활용 후보, —=무관/불가)

## claude-code (`claude`)
loom 호출: `claude --print - --output-format stream-json --verbose [--model] [--effort]
[--add-dir…] [--permission-mode] [--max-budget-usd] [--mcp-config --strict-mcp-config]
[--allowedTools mcp__loom__delegate] [--session-id <uuid>] [--resume <id>]`

| 플래그/명령 | 기능 | loom |
|---|---|---|
| `-p/--print` | 비실행 1회 출력 | ✅ |
| `--output-format text\|json\|stream-json` | 출력 포맷 | ✅ stream-json |
| `--input-format stream-json` | 실시간 입력 스트림(턴 중 입력) | — 헤드리스 1턴 |
| `--include-partial-messages` | 토큰 단위 델타 | ◯ 더 매끄러운 라이브(현 라인단위로 충분) |
| `--json-schema <schema>` | 최종 출력 JSON 스키마 검증 | ◯ 단 산문+리포트와 충돌 |
| `--max-budget-usd <amt>` | run 비용 하드캡 | ✅(남은 월예산 전달) |
| `--model` / `--fallback-model <list>` | 모델 / **과부하 시 자동 폴백** | ✅ / ◯◯ **resilience**(과부하 대응) |
| `--effort low…max` | 추론 강도 | ✅ |
| `--permission-mode default\|acceptEdits\|bypassPermissions\|plan\|dontAsk` | 권한 모드 | ✅(accept/bypass) |
| `--allowedTools` / `--disallowedTools` / `--tools` | 도구 허용/차단/제한 | ✅ allowed(delegate) · ◯ disallowed(안전), tools(최소화) |
| `--add-dir <dirs>` | 도구 접근 허용 디렉토리 | ✅ loadout |
| `--mcp-config` / `--strict-mcp-config` | MCP 주입 | ✅ |
| `--session-id <uuid>` / `-r/--resume` / `-c/--continue` / `--fork-session` | 세션 | ✅ caller UUID + resume |
| `--no-session-persistence` | 세션 디스크 저장 안 함 | ◯ 일회성 run |
| `--system-prompt` / `--append-system-prompt` | 시스템 프롬프트 교체/추가 | ◯ 현재 user 입력에 합성 → append 가 캐시 친화적 |
| `--agents <json>` | 인라인 서브에이전트 정의 | ◯ 위임 대안 |
| `--setting-sources user,project,local` / `--settings` | 설정 출처 제한 | ◯◯ **CLI root 격리**(헌법3: user 설정 배제) |
| `--bare` / `--safe-mode` | 최소 모드(hook·자동메모리·CLAUDE.md 끔) | ◯ 재현성·캐시 |
| `--betas` / `--file` / `--replay-user-messages` / `--include-hook-events` | 베타·파일첨부·에코·hook | — |
| `agents·auth·mcp·plugin·project·ultrareview·doctor` (명령) | 관리/리뷰 | — (ultrareview=클라우드 리뷰) |

## codex (`codex`)
loom 호출: `codex [--search] exec --json [--dangerously-bypass… | --sandbox workspace-write]
[--model] [-c model_reasoning_effort=…] [-c mcp_servers.*] [--cd] -`

| 플래그/명령 | 기능 | loom |
|---|---|---|
| `exec` (alias `e`) | 비실행 실행 | ✅ |
| `--json` | JSONL 이벤트 | ✅ |
| `--output-last-message <file>` | 최종 답변만 파일로 | ◯ 깔끔한 결과 추출 |
| `--output-schema <file>` | 최종 응답 JSON 스키마 | ◯ 구조화(산문 충돌 주의) |
| `--sandbox read-only\|workspace-write\|danger-full-access` | 샌드박스 | ✅(비-bypass=workspace-write) |
| `--ask-for-approval untrusted\|on-request\|never` | 승인(root 전용) | — exec 는 비실행이라 불요 |
| `--dangerously-bypass-approvals-and-sandbox`(`--yolo`) | 전부 우회 | ✅(bypass) |
| `--ephemeral` | 세션 파일 미보존 | ◯ 일회성 |
| `--model -m` / `-c model_reasoning_effort` | 모델/추론 | ✅ |
| `-c key=val` | TOML 오버라이드 | ✅ MCP·reasoning |
| `--cd -C` / `--add-dir` | 작업/추가 디렉토리 | ✅ cd · ◯ add-dir(loadout) |
| `--search` | 웹 검색 | ◯(config 노출) |
| `-i/--image` | 이미지 첨부 | ◯ 비전 |
| `exec resume [id] --last` / `fork` / `archive` | 세션 | ✅ resume |
| `review` / `apply` | 코드리뷰 / diff 적용 | ◯◯ Reviewer 특화·게이트 적용 |
| `cloud exec/list` | 클라우드 태스크 | — |
| `mcp` / `mcp-server` / `app-server` / `doctor` / `features` | 관리 | — |

## opencode (`opencode`)
loom 호출: `opencode run --format json [--continue] [--session <id>] [--model provider/model]
[--agent <name>]` + MCP 는 XDG_CONFIG_HOME 리다이렉트

| 플래그/명령 | 기능 | loom |
|---|---|---|
| `run [message]` | 비실행 실행 | ✅ |
| `--format json` | JSON 이벤트(cost·tokens·tool 포함) | ✅ |
| `--model -m provider/model` / `--agent` | 모델/에이전트 | ✅ |
| `--session -s` / `-c/--continue` / `--fork` | 세션 | ✅ session·continue · ◯ fork |
| `--prompt` | 프롬프트(현재 trailing arg) | ✅(arg) |
| `--pure` | 외부 플러그인 없이 | ◯ 재현성·격리 |
| `--print-logs` / `--log-level` | 로그 | ◯ 디버깅 |
| `stats` | 토큰·비용 통계 | — 스트림에 이미 있음 |
| `export [id]` / `import` | 세션 JSON | ◯ |
| `models` | 모델 목록 | ✅(listModels) |
| `serve` / `attach` / `web` | 헤드리스 서버/접속 | ◯◯ 세션 풀링(장기) |
| `agent` / `session` / `plugin` / `mcp` / `github` / `pr` | 관리 | — |

## antigravity (`agy`)
loom 호출: `agy [--model] --print-timeout 30m [--dangerously-skip-permissions]
[--sandbox] --print "<prompt>"`

| 플래그/명령 | 기능 | loom |
|---|---|---|
| `-p/--print` / `--prompt` | 비실행 1회 | ✅ |
| `--print-timeout <dur>` | print 대기 상한(기본 5m) | ✅ 30m(잘림 방지) |
| `--model` | 모델 | ✅ |
| `--dangerously-skip-permissions` / `--sandbox` | 권한/샌드박스 | ✅ |
| `--add-dir <dir>` | 워크스페이스에 디렉토리 추가 | ✅ **loadout(스킬) 노출** — MCP 불가의 우회(이미 적용) |
| `-c/--continue` / `--conversation <id>` | 세션 이어가기/ID 재개 | ◯◯ 디스크 캡처 대신 ID resume 검토 |
| `-i/--prompt-interactive` / `--log-file` | 대화형/로그 | — / ◯ |
| `models` / `plugin` / `install` / `update` | 관리 | ✅ models |
| (비용·토큰·usage) | **미노출** | — CLI 한계(불가) |

## devin (`devin`)
loom 호출: `devin [--model] --export .loom-devin-export.json [--permission-mode]
-p "<prompt>" [--resume <id>]` + MCP 는 `<cwd>/.devin/config.local.json`

| 플래그/명령 | 기능 | loom |
|---|---|---|
| `-p/--print` | 비실행 1회(평문) | ✅ |
| `--export [path]` | 턴마다 ATIF 대화 파일(토큰·도구·메트릭) | ✅ 비용·도구 복원 |
| `--prompt-file <file>` | 프롬프트를 파일로 | ◯ arg 인용 회피 |
| `--model` | 모델 | ✅ |
| `--permission-mode auto\|dangerous` | 권한 | ✅ |
| `--sandbox` | OS 샌드박스(seatbelt/bwrap) | ◯ |
| `-c/--continue` / `-r/--resume [id]` | 세션 | ✅ resume(+`list` 캡처) |
| `--agent-config <file>` | **선언적 에이전트**(시스템지시·도구가시성·권한) | ◯◯ office 에이전트→devin 매핑 |
| `--respect-workspace-trust` | 워크스페이스 신뢰 | ◯(비실행 기본 false) |
| `rules` / `skills` | devin 네이티브 규약·스킬 | ◯ |
| `mcp` / `cloud` / `list` / `acp` / `shell` | 관리 | ✅ list(세션) · mcp(설정파일) |
| (cost) | stdout 미노출 → export 토큰 추정 | ✅ |

---

## 새로 발굴한 활용 기회 (가치순)

1. **claude `--fallback-model`** — 과부하/불가 시 자동으로 대체 모델 재시도(`--print` 전용).
   이번에 devin "high demand" 일시오류를 겪었는데, claude 는 CLI 차원 폴백이 있다 →
   에이전트에 fallback 모델 지정 옵션. **resilience 향상, 저위험.**
2. ~~**antigravity `--add-dir`**~~ — **이미 적용돼 있음**(어댑터 `applyMcpServers` 가
   `--add-dir loadoutDir` 로 스킬 로드아웃을 노출). 검증 완료, 추가 작업 불필요.
3. **devin `--agent-config`** — 시스템 지시·도구 가시성·권한을 run별 선언으로. office
   에이전트(prompt/permission/skills)를 devin 네이티브 설정으로 더 충실히 매핑.
4. **claude `--setting-sources` / `--bare`** — 사용자 `~/.claude` 설정을 배제하고 run 을
   격리(헌법3 CLI root 불가침과 정합) + 프롬프트 캐시 재사용 향상.
5. **codex `--output-last-message` / `--ephemeral`** — 깔끔한 최종 답변 추출 + 세션 미보존.
6. **antigravity `--conversation <id>` / opencode `--fork`** — 세션 재개·분기 정교화.
7. **codex `review`·`apply`** — Reviewer 전용 모드 + 휴먼 게이트 후 diff 적용.
