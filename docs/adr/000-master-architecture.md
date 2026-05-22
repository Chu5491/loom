# ADR-000: 마스터 아키텍처 설계서

> **상태:** 합의 완료 (2026-05-22)
> **작성일:** 2026-05-22
> **범위:** 9대 커스터마이징 컨셉 + 전체 SDLC 커버리지

---

## 제품 비전

```
┌─────────────────────────────────────────────────────────────────────┐
│                         loom (리브랜딩 가능)                         │
│                                                                     │
│   사용자 PC의 CLI 코딩 에이전트를 하나의 워크스페이스에 통합하고,     │
│   전체 개발 라이프사이클을 커버하는 AI 개발 플랫폼                    │
│                                                                     │
│   통합 ──→ 개발 ──→ 리뷰 ──→ 추적 ──→ 배포                         │
│                                                                     │
│   Mac · Windows · Linux · Web · Electron 네이티브 앱                │
└─────────────────────────────────────────────────────────────────────┘
```

**정체성 원칙 (불변):**
1. CLI는 CLI 그대로 — loom은 그들이 공유하는 방
2. 자동 주입은 죄 — 사용자가 명시한 것만 CLI에 도달
3. 네이티브 세션 이어가기 — 가짜 래퍼/메모리 시뮬레이션 금지
4. Loadout-pointer 패턴 — Skill 본문은 디스크, 프롬프트엔 인덱스만

---

## Phase 로드맵 총괄

| Phase | 이름 | 핵심 산출물 | SDLC 단계 |
|-------|------|------------|-----------|
| **P0** | 기반 안정화 | 어댑터 4종 안정 + Windows 호환 + 정책 경고 | 통합 |
| **P1** | 협업 코어 | 멀티에이전트 Thread + 서브에이전트 위임 | 개발 |
| **P2** | 리뷰 & 추적 | 코드 리뷰 워크플로우 + 토큰/비용 세분화 + FTS5 | 리뷰 + 추적 |
| **P3** | 배포 파이프라인 | PR 자동 생성 + CI 연동 + 배포 트리거 | 배포 |
| **P4** | 플랫폼 완성 | Electron 앱 + UI/UX 전면 리디자인 + Rule 계층 | 전체 |
| **P5** | 확장 | 멀티유저 auth + 팀 대시보드 + 어댑터 자동 검출 | 전체 |

---

## Part 1 — 통합 (Integration)

### 1.1 어댑터 아키텍처 확장

**현재:** 4개 어댑터 (claude-code ✅, gemini 🟡, codex 🟡, opencode 🟡)

**목표 아키텍처:**

```
packages/core/src/types.ts
  AdapterKind 확장:
    현재: "claude-code" | "gemini" | "codex" | "opencode"
    목표: "claude-code" | "gemini" | "antigravity" | "codex" | "opencode"
          (향후: "aider" | "goose" | "cursor-cli" | "custom")
```

**Antigravity CLI 어댑터 (신규 — P0):**

Gemini CLI가 2026-06-18부 Antigravity CLI로 전환됨에 따라 선제 대응.

```
packages/adapters/antigravity/
├── src/
│   ├── index.ts          # buildAntigravityCommand + extractors
│   ├── index.test.ts
│   ├── manifest.ts       # UI 폼 필드
│   ├── models.ts         # 모델 목록
│   ├── probe.ts          # 바이너리 + 인증 탐지
│   └── preset-models.ts
└── package.json
```

설계 원칙:
- Gemini 어댑터의 코드를 복사하지 말 것 — CLI 출력 포맷이 다를 수 있음
- Antigravity CLI의 공식 문서/릴리스를 확인 후 구현
- Go 기반 CLI → 바이너리 탐지 패턴이 다를 수 있음 (probeBinary 조정)

**Gemini 어댑터 정책 경고 (P0):**

```typescript
// packages/core/src/manifest.ts — 신규 필드 추가
export interface AdapterManifest {
  // ... 기존 필드 ...
  /** 정책 경고. UI가 에이전트 생성 시 노란 배너로 표시. */
  policyWarnings?: PolicyWarning[];
}

export interface PolicyWarning {
  severity: "info" | "warning" | "danger";
  title: string;
  body: string;
  /** 외부 링크 (약관 페이지 등) */
  url?: string;
}
```

Gemini 어댑터 매니페스트에 추가:
```typescript
policyWarnings: [{
  severity: "danger",
  title: "Service transition",
  body: "Gemini CLI is transitioning to Antigravity CLI on 2026-06-18. "
      + "Google's ToS restricts third-party software from accessing Gemini CLI services. "
      + "Use your own API key and review Google's current terms before proceeding.",
  url: "https://google-gemini.github.io/gemini-cli/docs/tos-privacy.html",
}]
```

### 1.2 크로스플랫폼 호환 (P0)

**Windows 차단 이슈 6건 수정 계획:**

| # | 파일 | 변경 | 영향 범위 |
|---|------|------|----------|
| 1 | `scripts/dev.sh` | Node 기반 `scripts/dev.mjs` 추가. package.json에서 플랫폼 감지 후 분기 | 개발 워크플로우 |
| 2 | `services/git-snapshot.ts:69` | `execFile("rm", ...)` → `fs.promises.unlink()` | Git 스냅샷 |
| 3 | `services/open-in-editor.ts:45` | `process.env.HOME` → `os.homedir()` | IDE 실행 |
| 4 | `adapters/opencode/index.ts:64` | XDG_CONFIG_HOME → 플랫폼별 config 경로 | OpenCode |
| 5 | `adapter-utils/spawn.ts` | SIGTERM → 플랫폼 감지 + taskkill 대체 | 전체 프로세스 관리 |
| 6 | `adapter-utils/probe.ts` | PATHEXT 환경변수로 .exe/.cmd 탐색 | 전체 어댑터 프로브 |

### 1.3 BYOK (Bring Your Own Key) 인증 모델 (P0)

```
현재: agent.adapterConfig.env에 API 키 저장 (JSON, 평문)
       ↓ 문제: 여러 에이전트에 같은 키 반복 설정

목표: 프로젝트 레벨 API 키 관리
       project_env 테이블 활용 (이미 존재)
       에이전트는 프로젝트 env를 상속, 필요 시 오버라이드
       UI에서 "API Keys" 전용 설정 섹션
```

**인증 흐름 우선순위:**
```
에이전트 adapterConfig.env  (최우선 — 에이전트별 오버라이드)
  → 프로젝트 project_env    (프로젝트 공유)
    → 시스템 환경변수         (머신 전역)
```

---

## Part 2 — 개발 (Development)

### 2.1 멀티에이전트 Thread (컨셉 5 — P1)

**현재 모델의 한계:**
```
Thread → Run → Agent (1:N:1)
한 Thread에서 한 번에 한 Agent만 실행 가능
```

**목표 모델:**
```
Thread → Run → Agent (N:N)
한 Thread에서 여러 Agent가 동시에 또는 순차적으로 응답
@mention으로 특정 Agent 지정
```

**DB 스키마 변경:**

```sql
-- threads 테이블은 변경 없음 (Thread는 컨테이너)
-- agents 테이블에 @mention 이름 추가
ALTER TABLE agents ADD COLUMN mention_name TEXT;
-- e.g. "claude", "gemini", "codex" — UI에서 @claude 로 호출

-- 신규: thread_agents (Thread에 참여 가능한 Agent 목록)
CREATE TABLE thread_agents (
  thread_id  TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  joined_at  TEXT NOT NULL,
  PRIMARY KEY (thread_id, agent_id)
);
```

**@mention 라우팅 설계:**

```
사용자 입력: "@claude 이 함수 리팩터링해줘, @gemini 테스트 코드 작성해줘"
                │
                ▼
         prompt-router.ts (신규)
                │
    ┌───────────┼───────────┐
    ▼           ▼           ▼
  @claude     @gemini     (기본 에이전트)
  Run A       Run B       (mention 없는 부분)
    │           │
    └─────┬─────┘
          ▼
    같은 Thread에 병렬 Run으로 기록
    UI에서 시간순으로 인터리빙 표시
```

**prompt-router 규칙:**
1. `@agent` mention이 있으면 → 해당 에이전트로 라우팅
2. mention이 여러 개면 → prompt를 분할하여 각 에이전트에게 해당 부분만 전달
3. mention이 없으면 → Thread의 기본 에이전트(첫 번째 등록)로 전달
4. `@all` 또는 `@everyone` → 모든 참여 에이전트에게 동일 prompt 전달

**컨텍스트 공유:**
```
Thread 내 Run A(claude)의 결과를 Run B(gemini)가 참조하려면:
  옵션 1: Thread contextBundle에 A의 요약 자동 추가 (사용자 토글)
  옵션 2: B의 prompt에 "Run A 결과 참조: GET /api/runs/{A}/result" 포인터만 전달
  옵션 3: 사용자가 명시적으로 A의 결과를 B에게 복사
  
  → 옵션 2 채택 (정체성 원칙: 자동 주입 금지)
  → 옵션 1은 사용자가 명시적으로 켤 수 있는 토글로 제공
```

### 2.2 서브에이전트 위임 완성 (컨셉 7 — P1)

**현재:** DB 스키마 + UI 컴포넌트만 존재, 실제 동작 미구현

**목표:** Agent A의 Task 도구 호출 → 자동 감지 → Agent B child run 생성 → 결과 피드백

**구현 3단계:**

**Step 1 — 어댑터별 Delegation 감지:**

```typescript
// packages/core/src/adapter.ts — 신규 인터페이스
export interface DelegationAttempt {
  /** Task tool 이름 (e.g. "TaskCreate", "Agent", "spawn_agent") */
  toolName: string;
  /** 위임할 작업 설명 */
  taskDescription: string;
  /** 대상 에이전트 이름/ID (파싱 가능한 경우) */
  targetAgentHint?: string;
}

export interface CliAdapter {
  // ... 기존 메서드 ...
  /** stdout chunk에서 위임 시도를 감지. */
  extractDelegationAttempts?(chunk: string): DelegationAttempt[];
}
```

각 어댑터 구현:
```
claude-code: Agent tool의 subagent_type, description, prompt 파싱
gemini:      자체 sub-agent 패턴 확인 (Antigravity에서 변경 가능)
codex:       agent_message 아이템 타입 감지
opencode:    task/skill 도구 호출 감지
```

**Step 2 — Run-service 통합:**

```typescript
// services/run/delegation-tapper.ts (신규)
export function makeDelegationTapper(
  parentRunId: string,
  adapter: CliAdapter,
  projectAgents: Agent[],  // 프로젝트 내 사용 가능한 에이전트 목록
) {
  return {
    tap(chunk: string) {
      const attempts = adapter.extractDelegationAttempts?.(chunk) ?? [];
      for (const attempt of attempts) {
        // 1. DB에 delegation 기록 (status: pending)
        const delegationId = recordDelegation({
          parentRunId,
          taskDescription: attempt.taskDescription,
          targetAgentName: attempt.targetAgentHint,
          initiatedAt: new Date().toISOString(),
        });

        // 2. 대상 에이전트 매칭
        const target = resolveTargetAgent(attempt.targetAgentHint, projectAgents);
        if (!target) {
          completeDelegation(delegationId, {
            status: "failed",
            resultSummary: "No matching agent found",
          });
          continue;
        }

        // 3. Child run 생성 (같은 Thread에서)
        startRun({
          agentId: target.id,
          prompt: attempt.taskDescription,
          parentRunId,
          // threadId는 parent run의 thread를 상속
        }).then(result => {
          if (result.ok) {
            completeDelegation(delegationId, {
              status: "running",
              childRunId: result.run.id,
            });
          }
        });
      }
    }
  };
}
```

**Step 3 — 결과 파이프백:**

```
Child Run 완료 시:
  1. completeDelegation(id, { status: "succeeded", resultSummary })
  2. Parent Run이 아직 활성이면:
     - 결과를 Parent의 stdin으로 주입? → 불가 (대부분 CLI가 지원 안 함)
     - 결과를 Thread contextBundle에 추가 → 다음 Turn에서 참조 가능
  3. UI에서 실시간 표시:
     - LiveView 활동 스트림에 "⤳ Agent B completed: {summary}"
     - HandoffGraph 트리에 child run 연결
```

### 2.3 Rule/Skill/MCP 통합 관리 (컨셉 4 — P1)

**Rule 계층 구조:**

```
Global Rule (loom_settings.global_rule)
  ↓ 상속
Project Rule (신규: projects.project_rule)
  ↓ 상속
Agent Rule (agents.prompt)
  ↓ 상속
Thread Rule (threads.context_bundle)
  ↓ 최종 조합
Run Prompt = [Global] + [Project] + [Agent] + [Thread] + [User Input]
```

```sql
-- 마이그레이션: projects 테이블에 project_rule 추가
ALTER TABLE projects ADD COLUMN project_rule TEXT NOT NULL DEFAULT '';
```

prompt-composer 수정:
```
현재: globalRule + agentPrompt + threadContext + loadout + userPrompt
목표: globalRule + projectRule + agentPrompt + threadContext + loadout + userPrompt
```

**CLI별 Rule 파일 동기화:**
```
각 CLI는 자체 Rule 파일을 가짐:
  claude → CLAUDE.md
  gemini → GEMINI.md (향후 Antigravity)
  codex  → codex.md / .codexrc
  opencode → 자체 config

loom의 Rule을 각 CLI의 네이티브 Rule 파일로 동기화하는 옵션:
  1. "Sync to CLI" 버튼 — loom Rule → CLI 파일에 기록
  2. "Import from CLI" 버튼 — CLI 파일 → loom Rule로 가져오기
  3. 양방향 동기화는 충돌 위험 → 단방향만 지원
```

---

## Part 3 — 리뷰 (Review)

### 3.1 코드 리뷰 워크플로우 (컨셉 3 — P2)

**목표:** 사람이 AI 작업 결과를 쉽게 리뷰하고 피드백할 수 있는 체계

**Run 리뷰 상태 추가:**

```sql
-- runs 테이블에 review 상태 추가
ALTER TABLE runs ADD COLUMN review_status TEXT DEFAULT NULL;
-- NULL: 리뷰 대상 아님 | 'pending': 리뷰 대기 | 'approved' | 'changes_requested' | 'rejected'

ALTER TABLE runs ADD COLUMN review_note TEXT DEFAULT NULL;
-- 리뷰어의 코멘트
```

**인라인 diff 코멘트:**

```sql
CREATE TABLE run_comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  path       TEXT NOT NULL,           -- 파일 경로
  line       INTEGER,                 -- 라인 번호 (NULL이면 파일 전체 코멘트)
  side       TEXT DEFAULT 'after',    -- 'before' | 'after' (diff의 어느 쪽)
  body       TEXT NOT NULL,           -- 마크다운 코멘트
  status     TEXT DEFAULT 'open',     -- 'open' | 'resolved'
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX idx_run_comments_run ON run_comments(run_id);
```

**리뷰 UI 흐름:**

```
1. Run 완료 → 자동으로 review_status = 'pending' (설정으로 토글 가능)
2. 리뷰 페이지 (RunDetailPage 확장):
   - 변경 파일 목록 (run_changes)
   - 파일별 side-by-side diff (Monaco)
   - diff 라인 클릭 → 인라인 코멘트 입력
   - "Approve" / "Request Changes" / "Reject" 버튼
3. 대시보드에 "리뷰 대기 N건" 배지
```

**Run 요약 자동 생성:**
```
Run 완료 시 (성공한 경우):
  1. run 로그에서 마지막 result 이벤트의 텍스트 추출 (이미 GET /runs/:id/result)
  2. run_changes에서 변경 파일 요약 생성
  3. 이를 조합하여 run.summary 필드에 저장
  4. 리뷰어가 한눈에 "이 run이 뭘 했는지" 파악 가능
```

### 3.2 로그 전문 검색 (P2)

```sql
-- FTS5 가상 테이블
CREATE VIRTUAL TABLE run_logs_fts USING fts5(
  run_id UNINDEXED,
  content,
  tokenize = 'unicode61'
);

-- 인덱싱: run 완료 시 로그 파일의 텍스트 부분을 FTS에 삽입
-- 검색: GET /api/runs/search?q=<query>&projectId=<id>
```

---

## Part 4 — 추적 (Tracking)

### 4.1 토큰/비용 세분화 (컨셉 2 — P2)

**현재:** `run.cost_usd` (총액만)

**목표:**

```sql
-- runs 테이블에 토큰 세분화 컬럼 추가
ALTER TABLE runs ADD COLUMN input_tokens INTEGER;
ALTER TABLE runs ADD COLUMN output_tokens INTEGER;
ALTER TABLE runs ADD COLUMN cache_read_tokens INTEGER;
ALTER TABLE runs ADD COLUMN cache_write_tokens INTEGER;
-- cost_usd는 유지 (총액)
```

**어댑터별 토큰 추출:**

```typescript
// packages/core/src/adapter.ts — 신규
export interface UsageMetrics {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalCostUsd?: number;
}

export interface CliAdapter {
  // ... 기존 ...
  extractUsage?(chunk: string): UsageMetrics | null;
}
```

각 어댑터:
```
claude-code: type:"result" → usage.input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens
codex:       turn.completed → usage (input_tokens, output_tokens)
gemini:      type:"result" → usageMetadata
opencode:    이벤트에서 추출
```

**Cost Dashboard UI (신규 페이지):**

```
/projects/:id/costs
  ├── 기간 필터 (일/주/월/전체)
  ├── 요약 카드: 총비용, 총토큰, 평균 run 비용
  ├── 에이전트별 비용 차트 (bar chart)
  ├── 모델별 비용 차트
  ├── 일별 추세 (line chart)
  └── 비용 상위 Run 목록 (테이블)
```

### 4.2 에디터 연동 추적 (P4)

```
목표: 어떤 IDE에서 어떤 파일을 봤는지 추적
방법: 
  1. "Open in IDE" 클릭 로그 기록
  2. (향후) VS Code Extension으로 파일 열기 이벤트 수집
  3. 에이전트가 만진 파일 vs 사람이 본 파일 교차 분석
```

---

## Part 5 — 배포 (Deployment)

### 5.1 PR 자동 생성 (P3)

**설계:**

```typescript
// services/pr-service.ts (신규)
export interface CreatePRInput {
  projectId: string;
  threadId: string;          // Thread의 worktree에서 push
  title: string;
  body: string;
  baseBranch?: string;       // 기본: main/master
  draft?: boolean;
  /** 자동 첨부할 정보 */
  includeRunSummary?: boolean;  // 관련 Run들의 요약
  includeCostSummary?: boolean; // 총 비용
  includeFileChanges?: boolean; // 변경 파일 목록
}

export interface CreatePRResult {
  ok: boolean;
  prUrl?: string;
  prNumber?: number;
  error?: string;
}
```

**흐름:**
```
1. Thread의 worktree에서 작업 완료
2. 사용자가 "Create PR" 클릭
3. 서버:
   a. Thread의 모든 Run에서 변경 요약 수집
   b. 비용 합산
   c. PR body 자동 생성:
      ## Summary
      - Run 1 (claude-code): 함수 리팩터링 ($0.15)
      - Run 2 (gemini): 테스트 작성 ($0.08)
      
      ## Changes
      - src/auth.ts (+45 -12)
      - test/auth.test.ts (new, +120)
      
      ## Cost
      Total: $0.23 (3 runs)
      
   d. `gh pr create` 또는 Git API로 PR 생성
4. PR URL을 Thread에 연결
```

```sql
-- threads 테이블에 PR 연결 추가
ALTER TABLE threads ADD COLUMN pr_url TEXT;
ALTER TABLE threads ADD COLUMN pr_number INTEGER;
ALTER TABLE threads ADD COLUMN pr_status TEXT; -- 'open' | 'merged' | 'closed'
```

### 5.2 CI 연동 (P3)

```
PR 생성 후:
  1. GitHub Actions / GitLab CI 상태 폴링
  2. CI 결과를 Thread에 표시
  3. CI 실패 시 → 에이전트에게 자동으로 수정 요청 (사용자 승인 후)

GET /api/threads/:id/ci-status → { checks: [...], overall: "success" | "failure" | "pending" }
```

---

## Part 6 — UI/UX 전면 개선 (컨셉 6 — P4)

### 6.1 디자인 시스템 구축

**현재 문제:**
- 단일 모노스페이스 폰트 (CommitMonoChu)
- 색상이 styles.css에 하드코딩
- Storybook 없음
- 모바일 반응형 없음

**목표 디자인 시스템:**

```
apps/web/src/design/
├── tokens/
│   ├── colors.ts     # OKLCH 시맨틱 토큰 (primary, surface, text 등)
│   ├── typography.ts  # 서체 스케일 (heading, body, code, caption)
│   ├── spacing.ts     # 4px 기반 스케일
│   ├── radius.ts      # 모서리 반경
│   └── shadows.ts     # 그림자 레벨
├── primitives/        # 기본 컴포넌트 (Button, Input, Card 등)
├── patterns/          # 복합 패턴 (DataTable, CommandPalette 등)
└── layouts/           # 레이아웃 시스템 (Shell, Panel, Split 등)
```

**서체 전략:**
```css
/* 코드: 기존 모노스페이스 유지 */
--font-code: "CommitMonoChu", "SF Mono", "Fira Code", monospace;

/* 본문: 시스템 sans-serif (번들 크기 0) */
--font-sans: "Inter", system-ui, -apple-system, sans-serif;

/* 헤딩: 약간의 개성 */
--font-heading: "Inter", system-ui, sans-serif;
  /* 또는 "Pretendard" (한국어 최적화) + "Inter" 조합 */
```

**반응형 브레이크포인트:**
```
sm:  640px  (모바일)
md:  768px  (태블릿)
lg:  1024px (작은 데스크톱)
xl:  1280px (기본 데스크톱)
2xl: 1536px (넓은 모니터)
```

### 6.2 핵심 UI 개선 영역

**네비게이션 개편:**
```
현재: ActivityBar (48px 아이콘 레일) + ActivityPanel
목표: 
  - 좌: 고정 사이드바 (프로젝트/에이전트/Thread 트리)
  - 중: 메인 콘텐츠 (채팅/에디터/diff)
  - 우: 컨텍스트 패널 (파일 트리, Git 상태, 활성 에이전트)
  - 하: 상태 바 (활성 run 수, 총 비용, Git 브랜치)
```

**온보딩 플로우:**
```
첫 실행 시:
  1. "Welcome to loom" → CLI 도구 자동 감지 (PATH 스캔)
  2. 발견된 CLI 표시 + API 키 설정 안내
  3. 첫 프로젝트 추가 (로컬 경로 또는 Git URL)
  4. 첫 에이전트 생성 (추천 설정 제공)
  5. 첫 채팅 시작
```

---

## Part 7 — Electron 앱 (컨셉 8 — P4)

### 7.1 아키텍처

```
loom-desktop/
├── electron/
│   ├── main.ts          # Electron main process
│   │   ├── 내장 서버 fork (apps/server)
│   │   ├── 트레이 아이콘 (활성 run 표시)
│   │   └── 자동 업데이트 (electron-updater)
│   ├── preload.ts       # contextBridge
│   └── window.ts        # BrowserWindow 관리
├── forge.config.ts      # Electron Forge 빌드 설정
└── package.json
```

**빌드 타겟:**
```
macOS:   .dmg (Universal: x64 + arm64)
Windows: .exe (NSIS installer) + portable .zip
Linux:   .AppImage + .deb + .rpm
```

**better-sqlite3 네이티브 모듈:**
```
electron-rebuild로 타겟 Electron 버전에 맞춰 리빌드
또는 @electron/rebuild 사용
플랫폼별 pre-built 바이너리 포함
```

**서버 임베딩:**
```
Electron main process에서:
  1. fork("apps/server/src/index.ts") — 별도 프로세스로
  2. 임의 포트 할당 (LOOM_PORT=0 → OS 자동 선택)
  3. 서버 준비 완료 메시지 수신 후 BrowserWindow 로드
  4. 앱 종료 시 서버 프로세스 graceful shutdown
```

### 7.2 자동 업데이트

```
electron-updater + GitHub Releases
  1. 앱 시작 시 최신 버전 확인
  2. 백그라운드 다운로드
  3. "새 버전 사용 가능" 알림
  4. 사용자 승인 후 재시작 + 업데이트 적용
```

---

## Part 8 — 확장 (P5)

### 8.1 멀티유저 auth

```
better-auth 또는 lucia-auth 도입
  - 로컬 username/password
  - GitHub OAuth (선택)
  - 세션 관리
  - 프로젝트별 권한 (owner, editor, viewer)
```

### 8.2 어댑터 자동 검출

```
서버 시작 시:
  1. PATH 스캔으로 설치된 CLI 도구 목록화
  2. 각 CLI에 probeBinary() 실행
  3. 사용 가능한 어댑터 자동 활성화
  4. UI에 "발견된 도구" 표시
```

---

## 기술적 결정 사항 요약

| 결정 | 선택 | 이유 |
|------|------|------|
| 네이티브 앱 | Electron | better-sqlite3 네이티브 모듈 호환, Node.js 서버 직접 내장 가능 |
| Gemini 대응 | Antigravity CLI 선제 준비 | 6/18 전환 확정, 정책 리스크 회피 |
| 멀티에이전트 | Thread-level M:N | 기존 Thread 모델 확장, @mention 라우팅 |
| 위임 결과 | Thread contextBundle + 포인터 | 자동 주입 금지 원칙 준수 |
| Rule 계층 | Global → Project → Agent → Thread | 기존 테이블 확장, 마이그레이션 최소화 |
| 리뷰 시스템 | Run-level inline comment | PR 아닌 loom 내부 리뷰 (PR은 별도 Phase) |
| 비용 추적 | 토큰 세분화 컬럼 추가 | 어댑터별 usage 파싱으로 데이터 수집 |
| PR 생성 | gh CLI 래핑 | GitHub 공식 CLI, 이미 git-account에서 사용 |
| 디자인 시스템 | 시맨틱 토큰 + Inter 서체 | 번들 크기 최소, 한국어 호환 |
| 검색 | FTS5 | SQLite 내장, 외부 의존성 없음 |

---

## 마이그레이션 영향 범위 총괄

```
P0 (기반):
  - AdapterKind 타입에 "antigravity" 추가
  - AdapterManifest에 policyWarnings 필드 추가
  - Windows 호환성 패치 6건 (기존 코드 수정)

P1 (협업):
  - agents 테이블: mention_name 컬럼
  - thread_agents 조인 테이블 (신규)
  - projects 테이블: project_rule 컬럼
  - prompt-router.ts (신규 서비스)
  - delegation-tapper.ts (신규 서비스)
  - CliAdapter 인터페이스: extractDelegationAttempts, extractUsage 추가

P2 (리뷰/추적):
  - runs 테이블: review_status, review_note, input_tokens, output_tokens, cache_*
  - run_comments 테이블 (신규)
  - run_logs_fts 가상 테이블 (신규)

P3 (배포):
  - threads 테이블: pr_url, pr_number, pr_status
  - pr-service.ts (신규 서비스)

P4 (플랫폼):
  - Electron 래퍼 (신규 패키지)
  - 디자인 시스템 (apps/web/src/design/)

P5 (확장):
  - users 테이블 (신규)
  - project_members 테이블 (신규)
```

---

## 다음 단계

이 설계서가 합의되면:
1. P0부터 순차 착수
2. 각 Phase 시작 전 세부 ADR 작성
3. 한 Phase 내에서도 한 커밋 = 한 논리적 변경
4. 어댑터 수정 시 통합 테스트 먼저
