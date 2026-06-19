# 어댑터 깊은 통합 — 구현 로드맵

6개 CLI(claude-code / codex / opencode / devin / factory / antigravity) 어댑터를
"제공 기능 vs loom 필요 기능" 갭 기준으로 끌어올리는 실행 계획. 근거는
[CLI-CAPABILITIES.md](./CLI-CAPABILITIES.md)(공식문서+실측+코드 3중 대조).

**난이도:** 🟢 작음(순수·단위테스트 가능) · 🟡 중간 · 🔴 큼(라이브 검증/프로토콜 필요)
**헌법 게이트:** 모든 항목은 (1)래핑만 (2)자동주입 금지 (3)CLI-root 불가침 (4)git정의/로컬기록 (5)raw진실 을 통과해야 한다.
**원칙:** 라이브 인증 run이 필요한 항목(🔴 다수)은 "확인 필요"로 분리 — 순수 변경(🟢)부터 머지하고 위험 항목은 검증 후.

---

## §0. 공통 인프라 (먼저 — 여러 CLI가 의존)

| ID | 작업 | 파일 | 난이도 | 헌법 | 효과 |
|----|------|------|--------|------|------|
| **S1** ✅완료 | OfficeEvent `reasoning` kind + parse(opencode `--thinking`·codex reasoning item·claude thinking 블록) + Talk 접이식 표시 | `office.ts`·`parse.ts`·`TalkPage`·i18n | 🟡 | ✅ 5(뷰) | dafacce·dc41ddb·c4e9232. 라이브 표시는 reasoning 내는 run 필요 |
| **S2** ✅완료(39cff4c) | **codex `file_change` 파싱 버그 수정** — `parse.ts:116`이 `item.path`(없음) 검사 → `item.changes:[{path,kind}]` 순회로. `"patch"` 가짜 타입 제거. `turn.failed`/`error`→`{kind:"error"}` | `apps/server/src/run/parse.ts:110-127` | 🟢 | ✅ 5 | codex 파일이벤트 유실 복구 + 실패 표면화 |
| **S3** ✅완료(b5deeb3) | **caller-set 세션ID 훅** — `SpawnArgs.assignSessionId` + `applySessionId(args,id)` 훅(`applyResume` 대칭), 엔진이 UUID 발급해 fresh run에 전달(resume턴 제외) | `packages/core/src/adapter.ts`, `packages/adapter-utils/src/define.ts`, `apps/server/src/run/engine.ts` | 🟡 | ✅ 3(per-run flag) | 세션정리 결정화(현재 사후 스트림 읽기 의존). claude가 1차 수혜 |
| **S4** | **실비용 플러밍** — `captureActivityFromDisk`/이벤트가 `costUsd`+`costReported=true` 설정 시 엔진 추정 스킵 | `packages/core/src/adapter.ts`(capture 반환형), `apps/server/src/run/engine.ts:913` | 🟡 | ✅ 5 | devin ATIF 실비용 등 "~추정" 제거 |
| **S5** ✅완료(cbeb6d8) | usage.cachedInputTokens 캡처(codex·opencode·claude) + estimateCost 캐시분 10% 할인 | `office.ts`·`parse.ts`·`engine.ts`·`pricing.ts` | 🟢 | ✅ 5 | **codex 비용 과대평가 보정**. 토큰 표시 UI·devin ATIF cache 할인은 후속 |
| **S6** | (Tier3) adapter-utils에 **PTY spawn** 옵션(`needsPty`) — antigravity stdout 드롭 우회 | `packages/adapter-utils/src/spawn.ts`, `define.ts` | 🔴 | ✅ 1 | agy 답변 캡처(검증 필요) |
| **S7** | (Tier3) **구조화-스트림/ACP 공통 클라이언트** — devin `acp` + factory `stream-jsonrpc` 공유 | `packages/adapter-utils/`(신규) | 🔴 | ✅ 1 | 두 CLI 실시간 활동 |

---

## §1. claude-code

| Tier | 작업 | 파일 | 난이도 | 비고 |
|------|------|------|--------|------|
| **1** | caller-set `--session-id`로 결정적 세션 수명(§S3 적용; resume턴엔 미전달) | `claude-code/src/index.ts`(`applySessionId`) | 🟡 | `extractClaudeSessionId`는 resume 확인용으로 유지 |
| **1** | `permissionMode` enum 정정 `default\|acceptEdits\|plan\|auto\|dontAsk\|bypassPermissions`(현 3종) | `index.ts:24` | 🟢 | `dontAsk`=잠금형 CI 모드 |
| **1** | usage cache 토큰 캡처(§S5) | `parse.ts:67-70` | 🟢 | |
| **1** | trivia: `docsUrl` 호스트 `code.claude.com`, Opus 4.8 `[1m]` 프리셋 | `manifest.ts:22`, `preset-models.ts` | 🟢 | |
| **2** | ephemeral(기능/워크플로우) run에 `--bare`(또는 `--exclude-dynamic-system-prompt-sections`) opt-in | `index.ts`, `engine.ts:474` | 🟡 | 헌법2 강화·캐시↑. `--bare`는 env키 필요 → probe로 게이트 |
| **2** | `--max-turns` 런어웨이 가드 | `index.ts` | 🟡 | `--max-budget-usd`와 짝 |
| **3** | `--agents <json>` 네이티브 위임(현 MCP/`delegate.sh` 브리지와 택일) | 신규 훅+`engine.ts` 위임 | 🔴 | **권장: 브리지 유지**(CLI무관·거버넌스). claude→claude 한정 성능경로로만 검토 |
| **3** | `--include-partial-messages` 토큰 스트리밍 | `parse.ts` | 🔴 | raw 50MB 캡 압박 + 중복 dedup. 후순위 |

**확인 필요(라이브):** `--session-id`+`--resume` 동시 전달 시 에러 여부, `.jsonl` 결정적 경로 실제 생성, cache 토큰 실값.

---

## §2. codex

| Tier | 작업 | 파일 | 난이도 | 비고 |
|------|------|------|--------|------|
| **1** | **`--oss` + `--local-provider ollama\|lmstudio`** (무료 로컬모델) | `index.ts`(buildCommand), `manifest.ts` | 🟢 | 가성비 핵심. oss시 model 자유입력 |
| **1** | file_change 파싱 버그 수정(§S2) | `parse.ts:110-127` | 🟢 | |
| **2** | pricing — ⚠️정정: codex gpt-5.x 는 `gpt-5` 접두 부분매칭으로 **이미 커버됨**(`"gpt-5.5".includes("gpt-5")`, 검증). 실제 갭=비-OpenAI(factory/devin) 모델이 `DEFAULT{1,5}` + 로컬모델 0원 미반영 → `--oss` 도입 시 함께 | `pricing.ts:14-29`, `preset-models.ts` | 🟡 | 단독 가치 낮음(추정은 본래 근사) |
| **1** | `--skip-git-repo-check` | `index.ts`, manifest | 🟢 | 비-git 프로젝트 dir 대응 |
| **2** | `--output-schema <FILE>` 타입 보장 워크플로우 핸드오프(스키마는 loadout 디렉토리에 기록) | `index.ts`, `office.ts`(WorkflowNode), `run/workflow.ts`, `loadout.ts` | 🟡 | **헌법3**: `$CODEX_HOME` 아닌 `data/loadouts/`에 |
| **2** | `reasoning` 아이템 표면화(§S1) + cache/reasoning 토큰(§S5) | `parse.ts` | 🟡 | oss 프로바이더는 reasoning 미방출 — graceful |
| **2** | `codex review` 얇은 노드(원시 텍스트) | `index.ts`, 워크플로우 | 🟡 | **`review`는 `--json`·`--sandbox` 없음** → 구조화 리뷰 불가, 원시텍스트만 |
| **3** | 커스텀 `model_providers`(`-c`)로 OpenAI 호환 프록시/게이트웨이 | `index.ts` | 🟡 | `OPENAI_BASE_URL` env로 충분한지 먼저(rule-of-three) |

**확인 필요(라이브):** `--oss` 모델 ID들, `turn.failed`/`error` 실제 스키마, `-c` 배열/특수문자 라운드트립.
**불가/지양:** `-p/--profile`(파일이 `$CODEX_HOME` 요구 → 헌법3 위반; 사용자 보유 프로필 **패스스루**만 허용).

---

## §3. opencode

| Tier | 작업 | 파일 | 난이도 | 비고 |
|------|------|------|--------|------|
| **1** | `reasoning` 이벤트 파싱(§S1) | `parse.ts`, `office.ts` | 🟡 | `--thinking` 시 `type:"reasoning"` 방출 |
| **1** | `--thinking` config 필드 | `index.ts`, `manifest.ts` | 🟢 | reasoning 방출 전제. opt-in(비용↑) |
| **1** | `tokens.reasoning`/`tokens.cache` 캡처(§S5) | `parse.ts:104-107` | 🟡 | 캐시 절감 가시화 |
| **1** | **probe false-ready 수정** — `opencode models` ≥1개면 ready, 0/에러면 unauth+힌트 | `probe.ts:8-15` | 🟡 | 무료모델은 ready 유지 |
| **1** | **무료모델 프리셋 시드** — `manifest options:[]`에 5종 무료모델, `models.ts` FALLBACK도 무료로 | `manifest.ts:34`, `models.ts:4-9` | 🟢 | 제로컨피그 가성비. 라이브 목록이 오버라이드 |
| **2** | `--fork`, `-f/--file`(사용자 명시만), `--title` 필드 | `index.ts`, manifest | 🟢 | 파일 자동첨부 금지(헌법2) |
| **2** | `opencode export`로 세션 JSON 아카이브 | `index.ts`/엔진 종료 훅 | 🟡 | "raw 진실" 강화 |
| **2** | `OPENCODE_DISABLE_PROJECT_CONFIG`(비문서) → `OPENCODE_CONFIG`(문서) 검증·교체 | `index.ts:236` | 🟢 | 업그레이드 내성 |
| **3** | ~~`serve`/`attach` 영속서버~~ | — | 🔴 | **지양 권장**: per-run 격리·MCP 주입과 충돌. 결정 문서화 |
| **—** | ~~`opencode stats`~~ / ~~`acp`~~ | — | — | stats=TUI(loom 자체집계 우월), acp=에디터용(무관). 스킵 |

**확인 필요(라이브):** error가 JSON 이벤트인지 stderr인지(현 가정 미검증), `--variant` 중간값 프로바이더별 유효성.

---

## §4. devin

| Tier | 작업 | 파일 | 난이도 | 비고 |
|------|------|------|--------|------|
| **1** | **`read_config_from` 6키 전부 false** (현 3키 → `opencode,vscode,zed` 누수) | `index.ts:244`, 테스트 | 🟢 | 헌법2 누수 차단 |
| **1** | manifest permission-mode 문구 정정(`auto`→Devin 기본; 값 `normal\|dangerous\|bypass` vs 실측 `auto\|smart\|dangerous` 혼재) | `manifest.ts:50,80` | 🟢 | 어댑터는 `dangerous`만 방출(안전) |
| **2** | **ATIF 실비용 추출** — `committed_acu_cost`/`committed_credit_cost`/`generation_model`(§S4) | `index.ts:63`(`parseDevinActivity`), `define.ts` 반환형, `engine.ts:666` | 🟡 | 어댑터 "비용필드 없음" 주석 stale. **빌드에 필드 존재 먼저 확인** |
| **2** | MCP 주입을 `--config <PATH>`(loadout 디렉토리)로 — repo의 `.devin/` 오염 제거 | `index.ts`(`syncDevinMcpConfig`), manifest 경고 제거 | 🟡 | **확인 필요: `--config`가 교체냐 레이어냐**(교체면 사용자 MCP 재병합) |
| **2** | 세션 완전정리(db row + 파일) | `index.ts:198`(`sessionFiles`) | 🟡 | `devin` 네이티브 삭제 우선, 없으면 가드된 sqlite row 삭제 |
| **3** | **`acp` 모드** — 실시간 구조화 활동(plain-text+사후 ATIF 스택 전체 대체) | `devin/src`(ACP 클라이언트, §S7), `engine.ts` 캡처 제거 | 🔴 | JSON-RPC 클라이언트(initialize→session/new→session/prompt, session/update 파싱). config 플래그 뒤 프로토타입 |
| **—** | ~~`--agent-config`/AGENT.md 페르소나~~ | — | — | 헌법2 경계(자동 import) + 이미 compose로 주입 → **스킵** |

**확인 필요(라이브):** ATIF 비용필드 존재(`devin -p "hi" --export /tmp/x.json` grep), `--config` 의미(교체/레이어), `acp` `session/update`가 토큰·비용 운반 여부, 세션 저장이 db인지 파일인지.

---

## §5. factory (droid)

| Tier | 작업 | 파일 | 난이도 | 비고 |
|------|------|------|--------|------|
| ✅ | 프리셋 18→**31종** + `custom:` (완료) | `preset-models.ts` | 🟢 | 모델 다양성 1위 |
| ✅ | MCP 주입 — 프로젝트-로컬 `<cwd>/.factory/mcp.json`(devin 패턴, `toDroidMcpEntry`). 어댑터는 server import 불가 → claude 인코더 대신 동일스키마 자체 인코더. 빈 파일 skip(오염↓), stale loom 엔트리 제거 | `factory/src/index.ts`(`syncFactoryMcpConfig`/`applyMcpServers`) | ✅ | **완료**(코드+테스트 6종). `droid mcp list`→[project] 로 읽기 검증됨(유료 키 불요, 프로세스 cwd 기준). exec 중 도구 호출만 유료 게이트 |
| **2** | **`-o stream-json` + droid 스트림 이벤트 파싱**(현 `json` 최종객체만) | `index.ts`(buildCommand), `parse.ts`(droid 분기) | 🟡 | stream-json 유효 확인됨(단방향 JSONL, 부분 스키마 실측 아래). **전환은 성공 run 으로 assistant·result+usage 형태 확인 후** — result.text 경로 미확인이라 지금 전환 시 답변 유실 위험 |
| **2** | `captureActivityFromDisk` 토큰/비용 백필(세션 디스크 or `droid search --json`) | `index.ts` | 🟢 | devin `--export` 패턴 미러 |
| **2** | 세션 저장 레이아웃 확정 → `sessionFiles` 정정 | `index.ts:81` | 🟢 | 현재 `~/.factory/sessions` 추정 |
| **2** | `--enabled/disabled-tools`, `--use-spec`, `--tag` | `index.ts`, manifest | 🟢 | tag=`droid search` 상관 |
| **3** | `--mission`(자체 멀티에이전트) 단일-에이전트 토글 | `index.ts`, manifest | 🟡 | loom 워크플로우와 이중오케스트레이션 주의 → 토글로만 |
| **3** | 양방향 `stream-jsonrpc` 드라이버(§S7) | `factory/src`, §S7 | 🔴 | `stream-json`이 도구/파일 부족할 때만. 80/20은 `stream-json` |

**확인 필요(라이브 — factory `402 Payment Required` 확인: 유료 구독 필수):**
- **stream-json 부분 스키마 실측(402 직전, 2026-06-19):** `{type:"system",subtype:"init",session_id,tools[],model,reasoning_effort}` · `{type:"message",role,text,session_id}` · `{type:"error",source,message}`. **session_id 가 매 이벤트에 존재**(init 부터 — json 모드의 최종 result 보다 빠름).
- **미확인(성공 run 필요):** assistant 응답·`tool_use`·`file_change`·`{type:"result"}`+usage 형태, `--settings` 의 `mcpServers` 수용 여부, exec 중 MCP 도구 호출·동명 사용자서버 우선순위, 세션 디스크 포맷.
- **검증됨(유료 키 불요):** MCP 프로젝트-로컬 로드(`mcp list`→[project], 프로세스 cwd), stream-json 출력모드 유효성.

---

## §6. antigravity (agy) — 천장 낮음, 정직이 우선

| Tier | 작업 | 파일 | 난이도 | 비고 |
|------|------|------|--------|------|
| **1** | **PTY spawn로 stdout 드롭 우회**(§S6) | `spawn.ts`, `define.ts`, `antigravity/src` | 🔴 | **선검증 필수**: `script` 의사TTY로도 0바이트였음. 안 되면 헤드리스 불가를 UI 명시 |
| **2** | `captureActivityFromDisk` — `conversations/<id>.db`에서 도구·모델 best-effort(`strings`/protobuf-aware) | 신규 `antigravity/src/activity.ts` | 🟡 | **토큰/비용은 약속 금지**(.proto 없음). 정직하게 공백 |
| **2** | 세션 disambiguation — mtime 대신 워크스페이스 경로 매칭(db blob에 cwd 존재) | `index.ts:137-159` | 🟢 | 동시성 race 완화. caller-set id는 불가(env 무시 확인) |
| **3** | manifest MCP 경로 문구 정정(`~/.gemini/config/mcp_config.json`) + 헤드리스 한계 정책경고 | `manifest.ts:37` | 🟢 | 정직성 |
| **3** | `models.ts` 라벨→ID 정규화 회귀테스트 | `models.ts` test | 🟢 | 라벨 변경 감지 |

**확인 필요(라이브):** PTY가 실제로 텍스트를 내놓는지(불발 시 Tier1 무의미). 토큰/비용은 하드 제로 — 예산/usage가 $0/공백으로 읽힘을 문서화.

---

## §7. 권장 시퀀스

1. **공통 순수 작업 먼저(🟢, 라이브 불요):** S2(codex 파싱버그) → S1(reasoning kind) → S5(cache 토큰) → 각 CLI Tier1의 🟢(프리셋·pricing·manifest·probe·read_config_from). 단위테스트로 검증.
2. **세션·비용 인프라(🟡):** S3(caller-set id, claude) → S4(실비용) → devin ATIF비용 → factory/opencode 프리셋·probe.
3. **MCP·주입(🟡):** factory 프로젝트-로컬 MCP → devin `--config` → codex `--oss`/output-schema.
4. **라이브 검증 게이트:** §4·§5·§6의 "확인 필요" 일괄 검증(가능한 CLI부터). 통과분만 진행.
5. **🔴 전략(검증 후):** factory `stream-json` 파싱 → S7(ACP/jsonrpc 공통) → devin `acp` → antigravity PTY.

각 항목 머지 기준: 순수함수는 단위테스트, spawn/IO는 가짜명령(`/bin/cat`·`/bin/sh -c`), 라이브 LLM 호출은 자동테스트 제외(헌법). 한 커밋 한 가지.
