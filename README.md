# loom

> **Slim, pass-through orchestrator for multi-agent CLI workflows.**
> Claude Code · Gemini · Codex · OpenCode 네 가지 CLI를 하나의 웹 UI에서 띄우고,
> spec MD를 관리하고, 사람이 직접 손으로 위임하는 가벼운 dispatcher.

[![status](https://img.shields.io/badge/status-alpha-orange)](#)
[![node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)](#)
[![license](https://img.shields.io/badge/license-MIT-blue)](#)

---

## 목차

- [철학](#철학)
- [기능](#기능)
- [어떻게 보이는가](#어떻게-보이는가)
- [아키텍처](#아키텍처)
- [폴더 구조](#폴더-구조)
- [빠른 시작](#빠른-시작)
- [설정 (환경 변수)](#설정-환경-변수)
- [데이터 모델](#데이터-모델)
- [REST API](#rest-api)
- [SSE 스트리밍](#sse-스트리밍)
- [어댑터 작성](#어댑터-작성)
- [데이터 디렉토리 / 백업](#데이터-디렉토리--백업)
- [국제화 / 테마](#국제화--테마)
- [개발](#개발)
- [로드맵](#로드맵)

---

## 철학

`loom`은 한 가지 신념 위에 만들어집니다 — **"오케스트레이터는 자기 의견이 적을수록 좋다."**

CLI 에이전트(`claude`, `gemini`, `codex`, `opencode`)는 이미 강력합니다. loom이 하는 일은:

1. 여러 CLI를 하나의 웹 UI에서 띄우고 종료시키기
2. 사용자가 손으로 적은 spec(MD)을 에이전트에 배정해두기
3. stdout/stderr를 실시간으로 보여주기
4. 결과를 다른 에이전트에게 **사용자가 직접** 위임하기
5. 호출 기록을 유지하기

그 외의 모든 자동 주입 — 부트스트랩 프롬프트, AGENTS.md, 회사 메타데이터, skill bundle, LLM tool-call 기반 자율 위임 — 은 **명시적으로 거부**합니다.

> 사용자가 입력한 prompt + 사용자가 명시적으로 배정한 스킬 — 그것이 CLI에 도달하는 입력의 전부입니다.

---

## 기능

### 현재 구현됨 (v0.1)

- ✅ **4개 어댑터** — Claude Code · Gemini · Codex · OpenCode. 각 CLI별 binary probe + auth 상태 + 라이브 모델 조회
- ✅ **프로젝트 단위 격리** — 모든 에이전트/스킬/실행은 한 프로젝트 안에서 살고, 프로젝트의 path가 기본 cwd
- ✅ **에이전트 관리** — 어댑터별 폼, 모델 선택, 시스템 프롬프트, 스킬 다중 배정
- ✅ **스킬(Spec) MD 에디터** — 좌측 목록 + 우측 split 에디터 (live MD preview), 태그
- ✅ **스킬 디스크 미러링** — 에이전트에게 배정된 스킬은 `<project>/.loom/agents/<id>/skills/`에 `.md`로 자동 sync. CLI는 `Read` 툴로 필요할 때만 읽음 → 토큰 절약 + 격리
- ✅ **Pixel Office (Room 탭)** — 에이전트를 졸라맨 캐릭터로 책상에 앉혀놓는 2D 캔버스. 활성 run은 모니터가 빛남. 위임 화살표 자동 표시
- ✅ **Mission Pane (채팅 UI)** — Room에서 에이전트 클릭 → 오른쪽 채팅 패널에 컴포저 + 라이브 응답 + 위임 chip
- ✅ **수동 위임** — 매니저 run이 끝나면 chip 클릭으로 부모 결과를 다음 에이전트에 패킷 전달. `parentRunId`로 체인 보존
- ✅ **실시간 로그 (SSE)** — `stream-json` 라인 파싱 → assistant/tool_use/tool_result/result 별 prettify, raw 토글
- ✅ **History 탭** — 모든 실행 기록을 필터 (감사 트레일)
- ✅ **취소** — 실행 중인 프로세스에 SIGTERM
- ✅ **다국어 (en/ko) + 테마 (system/light/dark)** — 즉시 전환, FOUC 방지
- ✅ **Crash 복구** — 부팅 시 orphan run을 `failed`로 정리
- ✅ **자동 마이그레이션** — `PRAGMA table_info` 기반 idempotent column 추가

### 의도적으로 안 함

- ❌ **자율 위임 (LLM tool-call로 sub-agent 호출)** — 사람이 chip 클릭으로만
- ❌ **인증** — 로컬호스트 단일 사용자 전용
- ❌ **비용 추적** — LLM 응답에 비용이 있으면 표시만
- ❌ **자동 프롬프트 주입** — AGENTS.md/CLAUDE.md/회사 메타 등 일체 X
- ❌ **시크릿 keychain 통합** — 어댑터 config는 평문 저장 (v1.1+ 검토)

---

## 어떻게 보이는가

```
Project: my-app
─────────────────────────────────────────────────────────────────
[ Room ] [ Agents ] [ Skills ] [ History ]
─────────────────────────────────────────────────────────────────
agents 4 · working 1 · skills 3 · runs 27 · delegations 1
─────────────────────────────────────────────────────────────────

  ┌──────────────────────────────┐  ┌─────────────────────────┐
  │ Pixel office (Canvas)        │  │ 🤖 Backend Engineer  ✕ │
  │                              │  │ engineer · claude-code  │
  │  📋whiteboard      ☕coffee  │  ├─────────────────────────┤
  │                              │  │     ┌──────────────┐    │
  │   Backend ─────→ Reviewer    │  │     │ Refactor auth│    │
  │   (active)                   │  │     │ to use TQ    │    │
  │                              │  │     └──────────────┘    │
  │       Researcher             │  │                    나   │
  │                              │  │                          │
  │  💧water        🪴plant      │  │ Backend Engineer  ●     │
  │                              │  │ ┌────────────────────┐  │
  └──────────────────────────────┘  │ │ Reading auth.ts... │  │
                                    │ │ 🛠 Read           │  │
                                    │ │ 🛠 Edit           │  │
                                    │ │ Done.              │  │
                                    │ └────────────────────┘  │
                                    │ Hand off: [@reviewer]   │
                                    ├─────────────────────────┤
                                    │ Message Backend… [Send] │
                                    └─────────────────────────┘
```

- 캐릭터 클릭 → 노란 후광 + 오른쪽 패널 그 에이전트로 전환
- 메시지 보내기 → run 시작, 캐릭터 모니터가 빛남, 응답이 라이브로 누적
- 완료되면 `Hand off:` 칩 등장. 클릭 → 미니 폼에서 부모 결과 포함 여부 + 새 지시 입력 → 자식 run 시작 → 같은 패널에 들여쓰기로 스택

---

## 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (http://localhost:3201)                            │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  React 18 + TanStack Query + react-router-dom        │    │
│  │  Tailwind v4 (class-based dark variant)             │    │
│  │  i18n (en/ko) · marked · Canvas (PixelRoom)         │    │
│  │  EventSource → /api/runs/:id/logs                   │    │
│  └────────────────┬─────────────────────────────────────┘    │
└───────────────────┼──────────────────────────────────────────┘
                    │  /api/* (Vite proxy in dev)
                    ▼
┌─────────────────────────────────────────────────────────────┐
│  Hono server (http://127.0.0.1:3200)                        │
│  ┌──────────┐ ┌─────────┐ ┌────────┐ ┌───────┐ ┌─────────┐  │
│  │/projects │ │/agents  │ │/specs  │ │/runs  │ │/adapters│  │
│  └────┬─────┘ └────┬────┘ └───┬────┘ └───┬───┘ └────┬────┘  │
│       └─────────┬──┘          │          │          │       │
│                 ▼              ▼          ▼          ▼       │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  RunService                                          │    │
│  │   composePrompt(user, agent, project, skills)        │    │
│  │     → manifest of disk paths (NOT bodies)            │    │
│  │   adapter.spawn(args, config) → child_process        │    │
│  │   onStdout/onStderr → log-store (file + emitter)     │    │
│  └──────┬───────────────────────────┬───────────────────┘    │
│         ▼                           ▼                        │
│  ┌──────────────────────┐  ┌───────────────────────────┐    │
│  │ SQLite (better-sql.) │  │ Adapter Registry          │    │
│  │ loom.db (WAL)        │  │ ├─ claude-code            │    │
│  │ projects · agents ·  │  │ ├─ gemini                 │    │
│  │ specs · runs         │  │ ├─ codex                  │    │
│  └──────────────────────┘  │ └─ opencode               │    │
│  ┌──────────────────────┐  └─────────┬─────────────────┘    │
│  │ skill-sync           │            ▼                       │
│  │ DB → <project>/.loom/│  ┌────────────────────────────┐    │
│  │ agents/<id>/skills/  │  │ External CLI processes     │    │
│  └──────────────────────┘  │ claude · gemini · codex …  │    │
│                             └────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                    ▼
              ~/.loom/data/
                ├── loom.db
                └── logs/<run-id>.jsonl
```

**핵심 흐름 (run 시작):**

```
POST /api/runs              ← Mission Pane 컴포저 (또는 curl)
  body: { agentId, prompt, parentRunId? }

  1. agent + project 조회 → adapter 종류 식별
  2. 에이전트의 skillIds 로드 (DB → 디스크에 이미 미러됨)
  3. composePrompt → [agent prompt] + [스킬 manifest = 경로+첫줄] + [user prompt]
  4. DB INSERT runs (status='queued')
  5. log-store.startLog(runId) → JSONL 파일 open
  6. adapter.spawn({ prompt: composed, signal, onStdout, onStderr })
  7. status='running' + pid
  8. 종료 시 → 'succeeded' | 'failed' | 'cancelled'
  9. log-store.finishLog → SSE 구독자에게 'done'
```

**스킬은 prompt에 인라인되지 않습니다.** `<project>/.loom/agents/<agent-id>/skills/<slug>.md` 경로만 manifest에 박혀 LLM이 자기 file-read tool로 필요할 때만 읽습니다. 다른 에이전트의 스킬은 형제 폴더에 있어 절대 보이지 않습니다.

---

## 폴더 구조

```
loom/
├── package.json                    # pnpm workspace 루트
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── README.md
├── CLAUDE.md                       # AI/사람 컨트리뷰터 가이드
├── SLIM-HARNESS-DESIGN.md          # 초기 설계 문서 (archive)
│
├── apps/
│   ├── server/                     # @loom/server  (Hono + SQLite)
│   │   ├── src/
│   │   │   ├── index.ts            # 부트스트랩 + graceful shutdown
│   │   │   ├── config.ts           # LOOM_PORT / LOOM_DATA_DIR
│   │   │   ├── adapters/registry.ts
│   │   │   ├── db/
│   │   │   │   ├── schema.sql
│   │   │   │   ├── client.ts       # 자동 마이그레이션
│   │   │   │   ├── projects.ts
│   │   │   │   ├── agents.ts
│   │   │   │   ├── agent-skills.ts # 다대다 join
│   │   │   │   ├── specs.ts
│   │   │   │   └── runs.ts
│   │   │   ├── routes/
│   │   │   │   ├── health.ts
│   │   │   │   ├── projects.ts
│   │   │   │   ├── agents.ts
│   │   │   │   ├── specs.ts
│   │   │   │   ├── runs.ts         # ↳ SSE /:id/logs
│   │   │   │   └── adapters.ts     # probe / models / test
│   │   │   └── services/
│   │   │       ├── run-service.ts  # composePrompt + spawn
│   │   │       ├── log-store.ts    # 파일 append + emitter
│   │   │       └── skill-sync.ts   # DB → <project>/.loom/... 미러
│   │   └── test/
│   │       ├── run-lifecycle.test.ts (6 케이스)
│   │       └── specs.test.ts          (14 케이스)
│   │
│   └── web/                        # @loom/web  (Vite + React)
│       └── src/
│           ├── App.tsx             # 라우트
│           ├── api/client.ts       # 타입세이프 fetch wrapper
│           ├── context/
│           │   ├── ThemeContext.tsx
│           │   └── I18nContext.tsx
│           ├── i18n/dictionaries.ts
│           ├── components/
│           │   ├── Layout.tsx
│           │   ├── ProjectShell.tsx  # 프로젝트 헤더 + 탭
│           │   ├── PixelRoom.tsx     # 2D Canvas 사무실
│           │   ├── MissionPane.tsx   # 채팅 UI + 위임 chip
│           │   ├── AdapterFields.tsx
│           │   ├── AdapterIcon.tsx
│           │   ├── AdapterStatus.tsx
│           │   ├── AdapterTest.tsx
│           │   └── ui.tsx            # Card / Field / Badge / Button …
│           └── pages/
│               ├── ProjectsPage.tsx
│               ├── ProjectRoomPage.tsx  # Room 탭 (index)
│               ├── AgentsPage.tsx
│               ├── SpecsPage.tsx        # split MD editor
│               ├── RunsPage.tsx         # History 탭
│               └── RunDetailPage.tsx    # 풀 로그 + 자식 runs
│
└── packages/
    ├── core/                       # @loom/core  (타입 + 인터페이스)
    │   └── src/
    │       ├── types.ts            # Project/Agent/Spec/Run/...
    │       ├── adapter.ts          # CliAdapter / SpawnArgs / RunHandle
    │       ├── manifest.ts         # AdapterManifest (서버 → UI)
    │       └── index.ts
    │
    ├── adapter-utils/              # @loom/adapter-utils
    │   └── src/
    │       ├── spawn.ts            # 공통 spawn 유틸
    │       ├── define.ts           # defineCliAdapter factory
    │       ├── probe.ts            # 공통 binary/auth probe
    │       └── exec.ts
    │
    └── adapters/
        ├── claude-code/            # @loom/adapter-claude-code
        ├── gemini/                 # @loom/adapter-gemini
        ├── codex/                  # @loom/adapter-codex
        └── opencode/               # @loom/adapter-opencode
              # 각 어댑터: index.ts (~40줄) + manifest + probe + models + test
```

---

## 빠른 시작

### 사전 요건

- **Node.js ≥ 22** (LTS)
- **pnpm 10+**
- 사용할 CLI는 `PATH`에 있어야 함 (예: `claude`, `gemini`, `codex`, `opencode`)

### 설치 및 실행

```bash
git clone https://github.com/Chu5491/loom.git
cd loom
pnpm install            # better-sqlite3 네이티브 빌드 포함

pnpm dev                # 서버(:3200) + 웹(:3201) 병렬 실행
# 또는 따로:
pnpm dev:server
pnpm dev:web
```

브라우저: <http://localhost:3201>

**첫 사용 흐름:**

1. **Projects** 탭에서 프로젝트 생성 (이름 + 절대 경로)
2. 프로젝트 진입 → **Agents** 탭에서 어댑터 선택 → 모델 → 시스템 프롬프트 + 스킬 체크
3. **Skills** 탭에서 스킬 MD 작성 (없으면 skip)
4. **Room** 탭에서 캐릭터 클릭 → 오른쪽 채팅 패널에서 메시지 입력 → Send

### 테스트

```bash
pnpm -r typecheck       # 모든 워크스페이스 tsc --noEmit
pnpm -r test            # vitest (28+ 케이스)
```

### 프로덕션 빌드

```bash
pnpm -r build
# apps/web/dist 생성 (~110KB gzip JS / ~7KB gzip CSS)
```

---

## 설정 (환경 변수)

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `LOOM_PORT` | `3200` | API 서버 포트 |
| `LOOM_HOST` | `127.0.0.1` | 바인딩 호스트 (`0.0.0.0`은 인증이 없으므로 권장하지 않음) |
| `LOOM_DATA_DIR` | `~/.loom/data` | DB · 로그 루트 |

> ⚠️ 모든 데이터는 평문이며 인증이 없습니다. 로컬호스트 단일 사용자 전용입니다.

---

## 데이터 모델

```sql
projects
  id TEXT PK
  name TEXT NOT NULL
  path TEXT NOT NULL                   -- 절대 경로, 기본 cwd
  description TEXT
  created_at, updated_at TEXT

agents
  id TEXT PK
  project_id TEXT FK → projects(id) ON DELETE CASCADE
  name TEXT NOT NULL
  prompt TEXT NOT NULL                 -- 시스템 프롬프트 (인라인)
  role TEXT                            -- engineer/researcher/reviewer/writer/other
  adapter_kind TEXT NOT NULL           -- 'claude-code' | 'gemini' | …
  adapter_config TEXT NOT NULL         -- JSON: { command, model, extraArgs, env, … }
  default_cwd TEXT                     -- agent별 cwd override (옵션)
  created_at, updated_at TEXT

specs                                  -- "Skills"
  id TEXT PK
  name TEXT NOT NULL
  content TEXT NOT NULL                -- MD 본문
  agent_id TEXT FK → agents(id)        -- 선택적 1:1 owner 표기 (UX용)
  tags TEXT NOT NULL                   -- JSON array
  created_at, updated_at TEXT

agent_skills                           -- 다대다: agent ↔ spec
  agent_id TEXT, skill_id TEXT, created_at TEXT
  PRIMARY KEY (agent_id, skill_id)

runs
  id TEXT PK
  agent_id TEXT FK → agents(id) ON DELETE CASCADE
  parent_run_id TEXT FK → runs(id) ON DELETE SET NULL  -- 위임 체인
  prompt TEXT NOT NULL                 -- 사용자 원본 (composed가 아님)
  attached_spec_ids TEXT NOT NULL      -- 합성에 참여한 스킬 ID 스냅샷
  cwd TEXT NOT NULL
  status TEXT NOT NULL                 -- queued|running|succeeded|failed|cancelled
  exit_code INTEGER
  pid INTEGER
  log_path TEXT                        -- ~/.loom/data/logs/<id>.jsonl
  started_at, ended_at, created_at TEXT
```

**색인:** `idx_runs_agent`, `idx_runs_parent`, `idx_runs_status`, `idx_specs_agent`, `idx_agents_project`.

**자동 마이그레이션:** 부팅 시 `client.ts`가 `PRAGMA table_info`를 검사하여 누락된 컬럼을 idempotent하게 `ALTER TABLE`로 추가합니다.

---

## REST API

모든 응답은 JSON. 오류는 `{ error: string, issues?: zod_issues }`.

### Health

```
GET  /api/health
```

### Projects

```
GET    /api/projects
POST   /api/projects             body: { name, path, description? }
GET    /api/projects/:id
PATCH  /api/projects/:id
DELETE /api/projects/:id         → 204
```

### Agents

```
GET    /api/agents?projectId=…
POST   /api/agents               body: CreateAgentBody
GET    /api/agents/:id
PATCH  /api/agents/:id
DELETE /api/agents/:id           → 204
```

```ts
type CreateAgentBody = {
  projectId: string;
  name: string;
  prompt?: string;                 // 시스템 프롬프트
  skillIds?: string[];             // 배정할 스킬 ID들
  role?: 'engineer' | 'researcher' | 'reviewer' | 'writer' | 'other' | null;
  adapterKind: string;
  adapterConfig?: Record<string, unknown>;
  defaultCwd?: string | null;
};
```

### Specs (Skills)

```
GET    /api/specs?agentId=…
POST   /api/specs                body: { name, content, agentId?, tags? }
GET    /api/specs/:id
PATCH  /api/specs/:id
DELETE /api/specs/:id            → 204
```

> spec CRUD는 자동으로 disk 미러를 갱신합니다 — 그 spec을 가진 모든 에이전트의 `<project>/.loom/agents/<id>/skills/` 폴더가 즉시 동기화됩니다.

### Runs

```
GET    /api/runs?agentId=&status=&parentRunId=&limit=
POST   /api/runs                 body: CreateRunBody       → 201
GET    /api/runs/:id
GET    /api/runs/:id/logs        SSE stream
POST   /api/runs/:id/cancel      → 200 | 404 | 409
```

```ts
type CreateRunBody = {
  agentId: string;
  prompt: string;                  // 사용자 원본
  cwd?: string;
  parentRunId?: string | null;     // 위임 체인 표시용
  attachedSpecIds?: string[];      // 모두 agent.skillIds에 있어야 함
};
```

**핵심 보장:** `runs.prompt`에는 사용자가 친 원본이 그대로 들어가고, **CLI에는 manifest가 합쳐진 composed prompt**가 stdin/arg로 전달됩니다. composed 형식:

```
=== Agent Instructions ===
<agent.prompt>
=== End Instructions ===

=== Available Skills (read on demand) ===
These reference docs are mirrored from the loom database to disk.
Open them with your file-read tool only when relevant.

  /abs/path/.loom/agents/<id>/skills/api-conventions.md  (4.1KB)
    REST conventions overview
=== End Skills ===

<user prompt>
```

스킬 본문은 prompt에 안 들어갑니다. 첫 줄 요약과 디스크 경로만 박힙니다.

### Adapters

```
GET    /api/adapters                       모든 어댑터의 manifest 리스트
GET    /api/adapters/:kind                 단일 manifest
GET    /api/adapters/:kind/probe?command=  binary + auth 상태 (캐시됨)
GET    /api/adapters/:kind/models?command= 라이브 모델 리스트
POST   /api/adapters/:kind/test            실제로 짧게 호출해서 동작 확인
```

---

## SSE 스트리밍

`GET /api/runs/:id/logs`는 두 종류의 이벤트:

```
event: chunk
data: { ts, stream: 'stdout' | 'stderr', data: string }

event: done
data: { ts, status: 'succeeded' | 'failed' | 'cancelled', exitCode }
```

- 활성 run: 이미 emit된 chunk replay → 라이브 푸시 → done
- 종료된 run: `<runId>.jsonl` 파일에서 events 재생

---

## 어댑터 작성

`@loom/adapter-utils`의 `defineCliAdapter` factory가 보일러플레이트를 모두 처리합니다. 새 CLI 추가는 ~40줄:

```ts
// packages/adapters/<kind>/src/index.ts
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

export const xxxAdapter = defineCliAdapter<XxxConfig>({
  kind: "xxx",
  buildCommand: buildXxxCommand,
  prompt: { via: "stdin" },           // 또는 { via: "arg" } / { via: "arg", flag: "--prompt" }
  resolveEnv: (cfg) => cfg.env ?? {},
});
```

추가:
- `manifest.ts` — 어댑터 폼 필드 정의 (model 옵션, extra args 등) — UI가 자동으로 폼을 그림
- `probe.ts` — `xxx --version` + auth 상태
- `models.ts` — 라이브 모델 조회 (선택)

마지막으로 `apps/server/src/adapters/registry.ts`에 4줄 추가:

```ts
[xxxAdapter, { manifest: xxxManifest, probe: xxxProbe, listModels: xxxListModels }],
```

> 핵심 원칙: **prompt는 stdin/arg 배열로**. shell-quote 절대 X. stream-json 파싱은 어댑터가 하지 않음 (UI 책임).

각 CLI의 prompt 전달 방식:

| 어댑터 | 명령 | 인자 | prompt 전달 |
| --- | --- | --- | --- |
| `claude-code` | `claude` | `--print -` | **stdin** |
| `gemini` | `gemini` | `--prompt <text>` | **arg** |
| `codex` | `codex` | `exec [prompt]` | **arg (마지막)** |
| `opencode` | `opencode` | `run [prompt]` | **arg (마지막)** |

---

## 데이터 디렉토리 / 백업

```
~/.loom/data/
├── loom.db                    # SQLite (WAL 모드)
├── loom.db-shm
├── loom.db-wal
└── logs/
    └── <run-id>.jsonl         # JSONL chunk + done 이벤트
```

**프로젝트 디렉토리:**

```
<project.path>/.loom/
└── agents/
    └── <agent-id>/
        └── skills/
            ├── api-conventions.md
            └── code-style.md
```

스킬은 위 디렉토리에 자동 동기화됩니다. `.loom/`은 자동 gitignore되지 **않으니** 필요 시 `.gitignore`에 추가하세요.

**백업:** `loom.db` + `logs/` + 각 프로젝트의 `.loom/`. **리셋:** `~/.loom/data` 삭제 후 재시작.

---

## 국제화 / 테마

### 다국어

- 지원: **English (`en`)** · **한국어 (`ko`)**
- 우선순위: `localStorage["loom.lang"]` → `navigator.language` → `en`
- 헤더 셀렉터로 즉시 전환
- 사전: `apps/web/src/i18n/dictionaries.ts` — flat dot-key

### 테마

- 모드: **`system`** (기본) · **`light`** · **`dark`**
- `system` 모드는 OS의 `prefers-color-scheme` 실시간 추적
- `localStorage["loom.theme"]` 영속화
- FOUC 방지를 위해 `index.html`의 inline `<script>`가 React 마운트 전에 `<html class="dark">` 적용

---

## 개발

### 워크스페이스 명령

```bash
pnpm dev               # server + web 병렬
pnpm dev:server
pnpm dev:web

pnpm -r typecheck
pnpm -r test
pnpm -r build
```

### 패키지

| 이름 | 책임 | 의존성 |
| --- | --- | --- |
| `@loom/core` | 타입 + `CliAdapter` 인터페이스 | (없음) |
| `@loom/adapter-utils` | spawn / probe / defineCliAdapter | core |
| `@loom/adapter-claude-code` | Claude CLI | core, utils |
| `@loom/adapter-gemini` | Gemini CLI | core, utils |
| `@loom/adapter-codex` | Codex CLI | core, utils |
| `@loom/adapter-opencode` | OpenCode CLI | core, utils |
| `@loom/server` | Hono + SQLite + REST + SSE | core, 4 adapters |
| `@loom/web` | React + Vite UI | core |

### 코드 스타일

- TypeScript `strict`
- `*.js` import suffix (Node ESM 호환)
- 검증은 `zod`만 (외부 입력 경계에서)
- ID는 `crypto.randomUUID()` (UUID v4)
- 추상 명사(`Manager`/`Helper`/`Service`/`Factory`) 변수·클래스 이름 금지

### 테스트 전략

- **유닛**: `buildXxxCommand`, `composePrompt` 같은 순수 함수
- **통합**: `RunService` + `/bin/cat` 스폰으로 라이프사이클 + skill 디스크 미러 검증
- **E2E (manual)**: 라이브 CLI는 manual smoke만, 자동 테스트에 포함 X

---

## 보안 / 알려진 제약

- **인증 없음** — 로컬호스트 단일 사용자 전용
- **시크릿 평문 저장** — `agents.adapter_config.env`는 SQLite에 평문
- **SQL injection 안전** — 모든 쿼리는 prepared statement
- **shell injection 안전** — 사용자 입력은 shell quote 안 함, stdin 또는 spawn args 배열로만
- **prompt injection** — 위와 별개. 사용자가 첨부한 spec 내용은 LLM에 전달되므로 자명한 사용자 책임

---

## 로드맵

| 항목 | 상태 |
| --- | --- |
| 모노레포 + agents/specs/runs CRUD | ✅ |
| Claude Code 어댑터 + SSE | ✅ |
| Gemini / Codex / OpenCode 어댑터 | ✅ |
| 프로젝트 단위 격리 + 라우팅 | ✅ |
| Pixel Office Canvas | ✅ |
| 채팅식 Mission Pane + 수동 위임 | ✅ |
| 스킬 디스크 미러링 | ✅ |
| i18n + 테마 | ✅ |
| Git worktree 통합 (격리된 cwd) | ⬜ |
| Export / Import | ⬜ |
| 키보드 단축키 | ⬜ |
| OS keychain (시크릿) | ⬜ |
| 비용 추적 (응답 metadata 표시) | ⬜ |

---

## 라이선스

MIT.

---

## 크레딧

설계 영감: [Paperclip](https://github.com/paperclipai/paperclip)을 직접 사용해보고 무거움을 느낀 후 시작된 프로젝트.
[AionUI](https://github.com/iOfficeAI/AionUi)에서 픽셀 GUI 아이디어 일부 참고.
