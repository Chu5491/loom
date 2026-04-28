# CLAUDE.md — loom 작업 가이드

> 이 문서는 이 저장소에서 작업하는 사람(또는 Claude)을 위한 작업 원칙과 어댑터 구현 가이드.
> 사용자 관점 문서는 [README.md](./README.md), 초기 설계는 [SLIM-HARNESS-DESIGN.md](./SLIM-HARNESS-DESIGN.md).

---

## 1. 프로젝트 한 줄 요약

**여러 CLI 에이전트(claude / gemini / codex / opencode …)를 웹 UI에서 통합 호출하는 얇은 dispatcher.**

핵심 신념: 자동 주입은 죄. 사용자가 적은 prompt + 사용자가 명시적으로 첨부한 spec — 그게 CLI에 도달하는 입력의 전부다.

---

## 2. 핵심 기능 (구현 우선순위)

이 저장소에서 우리가 정말 신경 쓸 기능은 이게 전부다. 그 외는 다 noise.

### Done

| # | 기능 | 위치 |
| - | --- | --- |
| 1 | 에이전트 CRUD | `apps/server/src/db/agents.ts` + `routes/agents.ts` + `apps/web/src/pages/AgentsPage.tsx` |
| 2 | Spec(MD) CRUD + 에디터 | `db/specs.ts` + `routes/specs.ts` + `pages/SpecsPage.tsx` |
| 3 | Run 라이프사이클 (start / cancel / status) | `services/run-service.ts` |
| 4 | SSE 실시간 로그 | `routes/runs.ts` (`/:id/logs`) + `services/log-store.ts` |
| 5 | Spec 첨부 (composePrompt 합성) | `services/run-service.ts` |
| 6 | claude-code 어댑터 | `packages/adapters/claude-code/` |
| 7 | i18n (en/ko) + 테마 (system/light/dark) | `apps/web/src/context/` |

### To do — 이번 작업 범위

| # | 기능 | 비고 |
| - | --- | --- |
| 8 | **공유 어댑터 유틸** (`@loom/adapter-utils`) | `spawnProcess` + `defineCliAdapter` factory |
| 9 | **gemini 어댑터** | 구글 gemini CLI |
| 10 | **codex 어댑터** | OpenAI codex CLI (`codex exec`) |
| 11 | **opencode 어댑터** | SST opencode CLI (`opencode run`) |
| 12 | 모든 어댑터 server registry 등록 | `apps/server/src/adapters/registry.ts` |

### 이번엔 절대 안 함

- 인증 / 멀티 테넌트
- 비용 추적 (LLM 응답에 비용이 있으면 표시만 — 별도 추적 시스템 X)
- worktree 격리 (Day 10에서)
- sub-agent 위임 트리 (Day 9에서)
- 어댑터 자동 발견 / 플러그인 마켓
- 추가 의존성 — 정말 꼭 필요한 게 아니면 추가 금지

---

## 3. 코딩 원칙 (AI 냄새 제거)

### 3.1 이름

- 짧게, 도메인 단어로. `xxxManager`, `xxxHelper`, `xxxService`, `xxxFactory` 같은 추상 어휘 금지
- 이미 존재하는 단어 재사용. `Run` 이미 있으면 `RunInstance` 만들지 말 것
- 변수에 `data`, `info`, `result` 같은 비정보적 이름 금지 (의미가 있으면 그 의미를 이름에 담을 것)

### 3.2 주석

- WHAT 주석 금지. 코드를 읽으면 알 수 있는 건 주석 안 씀
  ```ts
  // ❌ DB에서 agent를 가져온다
  const agent = getAgent(id);
  ```
- WHY 주석만 허용. 비직관적 결정 / 회피 / 의도가 있을 때
  ```ts
  // ✅ stream-json은 verbose 없이 쓰면 진행률이 빠지므로 기본 활성화
  if (verbose ?? outputFormat === "stream-json") args.push("--verbose");
  ```
- TODO/FIXME는 GitHub issue로 옮길 수 없으면 추가하지 말 것 (썩는다)

### 3.3 추상화

- **3번 반복되기 전엔 추상화하지 말 것.** 2번까진 복붙해도 좋다 (rule of three)
- 인터페이스 멤버는 정말 다양하게 구현돼야 할 때만. 하나만 있으면 함수로 충분
- "혹시 나중에 필요할까봐" 인자 추가 금지. 필요해질 때 추가

### 3.4 모듈 경계

- 패키지(`@loom/*`)는 책임 단위로만 분리:
  - `@loom/core` — 타입 + 인터페이스 (런타임 의존성 0)
  - `@loom/adapter-utils` — `spawnProcess` + `defineCliAdapter` (Node 표준만 사용)
  - `@loom/adapter-<kind>` — 단일 CLI에 대한 인자 빌드 + 등록 객체. 50줄 안쪽
  - `@loom/server` — Hono + DB + 라우트
  - `@loom/web` — React UI
- 어댑터는 server 내부를 모른다 (역방향 import 금지)
- Web은 `@loom/core` 타입만 import. 서버 모듈 import 금지

### 3.5 외부 의존성

- 표준 라이브러리로 가능하면 그것부터
- 추가 시 PR 메시지에 이유 명시 (PR이 없는 이 단계에선 커밋 메시지에)
- 현재 의존성 목록은 "Done"이라고 생각하고, 추가 전 한 번 더 의심

### 3.6 테스트

- **순수 함수는 무조건 테스트** — `buildClaudeCommand`, `composePrompt` 등
- spawn / I/O는 통합 수준에서 가짜 명령(`/bin/cat`, `/bin/sh -c`)으로 검증
- 실제 LLM API 호출은 수동 smoke만. 자동 테스트에 넣지 말 것 (요금 + flake)
- 한 케이스에 한 가지만 검증 — 이름이 시나리오를 설명해야 함

### 3.7 에러 처리

- 사용자 입력은 zod로 경계에서 검증, 그 이후로는 타입 신뢰
- 절대 `catch (e) { /* ignore */ }` 금지 — 막을 거면 이유를 한 줄 주석
- 비동기 함수에 `unhandledRejection` 만들지 말 것 (`void executeRun(...)`처럼 fire-and-forget은 함수 내부에서 모든 에러 처리)

### 3.8 UI

- Tailwind 클래스는 기존 패턴 따름. 새 색 / 새 spacing 도입 자제
- 모든 컴포넌트는 light/dark 양 톤 명시 — 한쪽만 있으면 PR 거절
- 새 i18n 키는 `apps/web/src/i18n/dictionaries.ts`에 en + ko 둘 다 추가. 한쪽만 추가 금지
- 새 페이지면 새 라우트. 기존 페이지 안에 모달로 쑤셔넣지 말 것

---

## 4. 어댑터 추상화 (이번 작업의 핵심)

### 4.1 인터페이스 (변경 안 함)

```ts
// packages/core/src/adapter.ts
export interface CliAdapter {
  kind: string;
  buildCommand(config: AdapterConfig): { command: string; args: string[] };
  spawn(args: SpawnArgs, config: AdapterConfig): Promise<RunHandle>;
}
```

### 4.2 공유 유틸 (이번에 추가)

`@loom/adapter-utils`는 어댑터들이 똑같이 반복하던 `child_process.spawn` 보일러플레이트를 제거.

```ts
// packages/adapter-utils/src/spawn.ts
export function spawnProcess(opts: {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  stdin?: string;                 // 빈 문자열이면 안 보냄
  signal?: AbortSignal;
  onStdout: (chunk: string) => void;
  onStderr: (chunk: string) => void;
}): Promise<RunHandle>;

// packages/adapter-utils/src/define.ts
export function defineCliAdapter(def: {
  kind: string;
  buildCommand: (config: AdapterConfig) => BuiltCommand;
  inputMode?: "stdin" | "arg";    // default: stdin
  resolveEnv?: (config: AdapterConfig) => Record<string, string>;
}): CliAdapter;
```

### 4.3 새 어댑터 작성 시 따를 패턴

각 어댑터 패키지는 다음 3개만 가지면 충분:

```
packages/adapters/<kind>/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts          # buildXxxCommand + 내보낸 어댑터 객체
    └── index.test.ts     # buildXxxCommand 단위 테스트
```

`index.ts` 골격 (~30~50줄):

```ts
import { defineCliAdapter } from "@loom/adapter-utils";
import type { AdapterConfig, BuiltCommand } from "@loom/core";

export interface XxxConfig extends AdapterConfig {
  command?: string;
  model?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
  // 어댑터 고유 필드
}

export function buildXxxCommand(config: XxxConfig = {}): BuiltCommand {
  const command = config.command ?? "xxx";
  const args: string[] = [/* ... */];
  if (config.model) args.push("--model", config.model);
  if (config.extraArgs?.length) args.push(...config.extraArgs);
  return { command, args };
}

export const xxxAdapter = defineCliAdapter({
  kind: "xxx",
  buildCommand: (cfg) => buildXxxCommand(cfg as XxxConfig),
  inputMode: "stdin",  // or "arg" if CLI takes prompt as last argument
  resolveEnv: (cfg) => (cfg as XxxConfig).env ?? {},
});
```

### 4.4 어댑터 작성 시 자주 하는 실수

- **사용자 prompt를 인자에 넣어 shell-quote 시도 금지.** stdin 또는 spawn args 배열로만 전달
- **stream-json 파싱을 어댑터 안에서 하려고 하지 말 것.** 어댑터는 raw chunk만 emit. 파싱은 UI 책임 (`RunDetailPage.tsx`의 `PrettyLine`)
- **자동 주입 금지.** 시스템 프롬프트, AGENTS.md, skill bundle 등 절대 어댑터에서 추가하지 말 것. 사용자가 spec으로 명시 첨부할 때만 (RunService가 이미 처리)

### 4.5 4개 어댑터의 입력 방식 정리

| Adapter | 명령 | 인자 형태 | prompt 전달 |
| --- | --- | --- | --- |
| `claude-code` | `claude` | `--print - --output-format stream-json --verbose [--model X]` | **stdin** |
| `gemini` | `gemini` | `[--model X] [--yolo]` | **stdin** (non-TTY 모드) |
| `codex` | `codex` | `exec [--model X] [--cd path]` | **arg** (마지막 인자) |
| `opencode` | `opencode` | `run [--model X]` | **arg** (마지막 인자) |

각 CLI의 정확한 플래그는 버전마다 다를 수 있으므로 어댑터는 **최소 공통 분모**만 빌드하고, 사용자가 `extraArgs`로 보강할 수 있게 함. `command`도 override 가능 (절대 경로 / 별칭).

---

## 5. 참고 자료

### 5.1 paperclip의 어댑터 구현

- `<paperclip>/packages/adapters/claude-local/src/server/execute.ts` — claude args 빌드 (line 497-516)
- `<paperclip>/packages/adapters/gemini-local/src/server/execute.ts` — gemini 어댑터 패턴
- `<paperclip>/packages/adapters/codex-local/src/server/execute.ts` — codex 어댑터 패턴
- `<paperclip>/packages/adapter-utils/src/server-utils.ts` — `runChildProcess` 헬퍼

가져올 것:
- 인자 빌드 로직 (필요한 부분만)
- 프로세스 spawn 패턴 (이미 우리는 spawnBin으로 가지고 있음)

가져오지 말 것:
- `buildClaudeRuntimeConfig` 같은 자동 조립 로직
- heartbeat 큐
- skill 시스템 / plugin SDK
- 회사·조직 메타데이터

### 5.2 각 CLI 공식 문서

| CLI | 저장소 | 핵심 명령 |
| --- | --- | --- |
| Claude Code | <https://github.com/anthropics/claude-code> | `claude --print -` |
| Gemini CLI | <https://github.com/google-gemini/gemini-cli> | `gemini -m <model>` (stdin) |
| Codex | <https://github.com/openai/codex> | `codex exec [prompt]` |
| OpenCode | <https://github.com/sst/opencode> | `opencode run <prompt>` |

---

## 6. 작업 흐름 (이번 작업)

1. ✅ 이 CLAUDE.md를 먼저 읽고 동의 (또는 사용자에게 확인)
2. paperclip의 gemini-local / codex-local 인자 빌드만 빠르게 훑기
3. `@loom/adapter-utils` 패키지 생성 — `spawnProcess` + `defineCliAdapter`
4. `@loom/adapter-claude-code`를 새 추상화로 리팩토 (테스트 그대로 통과해야 함)
5. `@loom/adapter-gemini` / `@loom/adapter-codex` / `@loom/adapter-opencode` 추가
6. `apps/server/src/adapters/registry.ts`에 4개 모두 등록
7. `pnpm -r typecheck` + `pnpm -r test` 그린 확인
8. README의 "어댑터 작성" 섹션을 새 추상화에 맞게 업데이트

---

## 7. PR 자세 (앞으로의 작업)

- 한 커밋은 한 가지만. "Add gemini adapter + refactor everything" 같은 거대 커밋 금지
- 메시지: `<scope>: <imperative>` (e.g. `adapter-gemini: add basic stdin pass-through`)
- 본문: WHY (이유) + 변경 범위 + 검증 방법

---

이 문서가 길어지면 의미가 없으니, 새 원칙은 정말 반복되는 패턴이 보일 때만 추가.
