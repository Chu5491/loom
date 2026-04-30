# loom

**Multi-agent orchestrator for CLI-based development workflows.**

여러 AI CLI 도구(Claude Code, Gemini, Codex, OpenCode)를 하나의 웹 인터페이스에서 통합하고, 에이전트 간 협업을 채팅처럼 관리하는 워크스페이스. 파일 변경, diff, 실행 비용을 실시간으로 추적합니다.

[![node](https://img.shields.io/badge/node-%E2%89%A522-blue)](#-요구사항)
[![license](https://img.shields.io/badge/license-MIT-green)](#라이선스)
[![typescript](https://img.shields.io/badge/typescript-5.0%2B-blue)](#)

---

## 왜 loom을 써야 하나

**문제**: AI 에이전트별로 CLI를 분리하면 결과를 추적하고 통합하기 어렵다.

**해결**: 모든 에이전트를 한 곳에서 관리하되, 입력은 명시적이고 결과는 가시화한다.

- 파일 변경을 실시간으로 확인할 수 있다
- 어떤 에이전트가 언제 무엇을 했는지 추적할 수 있다
- 한 thread 안에서 여러 에이전트를 순차적으로 또는 동시에 호출할 수 있다
- 각 실행의 비용을 기록할 수 있다
- 같은 프로젝트에서 여러 독립적인 thread를 병렬로 진행할 수 있다

핵심 설계: **사용자가 명시적으로 입력한 것만 에이전트에 전달된다.** 시스템 프롬프트, 파일 자동 주입, 스킬 번들 같은 것은 사용자가 명시적으로 첨부할 때만 포함된다.

---

## 주요 기능

### 에이전트 협업 (Multi-Agent Chat)
각 프로젝트의 **thread** 안에서 여러 에이전트를 관리한다.
- `@mention`으로 에이전트 전환 또는 다른 에이전트에 위임
- 한 메시지를 여러 에이전트에 동시 전송
- 답변에서 텍스트 선택 후 다음 메시지에 자동 인용
- 위임 뱃지로 대화 흐름 시각화

### 파일과 채팅 통합 (Unified Workspace)
한 화면에서 파일과 메시지를 함께 본다.
- **좌측**: 파일 트리 (수정된 파일 표시)
- **중앙**: 파일 뷰어 + 시점별 diff
- **우측**: 메시지 흐름 + composer

각 실행이 변경한 파일을 추적하고, 파일의 변경 히스토리를 시간순으로 확인할 수 있다.

### Thread 컨텍스트 (Context Bundle)
각 thread마다 markdown 메모를 작성하고, 필요할 때만 첨부한다.
- 자동 주입 없음 — 사용자가 메시지 작성 시점에 결정
- 프롬프트에 `=== Thread Context ===` 섹션으로 추가

### Worktree 격리 (Branch Isolation)
같은 프로젝트에서 여러 작업을 병렬로 진행한다.
- 새 thread 생성 시 `git worktree` 자동 할당
- 각 thread는 독립적인 브랜치에서 작업
- thread 삭제 시 worktree 자동 정리

### 비용 추적 (Cost Tracking)
각 run의 실행 비용을 기록하고 표시한다.
- 메시지별 비용 표시 (`$0.042`)
- thread별 누적 비용
- 에이전트가 비용 정보를 제공할 때만 기록

### 지원하는 CLI 에이전트

| Agent | CLI | 입력 | 특징 |
| --- | --- | --- | --- |
| **Claude Code** | `claude` | stdin | stream-json 실시간 출력, 비용 추적 |
| **Gemini** | `gemini` | stdin | non-TTY 모드 |
| **Codex** | `codex exec` | 마지막 인자 | 커맨드라인 인자 모드 |
| **OpenCode** | `opencode run` | 마지막 인자 | 커맨드라인 인자 모드 |

모든 어댑터는 동일한 `defineCliAdapter` 팩토리로 구성되어 ~40줄 정도의 일관된 코드 크기를 유지합니다.

---

## 설계 원칙

### 명시성 (Explicitness)
자동 주입은 하지 않는다. 시스템 프롬프트, 파일, 스킬, context 같은 모든 것은 **사용자가 명시적으로 선택**할 때만 에이전트에 전달된다. 이를 통해 비용과 결과를 예측 가능하게 유지한다.

### 사용자 제어 (User Control)
매 위임과 매 실행을 사용자가 결정한다. 에이전트가 자동으로 다음 에이전트를 선택하거나 워크플로우를 진행하지 않는다.

### 코드 중심 (Code-First)
어댑터는 플러그인 마켓이 아닌 코드로 등록한다. 새 CLI를 붙이려면 패키지를 작성해서 registry에 추가한다.

### 로컬 도구 (Local-First)
인증, 멀티 테넌트, 클라우드 동기화 같은 것은 없다. 로컬 개발 워크스페이스다.

---

## 지금 없는 것

- 에이전트 자동 제안 패턴 (`[NEXT]`, `[ASK]`)
- 재사용 가능한 워크플로우 템플릿
- 플러그인 마켓

---

## 요구사항

- Node.js ≥ 22
- pnpm (또는 npm)
- 지원하는 CLI 도구 설치: Claude Code, Gemini, Codex, OpenCode 중 하나 이상

## 설치

```bash
git clone https://github.com/Chu5491/loom.git
cd loom
pnpm install
```

## 실행

```bash
pnpm dev
```

이 명령은 다음 두 서버를 동시에 실행한다:
- **서버**: http://localhost:3200 (API + SSE)
- **웹**: http://localhost:3201 (UI)

브라우저에서 http://localhost:3201 을 열고, 프로젝트를 생성한 후 에이전트를 설정해 시작한다.

## 검증 & 빌드

```bash
# 타입 체크 (모든 패키지)
pnpm -r typecheck

# 단위 테스트 (server + adapters)
pnpm -r test

# 프로덕션 빌드
pnpm -r build
```

---

## UI 레이아웃

```
┌──────────────────────────────────────────────────────────┐
│ loom                     Projects · Agents · Specs       │
├────────┬─────────────────────────────────────────────────┤
│        │  Backend [●●●] Frontend [idle] ...             │
│ Sidebar├────────────────────────────────────────────────┤
│        │  src             │ src/auth.ts × │ Messages    │
│ •Home  │  ├─ auth.ts      │ ────────────── │ ──────────  │
│ •Prj A │  ├─ db.ts        │ 23 insertions │ 20:45       │
│ •Prj B │  ├─ route.ts     │ 5 deletions   │ Backend:... │
│        │  └─ utils.ts     │ +/- diffs     │              │
│ Settings│  │               │ (inline)      │ composer    │
└────────┴──┴──────────────┴───────────────┴──────────────┘
```

- **좌측**: 프로젝트 네비게이션 + 설정
- **상단**: 실행 중인 에이전트 상태바
- **중앙-좌**: 파일 트리 (수정된 파일에 점 표시)
- **중앙**: 파일 뷰어 + unified diff
- **우측**: 메시지 흐름 (토글 가능)

### 키보드 네비게이션
- `⌘P` — 파일 검색 팔레트 (fuzzy)
- `⌘L` — 우측 메시지 drawer 토글
- `⇧⌘A` — 현재 thread archive
- `@` (입력 중) — 에이전트 멘션

---

## 아키텍처

### 기술 스택
- **Backend**: Hono (lightweight framework) + better-sqlite3
- **Frontend**: React + Vite + TanStack Query
- **Monorepo**: pnpm workspaces
- **Language**: TypeScript 5.0+

### 폴더 구조

```
loom/
├── apps/
│   ├── server/        Hono API + DB + run executor + git service
│   └── web/           React SPA + UI components + API client
├── packages/
│   ├── core/          Shared types (Project, Agent, Run, Thread, etc)
│   ├── adapter-utils/ defineCliAdapter factory + spawnProcess utility
│   └── adapters/      Individual CLI adapters (claude-code, gemini, codex, opencode)
└── [config files]     TypeScript, pnpm workspace, package.json
```

---

## 데이터 모델

```
Project
  ├── Thread (각각 독립적인 git worktree)
  │   ├── context_bundle (markdown 메모)
  │   └── Run (실행 기록)
  │       ├── agent_id
  │       ├── prompt (사용자 입력)
  │       ├── attached_specs[] (명시적으로 첨부한 spec)
  │       ├── before_ref / after_ref (git 스냅샷)
  │       ├── run_changes[] (파일 변경 기록)
  │       └── cost_usd (실행 비용)
  │
  ├── Agent (프로젝트별 설정)
  │   ├── name
  │   ├── prompt (기본 명령어)
  │   ├── adapter_kind (claude-code, gemini 등)
  │   ├── adapter_config (모델, 사용자 정의 args)
  │   └── default_cwd
  │
  └── Spec (문서 라이브러리)
      ├── name
      ├── content (markdown)
      └── tags
```

핵심:
- **Thread**는 일급 컨테이너. 대화의 경계다.
- **Run** 체인이 thread 안의 시간 순서를 이룬다.
- **Spec**은 선택적으로 각 run에 첨부된다 (자동 주입 안 함).
- **run_changes**는 git gc 후에도 유지되는 영구 기록이다.

---

## REST API

### Projects
```
GET    /api/projects
GET    /api/projects/:id
POST   /api/projects
PATCH  /api/projects/:id
DELETE /api/projects/:id
GET    /api/projects/:id/tree?path=...         # 디렉토리 트리 (lazy)
GET    /api/projects/:id/files-flat            # 모든 파일 목록 (검색용)
GET    /api/projects/:id/file?path=...         # 파일 내용
GET    /api/projects/:id/touched               # 최근 수정된 파일 목록
GET    /api/projects/:id/file-history?path=... # 파일의 변경 히스토리
```

### Threads
```
GET    /api/threads?projectId=...
GET    /api/threads/:id
POST   /api/threads                    # body.isolate=true → git worktree 생성
PATCH  /api/threads/:id                # name, status, context_bundle 변경
DELETE /api/threads/:id                # worktree 자동 정리
```

### Runs
```
GET    /api/runs?agentId=...&threadId=...&status=...
GET    /api/runs/:id
GET    /api/runs/:id/result            # 최종 output
GET    /api/runs/:id/changes           # 파일 변경 목록
GET    /api/runs/:id/changes/patch?path=... # unified diff
POST   /api/runs                       # 새 run 시작
POST   /api/runs/:id/cancel
GET    /api/runs/:id/logs              # SSE: 실시간 스트림
```

### Entities (표준 CRUD)
```
GET/POST/PATCH/DELETE /api/agents
GET/POST/PATCH/DELETE /api/specs
GET                   /api/adapters
GET                   /api/health
```

---

## 어댑터 개발 가이드

### 구조
```
packages/adapters/<cli-name>/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts           # ~40줄: buildXxxCommand + 어댑터 정의
    └── index.test.ts      # 단위 테스트
```

### 최소 구현
```ts
import { defineCliAdapter } from "@loom/adapter-utils";
import type { AdapterConfig, BuiltCommand } from "@loom/core";

export interface XxxConfig extends AdapterConfig {
  command?: string;
  model?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
}

export function buildXxxCommand(config: XxxConfig = {}): BuiltCommand {
  const command = config.command ?? "xxx";
  const args: string[] = [];
  if (config.model) args.push("--model", config.model);
  if (config.extraArgs?.length) args.push(...config.extraArgs);
  return { command, args };
}

export const xxxAdapter = defineCliAdapter({
  kind: "xxx",
  buildCommand: (cfg) => buildXxxCommand(cfg as XxxConfig),
  inputMode: "stdin",              // 또는 "arg" (마지막 인자)
  resolveEnv: (cfg) => (cfg as XxxConfig).env ?? {},
});
```

### 등록
`apps/server/src/adapters/registry.ts`에 임포트해서 추가:
```ts
import { xxxAdapter } from "@loom/adapter-xxx";

export const adapters = {
  "claude-code": claudeCodeAdapter,
  "gemini": geminiAdapter,
  "xxx": xxxAdapter,  // ← 추가
};
```

### 비용 추적
stdout에 다음 형식의 JSON을 emit하면 자동으로 캡처:
```json
{"type":"result","total_cost_usd":0.042}
```

### 설계 원칙
- **사용자 프롬프트는 절대 커맨드라인 인자로 전달하지 말 것.** stdin 또는 arg 배열로만 전달한다.
- **자동 주입 금지.** 시스템 프롬프트, 파일, 스킬 등은 사용자가 명시적으로 첨부한 것만 포함된다.
- **어댑터는 단순할수록 좋다.** 원본 청크만 emit하고, 파싱은 UI의 책임이다.
- **사용자가 재정의 가능하게.** `command`, `extraArgs`, `env` 모두 설정으로 재정의 가능하다.

---

## 라이선스

MIT.
