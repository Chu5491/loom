# CLI 도구별 능력 매트릭스 & 활용 분석

6개 CLI 어댑터(**claude-code / codex / opencode / devin / factory(droid) / antigravity**)의
사용법·출력·활동 캡처를 **3중 대조**(공식 문서 + 로컬 `--help` 실측 + 어댑터 코드)로 정리한다.
목적: **에이전트 활동 내역(비용·도구·파일·토큰·세션·reasoning)의 완성도**를 어디까지
끌어올릴 수 있는지, 무엇이 진짜 CLI 한계이고 무엇이 "loom 미구현"인지 명확히 가른다.

> **측정:** 2026-06-19 · claude 2.1.181 · codex 0.141.0 · opencode 1.3.15 · devin 2026.5.x ·
> droid 0.150.1 · agy 1.0.9 (전부 로컬 실측). 구현 로드맵은 [ADAPTER-INTEGRATION-PLAN.md](./ADAPTER-INTEGRATION-PLAN.md).
>
> 공식 문서: codex `developers.openai.com/codex/cli/reference` · claude `code.claude.com/docs` ·
> opencode `opencode.ai/docs` · devin `docs.devin.ai/cli/reference/commands` ·
> factory `docs.factory.ai/cli` · antigravity `antigravity.google/docs/cli-using`

> ⚠️ **2026-06-19 정정** — 이전 판(5 CLI, 2026-06-17)에는 코드 미확인으로 인한 오류가 있었다:
> ① factory 누락(6번째 CLI). ② factory MCP·풍부스트림을 "구조적 불가"로 적었으나 **둘 다 가능**
> (공식 `stream-json` 단방향 출력 + 프로젝트-로컬 `.factory/mcp.json`). ③ antigravity 는 "비용만 공백"이
> 아니라 **비-TTY stdout 드롭 버그(upstream #76)로 답변 텍스트조차 현재 미캡처**. 아래는 실측 정정본.

---

## 완성도 매트릭스 (실측)

| CLI | 비실행 | 풍부 스트림 | 비용 | 토큰 | 도구 | 파일 | reasoning | 세션 resume | MCP 주입(경로) | 시스템프롬프트 |
|-----|--------|-------------|------|------|------|------|-----------|-------------|----------------|----------------|
| **claude-code** | `-p/--print` | `--output-format stream-json` ✅ | ✅ 실값 `total_cost_usd` | ✅ (+cache) | ✅ | ✅ | △ 가능* | ✅ `--resume` + **`--session-id`(caller-set, 결정적)** | ✅ `--mcp-config --strict-mcp-config`(per-run 파일) | ✅ `--append-system-prompt` |
| **codex** | `exec --json` | ✅ JSONL(`item.*`) | 🟡 추정(토큰×단가) | ✅ (+cache/reasoning) | ✅ | ✅** | △ 가능* | ✅ `exec resume` | ✅ `-c mcp_servers.*`(per-run, stdio+http; **SSE 불가**) | ❌ 합성 |
| **opencode** | `run --format json` | ✅ JSONL | ✅ 실값(무료=$0) | ✅ (+cache/reasoning) | ✅ | ✅ | ✅ `--thinking`* | ✅ `--session`/`--fork` | ✅ XDG 리다이렉트(per-run) | ❌ 합성 |
| **devin** | `-p/--print` | ❌ 평문 / **`acp` 가능*** | 🟡 추정 → **실값 가능(ATIF ACU/credit)*** | ✅ `--export` | ✅ `--export` | ✅ git 복원 | ❌ | ✅ disk 캡처(`devin list`) | ✅ `<cwd>/.devin/config.local.json` 또는 `--config`(per-run) | ❌ 합성 |
| **factory(droid)** | `exec` | ✅ `-o stream-json`(실측 검증) | 🟡 추정(+cache할인) | ✅ completion.usage | ✅ tool_call | ✅ stream | ✅ | ✅ `--session-id`/`--fork` | **`.factory/mcp.json` 프로젝트-로컬** ✅(`mcp list`→[project]) | ✅ `--append-system-prompt` |
| **antigravity(agy)** | `--print` | ❌ 평문, **stdout 드롭 버그** | ❌ 불가 | ❌ 불가 | △ disk only* | ✅ git 복원 | ❌ | ✅ disk 캡처(mtime) | ❌ per-run 불가(`.antigravitycli` 무시·upstream #60) | ❌ 합성 |

`*` = **CLI는 지원하나 loom 미구현** (→ [구현 플랜](./ADAPTER-INTEGRATION-PLAN.md)). `**` = 파싱 버그로 현재 유실.

**집계(현재 loom 실현 기준):** 비용 실값 2/6 · 토큰 5/6 · 도구 5/6 · 파일 6/6(stream 4 + git복원 2) · reasoning 4/6(claude·codex·opencode·factory) · 세션 6/6 · MCP 5/6(factory 읽기 검증됨).
**집계(CLI가 허용하는 천장):** 비용 실값 3/6 · 토큰 6/6 · 도구 5/6 · reasoning 4/6 · MCP 5/6. → **gap의 대부분은 CLI 한계가 아니라 loom 미구현.**

진짜 CLI 한계(loom으로 못 채움): **antigravity의 비용·토큰·MCP·구조화출력**(Gemini CLI 구조), 그리고 **antigravity의 stdout 드롭**(PTY로 우회 시도 가능하나 미검증).

---

## CLI별 상세 (현재 사용 / 가용 / 공백)

### claude-code (`claude` 2.1.181) — 레퍼런스 어댑터
- **출력 enum:** `--output-format text|json|stream-json` · `--permission-mode default|acceptEdits|plan|auto|dontAsk|bypassPermissions`(6종).
- **세션:** `--session-id <uuid>`는 **caller-settable & 결정적** — 전달한 UUID가 init·result 이벤트에 그대로 echo되고, 트랜스크립트는 `~/.claude/projects/<cwd-slug>/<session_id>.jsonl`에 저장된다. ⇒ loom이 ID를 미리 발급하면 **spawn 전에 정리 경로를 안다**(현재는 스트림에서 사후 읽기 → 크래시 시 유실).
- **현재 사용:** stdin, stream-json, `--setting-sources project,local`(헌법3 격리), `--mcp-config --strict-mcp-config`, `--append-system-prompt`, `--resume`(읽기), `--max-budget-usd`(유일한 런-중 하드캡), `--effort`.
- **가용·미사용:** `--session-id`(결정적 정리), `--agents <json>`(네이티브 서브에이전트), `--bare`(hook/메모리/CLAUDE.md 차단 → 헌법2 강화), `--max-turns`, `--fallback-model`, usage의 `cache_creation/cache_read_input_tokens`(캐시 적중률 = 최대 비용 레버).

### codex (`codex` 0.141.0)
- **`--json` 이벤트:** `thread.started` / `turn.started|completed|failed` / `item.started|completed`(item.type = `agent_message`·`reasoning`·`command_execution`·`file_change`·`mcp_tool_call`·`web_search`·`plan`) / `error`. usage = `input_tokens`·`cached_input_tokens`·`output_tokens`·`reasoning_output_tokens`. **비용 USD는 어떤 모드에서도 미제공 → 추정 필수.**
- **MCP:** `-c mcp_servers.<id>.command/args/env/url/...`(per-run TOML 오버라이드, `~/.codex` 미오염). stdio + http(streamable). **SSE 미지원**(어댑터 폴백 주석 정확).
- **현재 사용:** `exec --json`, `--ignore-user-config --ignore-rules`(격리), `--sandbox`/bypass, `--model`, `-c mcp_servers.*`, `-c model_reasoning_effort`, `exec resume`, `--ephemeral`.
- **가용·미사용:** **`--oss --local-provider ollama|lmstudio`(무료 로컬모델, 가성비)**, `--output-schema <FILE>`(타입 보장 핸드오프), `codex review`(전용 리뷰 — 단 `--json` 없음), `--skip-git-repo-check`(비-git 디렉토리), `reasoning`/`plan` 아이템·cache 토큰.
- **⚠️ 정책:** `--ignore-user-config`가 `$CODEX_HOME/AGENTS.md`는 못 막는다(헌법2 잔존 누수 — 어댑터 주석에 명시). `-p/--profile`은 `$CODEX_HOME/<name>.config.toml` 파일을 요구 → **loom이 만들면 헌법3 위반**, `-c`가 올바른 주입 경로.

### opencode (`opencode` 1.3.15) — 가성비·다양성 챔피언
- **`--format json` 이벤트:** 모든 줄 `{type,timestamp,sessionID,part}`. type = `step_start`·`text`·`reasoning`(**`--thinking` 시에만**)·`tool_use`·`step_finish`. `step_finish.part`: **`cost`(실값)** + `tokens{total,input,output,reasoning,cache{read,write}}`.
- **모델:** `opencode models`는 **인증된 프로바이더만** 반환. 키 0개인 머신에서도 **무료모델 5종**(`opencode/deepseek-v4-flash-free`·`nemotron-3-ultra-free`·`mimo-v2.5-free`·`north-mini-code-free`·`big-pickle`) 즉시 사용. BYO 키로 무한 확장.
- **현재 사용:** `run --format json`, MCP(config 병합 + XDG 리다이렉트, 사용자 config 보존), `--session`/`--variant`/`--model`/`--agent`, ephemeral 격리(XDG_DATA 재배치 + 크레덴셜 심링크), 실비용 보고.
- **가용·미사용:** `--thinking`(reasoning 캡처), `tokens.reasoning`·`tokens.cache`(현재 input/output만), `--fork`, `-f/--file`, 무료모델 UI 노출(`manifest options:[]`), `opencode export`(세션 JSON).
- **버그:** `probe.ts`가 바이너리만 있으면 "인증됨" 오판(무인증 시 `Provider not found`로 실패). `OPENCODE_DISABLE_PROJECT_CONFIG`(어댑터 사용)는 **비문서화** → `OPENCODE_CONFIG`로 대체 권장.

### devin (`devin` 2026.5.x)
- **출력:** `-p/--print`는 **평문, JSON 모드 없음**. 구조화는 `--export`(ATIF, 사후) 또는 **`acp`(Agent Client Protocol, JSON-RPC over stdio, 실시간)**.
- **ATIF 비용(신규):** changelog 2026.5.26-0부터 ATIF에 `committed_acu_cost`·`committed_credit_cost`·`generation_model` 포함 → **추정 대신 실측 ACU/credit 보고 가능**(어댑터 "비용필드 없음" 주석은 stale).
- **설정/MCP:** `--config <PATH>`(`~/.config/devin/config.json` 오버라이드). 프로젝트/로컬 config는 `permissions`·`mcpServers`·`read_config_from`·`hooks`만 설정 가능(`model`·`sandbox`는 user-only). `read_config_from` = `cursor,windsurf,claude,opencode,vscode,zed` **6키 전부 기본 true**.
- **현재 사용:** `--print`(arg), `--model`, `--permission-mode dangerous`, `--export`(토큰·도구 복원), `--resume` + `devin list` 세션 복구, MCP via `.devin/config.local.json`.
- **가용·미사용:** **`acp` 실시간 스트리밍**(devin의 plain-text+사후복원 스택 전체 대체 가능), ATIF 실비용, `--config`(repo 오염 없는 깔끔한 MCP).
- **버그:** `read_config_from`를 3키(`cursor,windsurf,claude`)만 false 처리 → **`opencode,vscode,zed` 자동 import가 켜진 채**(헌법2 누수). 세션 cleanup이 파일만 지우고 sqlite row 잔존 가능.

### factory (`droid` 0.150.1) — 모델 다양성 1위 (30+ + `custom:`)
- **출력 enum:** `-o text|json|stream-json|stream-jsonrpc` (`debug`=stream-json 별칭). **`stream-json`은 단방향 JSONL 실시간 스트림** — claude/codex/opencode와 같은 fire-and-parse 모델로 곧장 파싱 가능(양방향 RPC 불필요). 현재 어댑터는 가장 단순한 `json`(최종 1객체)만 사용.
- **MCP:** 3단계 계층 `~/.factory/mcp.json`(user) > `.factory/mcp.json`(folder) > `.factory/mcp.json`(project). **스키마는 claude `.mcp.json`과 동일**. ⇒ **프로젝트-로컬 `<cwd>/.factory/mcp.json`로 헌법3 준수 주입 가능**(devin 패턴). `droid mcp add`는 전역에 써서 부적합.
- **stream-jsonrpc 프로토콜:** `droid.initialize_session`→`droid.add_user_message`, 알림 `droid.session_notification`(create_message·tool_result·complete), 권한 역요청 `droid.request_permission`엔 `{selectedOption:"proceed_once"}`로 자동승인. loom은 권한을 자동승인하므로 최소 클라이언트로 구동 가능.
- **현재 사용:** `exec --output-format json`, `--auto`/skip-perms, `--model`, `--append-system-prompt`, `--session-id`/resume.
- **구현 완료(end-to-end 검증):** MCP 주입 ✅(`.factory/mcp.json` → **exec 시 서버 로드·도구 노출 실측**: init.tools 에 `everything___echo` 등 등장, 도구명 `<server>___<tool>`), 프리셋 ✅31종+`custom:`, **stream-json 풍부 활동 ✅**(text·reasoning·tool·file·completion 전체 스키마 실측). **남음(소소):** `--mission`(자체 멀티에이전트), `--enabled/disabled-tools`.
- **확인 필요(라이브 인증 run):** `stream-json` 줄별 스키마, `json` 결과의 `usage` 유무, `--settings`가 `mcpServers` 수용 여부.

### antigravity (`agy` 1.0.9) — 구조적 최약 (정정·강화)
- **출력:** `--print` 평문만. `--output-format json` → `flags provided but not defined`, **exit 2**(JSON 모드 없음 확정).
- **🔴 stdout 드롭 버그(upstream #76, 재현됨):** stdout이 TTY가 아니면(파이프/리다이렉트) `agy -p`가 **0바이트** 출력(왕복은 정상, exit 0). loom은 `stdio:["pipe","pipe","pipe"]`로 spawn → **현재 agy 답변 텍스트조차 미캡처**, git-diff 파일 백필 + 디스크 세션복구만 동작. PTY spawn으로 우회 시도 가능하나 `script` 의사TTY로도 안 됐음 → 검증 필요(불가 시 정직하게 UI 명시).
- **MCP(정밀 재검증 2026-06-19):** 프로젝트-로컬 `<workdir>/.antigravitycli/mcp_config.json` 경로는 **존재하나** 그 `mcpServers` 가 **upstream 버그로 조용히 무시**됨([issue #60](https://github.com/google-antigravity/antigravity-cli/issues/60)) — 실제 로드는 전역 `~/.gemini/config/mcp_config.json`만. 즉 "경로가 없다"가 아니라 "작동하는 경로가 전역뿐"이라 per-run 주입 불가 → `supportsMcpServers:false` 유지(정확). #60 수정 시 `.antigravitycli`(remote 필드는 `url`→`serverUrl`)로 재검토 가능.
- **세션·활동:** 대화는 `~/.gemini/antigravity-cli/conversations/<id>.db`(sqlite+protobuf). 프롬프트·모델라벨·도구는 `strings`로 복구 가능하나 **토큰·비용은 .proto 없이 복구 불가**. `ANTIGRAVITY_CONVERSATION_ID` env는 무시됨 → **caller-set id 불가**, mtime 스캔이 유일.
- **모델:** `agy models`는 ID 없이 표시라벨만(`Gemini 3.1 Pro (High)` 등) → 라벨→프리셋ID 정규화.

---

## 결론

- **활동 캡처의 천장은 높다 — 대부분 loom 미구현이지 CLI 한계가 아니다.** factory(stream-json+MCP)·devin(acp+실비용)·codex(로컬모델+output-schema)·opencode(reasoning+무료모델)·claude(결정적 세션)에 분명한 구현 여지가 있다.
- **공통 누락:** reasoning(6/6 미파싱), codex 파일이벤트(파싱 버그), 실비용(devin ATIF 미활용).
- **진짜 한계:** antigravity의 비용·토큰·MCP·구조화출력(+stdout 드롭) — Gemini CLI 구조. UI/문서에 "이 CLI는 비용·토큰 미보고, 헤드리스 제약" 명시가 정직한 처리.
- 실행 로드맵 → [ADAPTER-INTEGRATION-PLAN.md](./ADAPTER-INTEGRATION-PLAN.md).
