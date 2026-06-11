# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 사용자 관점 문서는 [README.md](./README.md), v2 기준 설계는 [docs/V2-PLAN.md](./docs/V2-PLAN.md), spec 주입 검증은 [docs/SPEC-INJECTION-VERIFIED.md](./docs/SPEC-INJECTION-VERIFIED.md).

---

## 1. 프로젝트 한 줄 요약

**여러 CLI 에이전트(claude / antigravity / codex / opencode / devin)를 한 오피스에서 같이 부리는 협업 도구.**

### 헌법 (모든 결정을 지배하는 5원칙)

1. **CLI 그대로** — 래핑하되 변형하지 않는다.
2. **자동 주입은 죄** — 사용자가 적은 prompt + 명시적으로 첨부한 spec(rules/skills/mcp)이 입력의 전부. 어댑터가 몰래 끼워넣지 말 것.
3. **CLI root 불가침** — `~/.claude` `~/.gemini` 같은 CLI 전역 설정을 절대 건드리지 않는다. 주입은 run별 loadout/플래그로.
4. **정의는 git, 기록은 로컬** — `office/`(rules·skills·mcp·agents·harness)는 커밋, `data/`(sqlite·로그·loadout)는 gitignore.
5. **Raw는 진실, Parsed는 경험** — CLI 원본 출력은 항상 디스크 보존, parseEvents는 그 위의 뷰.

---

## 2. 빌드 · 테스트 · 개발

```bash
pnpm install                    # 의존성 설치
pnpm dev                        # 서버(3200) + Vite(3201) 동시 기동
pnpm dev:server                 # 서버만
pnpm dev:web                    # UI만
pnpm build                      # 전 워크스페이스 빌드
pnpm typecheck                  # tsc --noEmit (전 워크스페이스)
pnpm test                       # vitest run (전 워크스페이스)
```

단일 패키지 테스트:
```bash
pnpm --filter @loom/server test                # 서버 테스트
pnpm --filter @loom/adapter-claude-code test   # 어댑터 단일 테스트
```

단일 테스트 파일:
```bash
cd apps/server && npx vitest run test/harness.test.ts
cd packages/adapters/claude-code && npx vitest run src/index.test.ts
```

- better-sqlite3 12.x — Node 20~26 지원 (prebuild)
- Vite dev server(3201)가 `/api` 요청을 서버(3200)로 프록시
- `LOOM_HOME`으로 오피스 루트 오버라이드 가능 (기본 = 리포 루트)

---

## 3. 아키텍처 (v2)

### 3.1 패키지 구조

```
packages/core/               타입 (런타임 의존성 0) — office.ts 가 도메인의 영혼
packages/adapter-utils/      spawnProcess + defineCliAdapter (Node 표준만)
packages/adapters/           claude-code / antigravity / codex / opencode / devin
apps/server/                 Hono + better-sqlite3(기록만) + SSE
apps/web/                    React + Vite + Tailwind 4 (라우터 없음 — 탭 셸)
```

의존 방향: `core ← adapter-utils ← adapter-* ← server`. Web은 `@loom/core` 타입만 import. 어댑터는 server 내부를 모른다.

### 3.2 office-as-code

```
office/                      ← git 커밋되는 정의 (이름 = 식별자, id/timestamp 없음)
  rules/<name>.md            항상 붙는 규약
  skills/<name>.md           단일 스킬 — 또는 skills/<name>/SKILL.md + 딸린 파일(폴더 스킬)
  mcp/servers.json           MCP 서버 (secret 은 "${ENV}" 참조)
  agents/<name>.json         에이전트 = CLI + 모델 + 끌고 갈 rules/skills/mcp + roles
  workflows/<name>.json      워크플로우 = 노드(에이전트+프롬프트) 그래프 + 트리거(옛 하네스 흡수)
data/                        ← gitignore 되는 기록
  loom.db                    runs + run_events (슬림 sqlite — 마이그레이션 프레임워크 없음)
  logs/<runId>.log           CLI raw 출력 (진실)
  loadouts/<agent>/          매 run 직전 재생성되는 스킬·mcp 묶음
```

로더/세이버는 `apps/server/src/office.ts` (zod 경계 검증, safeName 으로 traversal 차단).

### 3.3 런 흐름

- **시작**: `routes/runs.ts` POST → `run/engine.ts startRun` — office 에서 에이전트의 rules/skills/mcp 추림(+`skills[]` 명시 첨부) → `run/loadout.ts` 디스크 펼침 → `run/compose.ts` 프롬프트 조립(스킬은 인덱스만 — 본문은 에이전트가 필요할 때 Read) → 어댑터 `spawn()`
- **스트림**: stdout 라인 → `run/parse.ts parseEvents`(5 CLI 포맷 → OfficeEvent 단일 모델) → 인메모리 + sqlite 영속 → SSE(`/:id/events`, replay→live→done)
- **워크플로우**: `run/workflow.ts` — 다단계 그래프(노드=스텝, 엣지=success/fail/always 분기, `{{input}}`/`{{result}}` 치환). 시작은 ① Talk 수동 버튼(`POST /api/runs/workflow`) ② 트리거 — 에이전트 run 종료 시 auto(즉시)/ask(UI 제안 → `POST /:id/workflow`). `MAX_CHAIN_HOPS=5` + `MAX_WORKFLOW_STEPS=20` 루프 방어. 1-hop 하네스(edges.json)는 이 개념에 흡수돼 제거됨.
- **프로젝트**: 등록된 로컬 디렉토리(`data/` sqlite, 머신별) — run 의 cwd. office 는 전역 공유 "팀", 프로젝트는 "일할 곳".

### 3.4 프론트엔드

탭 셸 3개(Talk / Office / Connections) + 헤더(CLI 인증 표시 · 프로젝트 셀렉터). TanStack Query + i18n/Theme Context, API 는 `api/client.ts` 단일 파일, SSE 는 `hooks/useRunStream.ts`. 마크다운 렌더는 `components/Markdown.tsx`(react-markdown — raw HTML 미실행). Talk 스레드는 runs 데이터 단일 진실에서 파생.

### 3.5 어댑터 아키텍처

`defineCliAdapter<TConfig>()` 팩토리가 각 CLI의 차이를 흡수:

| Adapter | prompt 전달 | MCP 주입 | 비고 |
|---------|-------------|----------|------|
| claude-code | stdin | `--mcp-config --strict-mcp-config` | stream-json |
| antigravity | arg | **불가** (CLI 구조 한계 — UI에 명시) | `agy` |
| codex | stdin | `-c mcp_servers.*` | |
| opencode | trailing arg | XDG_CONFIG_HOME 리다이렉트 | |
| devin | `--print` arg | `<cwd>/.devin/config.local.json` | plain text 출력 |

어댑터는 `buildCommand()`(순수 함수, 테스트 대상) + 옵션 훅으로 구성. 등록은 `apps/server/src/adapters/registry.ts`.

---

## 4. 코딩 원칙

### 이름
- 짧게, 도메인 단어로. `xxxManager`, `xxxHelper`, `xxxService`, `xxxFactory` 금지
- 이미 있는 단어 재사용. `Run` 있으면 `RunInstance` 만들지 말 것
- `data`, `info`, `result` 같은 비정보적 이름 금지

### 주석
- WHAT 주석 금지. WHY 주석만 (비직관적 결정 / 회피 / 의도)
- TODO/FIXME는 GitHub issue로 옮길 수 없으면 추가하지 말 것

### 추상화
- 3번 반복되기 전엔 추상화하지 말 것 (rule of three)
- "혹시 나중에 필요할까봐" 인자 추가 금지

### 모듈 경계
- 어댑터는 server 내부를 모른다 (역방향 import 금지)
- Web은 `@loom/core` 타입만 import. 서버 모듈 import 금지
- 외부 의존성 추가 시 커밋 메시지에 이유 명시

### 에러 처리
- 사용자 입력은 zod로 경계에서 검증, 그 이후로는 타입 신뢰
- `catch (e) { /* ignore */ }` 금지 — 막을 거면 이유를 한 줄 주석
- fire-and-forget 비동기 함수는 내부에서 모든 에러 처리

### 테스트
- 순수 함수는 무조건 테스트 (`buildClaudeCommand`, `composePrompt`, `triggerMatches` 등)
- spawn / I/O는 가짜 명령(`/bin/cat`, `/bin/sh -c`)으로 검증
- 실제 LLM API 호출은 자동 테스트에 넣지 말 것
- 한 케이스에 한 가지만 검증, 이름이 시나리오를 설명

### UI
- Tailwind 클래스는 기존 패턴 따름. 새 색 / spacing 도입 자제 (토큰은 `styles.css`)
- 모든 컴포넌트는 light/dark 양 톤 명시
- i18n 키는 `apps/web/src/i18n/dictionaries.ts`에 en + ko 둘 다 추가

---

## 5. 어댑터 작성 패턴

새 어댑터 패키지는 다음으로 구성:

```
packages/adapters/<kind>/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts          # buildXxxCommand + defineCliAdapter + manifest
    ├── index.test.ts     # buildXxxCommand 단위 테스트
    ├── manifest.ts       # UI 설정 폼 필드 정의
    ├── models.ts         # 모델 목록 조회 (listModels)
    └── probe.ts          # CLI 바이너리 존재/버전 탐지
```

핵심 규칙:
- **prompt를 인자에 넣어 shell-quote 시도 금지.** stdin 또는 spawn args 배열로만 전달
- **stream-json 파싱을 어댑터 안에서 하지 말 것.** 어댑터는 raw chunk만 emit (파싱은 서버 parseEvents)
- **자동 주입 금지.** 시스템 프롬프트, skill bundle 등 절대 어댑터에서 추가하지 말 것
- **CLI root 불가침.** 주입이 필요하면 run별 플래그/프로젝트-로컬 파일로 (devin 의 `.devin/config.local.json` 패턴)

등록: `apps/server/src/adapters/registry.ts`에 import 후 `registerAdapter()` 호출.

---

## 6. 커밋 자세

- 한 커밋은 한 가지만
- 메시지: `<scope>: <imperative>` (e.g. `adapter-devin: pass model via --model flag`)
- 본문: WHY (이유) + 변경 범위 + 검증 방법
