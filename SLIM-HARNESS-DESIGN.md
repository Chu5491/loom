# Slim Harness — 초기 설계서

> 가볍고, 다중 CLI 도구를 통합하며, Web UI에서 spec MD를 관리하고 sub-agent 위임을 지원하는 개인/팀 규모 dispatcher.
>
> Paperclip의 "AI 회사" 메타포와 무거운 프롬프트 주입을 걷어내고, 본질만 남긴 thin orchestrator.

---

## 1. 목적과 비목적

### 목적 (Goals)
- **Multi-CLI 통합**: Claude Code / Gemini CLI / Codex / Cursor 등 네이티브 CLI를 Web UI에서 통합 호출
- **Sub-agent 위임**: Agent A(Claude Code)가 Agent B(Gemini)에게 sub-task를 넘기는 패턴 지원
- **Spec MD 관리**: Web UI에서 spec/instruction MD 파일을 직접 편집, agent에 attach
- **Pass-through**: CLI에 보낼 프롬프트는 사용자가 작성한 것 그대로. **자동 주입 최소화**.
- **Worktree 격리**: task별 git worktree로 작업 격리
- **개인/팀 규모**: 인증·예산·다중 회사 같은 엔터프라이즈 기능 없음

### 비목적 (Non-Goals)
- ❌ 자율 AI 회사 운영 (Paperclip의 영역)
- ❌ 인증/SSO/멀티 테넌트
- ❌ 예산/비용 추적 (있으면 좋지만 v1에서는 제외)
- ❌ 플러그인 마켓플레이스
- ❌ 자체 LLM 호출 (CLI 도구가 알아서 함)
- ❌ 보드 승인/감사 로그

---

## 2. 핵심 가치 (Paperclip과의 차별점)

| 항목 | Paperclip | Slim Harness |
|---|---|---|
| 호출당 토큰 오버헤드 | 6,000~20,000+ | **~0 (패스스루)** |
| 프롬프트 자동 주입 | bootstrap+AGENTS.md+skills+wake | **없음 (사용자 명시 시만)** |
| DB | PostgreSQL (embedded) | **sqlite (단일 파일)** |
| 코드 규모 | ~857k LOC | **~3,000 LOC 목표** |
| 학습 곡선 | 높음 ("AI 회사" 도메인) | 낮음 (CRUD + spawn) |
| upstream 머지 부담 | 매번 451커밋급 충돌 | 없음 (자체 코드) |

---

## 3. 기술 스택

```
Runtime    : Bun  (또는 Node.js 22 + tsx)
Backend    : Hono                         — 가볍고 빠른 라우터
DB         : better-sqlite3               — 단일 파일, 서버리스
Process    : node:child_process.spawn     — CLI 호출
Streaming  : SSE (Server-Sent Events)     — 로그 실시간 푸시
Frontend   : React 18 + Vite              — SPA
UI Library : shadcn/ui + Tailwind         — 기존 익숙한 스택
Editor     : @uiw/react-md-editor         — spec MD 편집
State      : TanStack Query + zustand     — 서버/클라 상태
Validation : zod                          — 런타임 타입
Worktree   : simple-git or `git` shell-out
```

**선택 이유:**
- Bun: 빠른 시작, 단일 바이너리, ts 네이티브
- Hono: Express보다 가볍고 타입세이프
- better-sqlite3: 동기 API로 단순, 백업도 파일 복사로 끝
- shadcn/ui: 컴포넌트 코드를 직접 가져오므로 커스터마이징 자유

---

## 4. 폴더 구조

```
slim-harness/
├── package.json                  # workspace 루트
├── pnpm-workspace.yaml
├── README.md
├── apps/
│   ├── server/                   # 백엔드
│   │   ├── src/
│   │   │   ├── index.ts          # Hono 앱 부트스트랩
│   │   │   ├── routes/
│   │   │   │   ├── agents.ts
│   │   │   │   ├── specs.ts
│   │   │   │   ├── runs.ts
│   │   │   │   └── health.ts
│   │   │   ├── services/
│   │   │   │   ├── runner.ts     # CLI 디스패처 (핵심)
│   │   │   │   ├── worktree.ts   # git worktree 관리
│   │   │   │   └── log-store.ts  # 로그 파일 저장/스트림
│   │   │   └── db/
│   │   │       ├── schema.sql
│   │   │       └── client.ts     # better-sqlite3 wrapper
│   │   └── package.json
│   └── web/                      # 프론트엔드
│       ├── src/
│       │   ├── pages/
│       │   │   ├── AgentsPage.tsx
│       │   │   ├── SpecsPage.tsx
│       │   │   ├── RunsPage.tsx
│       │   │   └── RunDetailPage.tsx
│       │   ├── components/
│       │   ├── api/              # fetch wrappers
│       │   └── App.tsx
│       └── package.json
├── packages/
│   ├── core/                     # 공유 타입, 인터페이스
│   │   └── src/
│   │       ├── types.ts          # Agent, Spec, Run, Adapter 등
│   │       └── adapter.ts        # CliAdapter 인터페이스
│   └── adapters/
│       ├── claude-code/
│       ├── gemini/
│       ├── codex/
│       └── cursor/               # 각 어댑터 = 작은 모듈
└── data/                         # gitignored
    ├── slim.db                   # sqlite
    ├── worktrees/                # git worktree 루트
    └── logs/                     # run 로그 파일
```

---

## 5. 데이터 모델 (sqlite 스키마)

```sql
-- 에이전트: "이 역할은 어떤 CLI를 쓴다"
CREATE TABLE agents (
  id              TEXT PRIMARY KEY,           -- uuid
  name            TEXT NOT NULL,              -- "Backend Engineer"
  role            TEXT,                       -- "engineer" | "researcher" | ...
  adapter_kind    TEXT NOT NULL,              -- "claude-code" | "gemini" | ...
  adapter_config  TEXT NOT NULL DEFAULT '{}', -- JSON: { command, args, env, model, ... }
  default_cwd     TEXT,                       -- 기본 작업 디렉토리
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- Spec MD: agent에 attach 가능한 instruction/spec 문서
CREATE TABLE specs (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,                  -- 파일명/제목
  content     TEXT NOT NULL,                  -- MD 본문
  agent_id    TEXT REFERENCES agents(id),     -- 선택적 기본 연결
  tags        TEXT NOT NULL DEFAULT '[]',     -- JSON array
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Run: 한 번의 CLI 실행
CREATE TABLE runs (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL REFERENCES agents(id),
  spec_id         TEXT REFERENCES specs(id),
  parent_run_id   TEXT REFERENCES runs(id),   -- sub-agent 위임 시
  prompt          TEXT NOT NULL,              -- 사용자 입력 (그대로 CLI에 전달)
  cwd             TEXT NOT NULL,
  worktree_id     TEXT,                       -- worktree 사용 시
  status          TEXT NOT NULL,              -- queued|running|succeeded|failed|cancelled
  exit_code       INTEGER,
  pid             INTEGER,
  log_path        TEXT,                       -- data/logs/<run_id>.log
  started_at      TEXT,
  ended_at        TEXT,
  created_at      TEXT NOT NULL
);

-- Worktree: git worktree 트래킹 (선택적)
CREATE TABLE worktrees (
  id          TEXT PRIMARY KEY,
  repo_path   TEXT NOT NULL,                  -- 원본 저장소
  path        TEXT NOT NULL UNIQUE,           -- worktree 경로
  branch      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_runs_agent ON runs(agent_id);
CREATE INDEX idx_runs_parent ON runs(parent_run_id);
CREATE INDEX idx_runs_status ON runs(status);
CREATE INDEX idx_specs_agent ON specs(agent_id);
```

---

## 6. 핵심 추상화: CliAdapter

```typescript
// packages/core/src/adapter.ts

export interface SpawnArgs {
  prompt: string;          // 사용자 입력 — 가공 없이 CLI로 전달
  cwd: string;             // 작업 디렉토리 (worktree 또는 default)
  env: Record<string, string>;
  attachedSpecs?: string[]; // attached spec 파일 경로 (선택, CLI에 --file 등으로 전달)
  signal?: AbortSignal;
  onStdout: (chunk: string) => void;
  onStderr: (chunk: string) => void;
}

export interface RunHandle {
  pid: number;
  promise: Promise<{ exitCode: number; signal: string | null }>;
  kill: () => void;
}

export interface CliAdapter {
  kind: string;                                      // "claude-code"
  buildCommand(config: AdapterConfig): {             // CLI 명령어/args 빌드
    command: string;
    args: string[];
  };
  spawn(args: SpawnArgs, config: AdapterConfig): Promise<RunHandle>;
}

export interface AdapterConfig {
  command?: string;                                  // 기본값: 어댑터별 정의 (e.g. "claude")
  extraArgs?: string[];
  env?: Record<string, string>;
  model?: string;
  // 어댑터별 추가 필드는 자유
}
```

**어댑터 구현 예시 (claude-code):**

```typescript
// packages/adapters/claude-code/src/index.ts
import { spawn } from "node:child_process";
import type { CliAdapter, SpawnArgs } from "@slim-harness/core";

export const claudeCodeAdapter: CliAdapter = {
  kind: "claude-code",
  buildCommand(config) {
    const command = config.command ?? "claude";
    const args = ["--print", "--output-format", "stream-json", "--verbose"];
    if (config.model) args.push("--model", config.model);
    args.push(...(config.extraArgs ?? []));
    return { command, args };
  },
  async spawn(args, config) {
    const { command, args: cmdArgs } = this.buildCommand(config);
    const proc = spawn(command, cmdArgs, {
      cwd: args.cwd,
      env: { ...process.env, ...args.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    proc.stdin.write(args.prompt);
    proc.stdin.end();
    proc.stdout.on("data", (b) => args.onStdout(b.toString()));
    proc.stderr.on("data", (b) => args.onStderr(b.toString()));
    return {
      pid: proc.pid!,
      promise: new Promise((resolve) => {
        proc.on("exit", (code, signal) => resolve({ exitCode: code ?? -1, signal }));
      }),
      kill: () => proc.kill("SIGTERM"),
    };
  },
};
```

---

## 7. API 엔드포인트

```
# Agents
GET    /api/agents
POST   /api/agents
GET    /api/agents/:id
PATCH  /api/agents/:id
DELETE /api/agents/:id

# Specs (MD 파일)
GET    /api/specs
POST   /api/specs
GET    /api/specs/:id
PATCH  /api/specs/:id              # MD 본문 수정
DELETE /api/specs/:id

# Runs
POST   /api/runs                   # body: { agentId, prompt, specIds?, cwd?, parentRunId? }
GET    /api/runs                   # ?agentId=&status=&limit=
GET    /api/runs/:id
GET    /api/runs/:id/logs          # SSE — 실시간 stdout/stderr
POST   /api/runs/:id/cancel
POST   /api/runs/:id/delegate      # body: { agentId, prompt, specIds? }
                                   #   → 새 run을 parent_run_id=:id 로 생성

# Worktrees (선택)
POST   /api/worktrees              # body: { repoPath, branch }
DELETE /api/worktrees/:id

GET    /api/health
```

---

## 8. UI 화면

### 8.1 Agents
- 카드 그리드: 각 agent 카드 = 이름, role, adapter kind 배지
- 클릭 시 세부 — adapter_config 폼 (command, args, model, env)
- "Test run" 버튼으로 즉석 호출 가능

### 8.2 Specs
- 좌측: spec 목록 (검색/태그)
- 우측: MD 에디터 (live preview)
- "Attach to agent" 드롭다운

### 8.3 Runs
- 목록: status 필터, agent 필터
- 트리 뷰: parent_run_id로 sub-agent 위임 트리 표시 (들여쓰기)

### 8.4 Run Detail
- 상단: agent + prompt + attached specs + cwd
- 중단: **실시간 로그 스트림 (SSE)**
- 하단: "Delegate to..." 버튼 — 다른 agent로 sub-task 위임

---

## 9. Pass-through 프롬프트 전략 (핵심 차별점)

CLI에 보내는 입력 = **사용자가 작성한 prompt + 명시적으로 attach한 spec 파일들**.

**자동 주입 절대 금지 항목:**
- ❌ Bootstrap 프롬프트
- ❌ AGENTS.md 자동 포함
- ❌ Skill 번들 자동 포함
- ❌ Continuation summary 자동 추가
- ❌ 회사/조직 메타데이터

**Sub-agent 위임 시 전달되는 컨텍스트:**
```typescript
{
  task: string,                    // 부모가 명시적으로 작성
  parentBrief?: string,            // 선택: 부모 run의 짧은 요약 (사용자가 토글)
  attachedSpecIds?: string[],
}
```
→ 토큰 오버헤드는 **부모가 명시적으로 넘긴 만큼만**.

---

## 10. Paperclip에서 가져올 코드 (참고용)

| Paperclip 경로 | 용도 |
|---|---|
| `packages/adapters/claude-local/src/server/execute.ts` (line 497-516) | claude args 빌드 로직만 |
| `packages/adapters/codex-local/src/server/execute.ts` | codex 어댑터 패턴 |
| `packages/adapters/gemini-local/src/server/execute.ts` | gemini 어댑터 패턴 |
| `packages/adapter-utils/src/server-utils.ts` (`runChildProcess`) | child_process spawn helper |
| `cli/src/commands/worktree-lib.ts` | git worktree 프로비저닝 |
| `packages/db/src/migrations/*.sql` | 일부 인덱스 패턴 참고 |

**가져오지 말 것:**
- ⚠️ `buildClaudeRuntimeConfig` 전체 (프롬프트 자동 조립 로직)
- ⚠️ heartbeat 큐 (과한 추상화)
- ⚠️ Skills 시스템
- ⚠️ Plugin SDK

---

## 11. MVP 마일스톤 (2주 계획)

### Week 1
1. **Day 1-2**: 모노레포 부트스트랩, sqlite 스키마, `agents` CRUD
2. **Day 3**: `CliAdapter` 인터페이스 + `claude-code` 어댑터 1개
3. **Day 4**: `runs` 엔드포인트 + 로그 파일 저장 + SSE 스트리밍
4. **Day 5**: 최소 UI — agents 페이지 + 1회 run + 로그 보기

### Week 2
5. **Day 6-7**: `specs` 엔드포인트 + MD 에디터 UI
6. **Day 8**: 어댑터 추가 (gemini, codex)
7. **Day 9**: Sub-agent 위임 (delegate API + 트리 UI)
8. **Day 10**: Worktree 통합

### Stretch (v1.1+)
- Run 재실행/cancel
- 비용 추적 (선택)
- 키보드 단축키
- 다크 모드
- Export/Import (agent + spec 백업)

---

## 12. 운영 모드

```bash
# 개발
bun dev               # 서버 + UI 동시 실행

# 프로덕션 (단일 머신)
bun build             # UI를 server static으로 빌드
bun start             # 단일 바이너리 실행
                      # → http://localhost:3200
```

데이터: `~/.slim-harness/data/` (config 파일에서 변경 가능)
- `slim.db` — sqlite
- `worktrees/` — git worktree 루트
- `logs/<run_id>.log` — run 로그

---

## 13. 보안/실행 환경 가정

- **단일 사용자, localhost 전용** — 인증 없음
- **로컬 머신 신뢰** — `claude`, `gemini` 등 PATH에서 찾음
- 환경변수는 agent별 `adapter_config.env`에 plain text 저장 (시크릿 관리는 OS keychain은 v1.1+)

---

## 14. 다음 단계 (이 문서를 받은 AI에게)

이 문서를 신규 프로젝트 디렉토리에서 봤다면:

1. **먼저 사용자에게** 프로젝트 이름과 디렉토리 위치 확인
2. **`pnpm init` + workspace 셋업**, 위 폴더 구조 생성
3. **MVP Day 1-2부터** 단계적으로 구현 (한 번에 다 만들지 말 것)
4. **각 Day 완료 시점에** 사용자에게 동작 확인 요청
5. **어댑터는 `claude-code`부터** — 사용자가 가장 자주 쓰는 도구
6. **UI는 shadcn/ui CLI**로 컴포넌트 추가 (`pnpm dlx shadcn@latest add button card input` 등)

**원칙:**
- 추가 의존성은 꼭 필요할 때만
- 모든 기능은 "Paperclip은 어떻게 했는데 우리는 더 가볍게 어떻게 할까?"를 물을 것
- 자동 주입은 절대 추가하지 말 것 — 사용자가 명시적으로 요청해야만

---

## 15. 참고 링크

- Paperclip 저장소 (참고용): https://github.com/paperclipai/paperclip
- Hono: https://hono.dev
- shadcn/ui: https://ui.shadcn.com
- better-sqlite3: https://github.com/WiseLibs/better-sqlite3
- TanStack Query: https://tanstack.com/query

---

**작성**: 2026-04-27
**버전**: v0.1 (초기 설계)
**다음 개정**: MVP Week 1 종료 후 학습 내용 반영
