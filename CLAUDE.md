# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 사용자 관점 문서는 [README.md](./README.md), 초기 설계는 [SLIM-HARNESS-DESIGN.md](./SLIM-HARNESS-DESIGN.md).

---

## 1. 프로젝트 한 줄 요약

**여러 CLI 에이전트(claude / gemini / codex / opencode …)를 한 워크스페이스에서 같이 부리는 협업 도구.**

핵심 신념: **자동 주입은 죄.** 사용자가 적은 prompt + 사용자가 명시적으로 첨부한 spec — 그게 CLI에 도달하는 입력의 전부다. 시스템 프롬프트 / AGENTS.md / skill bundle을 어댑터가 몰래 끼워넣지 말 것.

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
pnpm --filter @loom/server test               # 서버 테스트
pnpm --filter @loom/adapter-claude-code test   # 어댑터 단일 테스트
pnpm --filter @loom/adapter-utils test         # adapter-utils 테스트
```

단일 테스트 파일:
```bash
cd apps/server && npx vitest run test/run-lifecycle.test.ts
cd packages/adapters/claude-code && npx vitest run src/index.test.ts
```

- Node ≥ 22 필수 (better-sqlite3 ABI 127)
- `scripts/dev.sh`가 homebrew/nvm의 node@22를 자동으로 PATH에 넣음
- Vite dev server(3201)가 `/api` 요청을 서버(3200)로 프록시
- 테스트는 vitest, `pool: "forks"` + `singleFork: true`. 테스트 setup이 임시 `LOOM_DATA_DIR` 생성/정리

---

## 3. 아키텍처

### 3.1 패키지 구조

```
packages/core/               타입 + 인터페이스 (런타임 의존성 0)
packages/adapter-utils/       spawnProcess + defineCliAdapter (Node 표준만)
packages/adapters/
  claude-code/                claude CLI 어댑터
  gemini/                     gemini CLI 어댑터
  codex/                      codex CLI 어댑터
  opencode/                   opencode CLI 어댑터
apps/server/                  Hono + better-sqlite3 + SSE
apps/web/                     React + Vite + Tailwind 4 + Monaco
```

의존 방향: `core ← adapter-utils ← adapter-* ← server`. Web은 `@loom/core` 타입만 import. 어댑터는 server 내부를 모른다.

### 3.2 서버 흐름

`routes/` → `services/` → `db/` 3계층. Hono 라우트에서 zod 검증, 서비스에서 비즈니스 로직, db는 better-sqlite3 prepared statement.

핵심 경로:
- **Run 시작**: `routes/runs.ts` POST → `services/run-service.ts` → 어댑터 `spawn()` → `child_process.spawn` → SSE로 stdout/stderr 스트리밍
- **Run 로그**: `routes/runs.ts` GET `/:id/logs` → `services/log-store.ts` 인메모리 버퍼 → SSE EventSource
- **Git 스냅샷**: run 시작/종료 시 `services/git-snapshot.ts`로 commit-tree 전후 diff 캡처 (working index 건드리지 않음)

### 3.3 프론트엔드

React Router (lazy-loaded pages) + TanStack Query + i18n Context + Theme Context. API 호출은 `api/client.ts` 단일 파일. Monaco Editor로 파일 뷰 + diff. SSE는 `EventSource`로 직접 구독.

### 3.4 어댑터 아키텍처

`defineCliAdapter<TConfig>()` 팩토리가 각 CLI의 차이를 흡수:

| Adapter | prompt 전달 | session resume | tool 추출 |
|---------|-------------|----------------|-----------|
| claude-code | stdin | `--resume` | stream-json 파싱 |
| gemini | `--prompt` arg | 없음 | 없음 |
| codex | stdin | 없음 | 없음 |
| opencode | trailing arg | `--session` | 없음 |

어댑터는 `buildCommand()` (순수 함수, 테스트 대상) + 옵션 훅(`resolveEnv`, `applyResume`, `extractSessionId`, `extractTouchedPaths`, `extractTouchedEdits`, `extractToolUses`)으로 구성. 등록은 `apps/server/src/adapters/registry.ts`.

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
- 순수 함수는 무조건 테스트 (`buildClaudeCommand`, `composePrompt` 등)
- spawn / I/O는 가짜 명령(`/bin/cat`, `/bin/sh -c`)으로 검증
- 실제 LLM API 호출은 자동 테스트에 넣지 말 것
- 한 케이스에 한 가지만 검증, 이름이 시나리오를 설명

### UI
- Tailwind 클래스는 기존 패턴 따름. 새 색 / spacing 도입 자제
- 모든 컴포넌트는 light/dark 양 톤 명시
- i18n 키는 `apps/web/src/i18n/dictionaries.ts`에 en + ko 둘 다 추가
- 새 페이지면 새 라우트. 모달로 쑤셔넣지 말 것

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
- **stream-json 파싱을 어댑터 안에서 하지 말 것.** 어댑터는 raw chunk만 emit
- **자동 주입 금지.** 시스템 프롬프트, skill bundle 등 절대 어댑터에서 추가하지 말 것

등록: `apps/server/src/adapters/registry.ts`에 import 후 `registerAdapter()` 호출.

---

## 6. 커밋 자세

- 한 커밋은 한 가지만
- 메시지: `<scope>: <imperative>` (e.g. `adapter-gemini: add basic stdin pass-through`)
- 본문: WHY (이유) + 변경 범위 + 검증 방법
