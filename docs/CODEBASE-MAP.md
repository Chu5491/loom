# CODEBASE-MAP.md

> Phase 0 산출물 — 2026-05-22 작성
> 이 문서는 코드 수정 전 코드베이스의 현재 상태를 기록하고,
> 9대 커스터마이징 컨셉별 갭 분석을 제공한다.

---

## 1. 프로젝트 개요

**loom** — 여러 CLI 코딩 에이전트(Claude Code · Gemini CLI · Codex · OpenCode)를
한 워크스페이스에서 통합 운영하는 로컬 Node.js + React 앱.

| 항목 | 값 |
|---|---|
| 상태 | Alpha, 로컬 단일 사용자 |
| Node | ≥ 22 (better-sqlite3 ABI 127) |
| 패키지 매니저 | pnpm 10.21 |
| 서버 | Hono + better-sqlite3 (포트 3200) |
| 프론트엔드 | React + Vite + Tailwind 4 + Monaco (포트 3201) |
| 라이선스 | MIT |
| 핵심 신념 | "자동 주입은 죄" — CLI에 도달하는 입력은 사용자가 명시적으로 작성/첨부한 것만 |

---

## 2. 모노레포 구조

```
loom/
├── apps/
│   ├── server/                  # Hono 백엔드 — DB, Run lifecycle, SSE, Git
│   │   ├── src/
│   │   │   ├── index.ts         # 서버 부트스트랩 + 라우트 마운트
│   │   │   ├── config.ts        # 환경변수 기반 설정 (포트, 데이터 경로)
│   │   │   ├── adapters/
│   │   │   │   └── registry.ts  # 4개 어댑터 등록 + 프로브/모델 캐싱
│   │   │   ├── routes/          # REST + SSE 엔드포인트 (13개 모듈, 60+ 엔드포인트)
│   │   │   │   ├── adapters.ts  # GET/POST /api/adapters — 어댑터 디스커버리
│   │   │   │   ├── agents.ts    # CRUD /api/agents
│   │   │   │   ├── runs.ts      # CRUD + SSE /api/runs — 핵심 런 관리
│   │   │   │   ├── threads.ts   # CRUD /api/threads
│   │   │   │   ├── projects.ts  # CRUD + Git + Insights /api/projects
│   │   │   │   ├── specs.ts     # CRUD + Marketplace /api/specs
│   │   │   │   ├── mcp-servers.ts
│   │   │   │   ├── settings.ts
│   │   │   │   ├── insights.ts
│   │   │   │   ├── git.ts       # Git ops (stage/commit/push/pull/branch/stash/diff)
│   │   │   │   ├── git-account.ts
│   │   │   │   ├── gemini-sync.ts
│   │   │   │   └── health.ts
│   │   │   ├── services/
│   │   │   │   ├── run-service.ts      # Run lifecycle 오케스트레이터
│   │   │   │   ├── run/
│   │   │   │   │   ├── active-runs.ts  # 인메모리 Map<runId, AbortController>
│   │   │   │   │   ├── run-tappers.ts  # cost/session/touches/tools 실시간 추출
│   │   │   │   │   ├── prompt-composer.ts  # 프롬프트 조립 (loadout-pointer 패턴)
│   │   │   │   │   ├── thread-resolver.ts  # 스레드 결정 로직
│   │   │   │   │   └── agent-loadout.ts    # Skills+MCP 디스크 물리화
│   │   │   │   ├── log-store.ts        # JSONL 로그 + 인메모리 버퍼 + SSE 스트리밍
│   │   │   │   ├── git-snapshot.ts     # Run 전후 commit-tree diff 캡처
│   │   │   │   ├── git.ts             # Git CLI 래퍼 (porcelain v1 -z 파싱)
│   │   │   │   ├── worktree.ts        # Thread별 git worktree 격리
│   │   │   │   ├── project-fs.ts      # 프로젝트 파일 트리 / 파일 읽기
│   │   │   │   ├── project-clone.ts   # Git URL → 로컬 클론
│   │   │   │   ├── open-in-editor.ts  # IDE 실행 (VS Code, Cursor 등)
│   │   │   │   └── gemini-sync.ts     # Gemini CLI settings.json 동기화
│   │   │   └── db/
│   │   │       ├── client.ts       # SQLite 초기화 + 19개 마이그레이션
│   │   │       ├── projects.ts
│   │   │       ├── agents.ts
│   │   │       ├── runs.ts         # Run CRUD + 상태 머신
│   │   │       ├── threads.ts
│   │   │       ├── specs.ts
│   │   │       ├── mcp-servers.ts
│   │   │       ├── delegations.ts  # 서브에이전트 위임 기록
│   │   │       ├── run-changes.ts  # 파일별 변경 영속화
│   │   │       ├── insights.ts     # 분석 집계 (SELECT only)
│   │   │       └── settings.ts     # 글로벌 설정 (싱글 row)
│   │   └── test/
│   │       └── run-lifecycle.test.ts
│   │
│   └── web/                     # React + Vite SPA
│       ├── src/
│       │   ├── App.tsx          # 라우트 정의 (lazy-loaded)
│       │   ├── api/client.ts    # REST 호출 단일 파일
│       │   ├── lib/loomEvents.ts # SSE 이벤트 버스
│       │   ├── context/
│       │   │   ├── I18nContext.tsx  # en/ko 2개 언어
│       │   │   └── ThemeContext.tsx # system/light/dark
│       │   ├── i18n/
│       │   │   ├── dictionaries.ts # 200+ 키
│       │   │   └── adapters.ts     # 어댑터별 번역
│       │   ├── pages/              # 14개 탑레벨 페이지
│       │   │   ├── WorkspacePage.tsx    # 채팅/캔버스 메인
│       │   │   ├── DashboardPage.tsx    # 프로젝트 대시보드
│       │   │   ├── FilesPage.tsx        # Monaco 파일 뷰어 + diff
│       │   │   ├── RunsPage.tsx         # Run 이력
│       │   │   ├── RunDetailPage.tsx     # Run 상세 + 로그 스트림
│       │   │   ├── RunComparePage.tsx    # Run 간 비교
│       │   │   ├── GitPage.tsx          # Git 전체 (commit graph, staging)
│       │   │   ├── AgentsPage.tsx       # 에이전트 관리
│       │   │   ├── InsightsPage.tsx     # 통계
│       │   │   ├── SpecsPage.tsx        # Skills 카탈로그
│       │   │   ├── McpsPage.tsx         # MCP 서버 관리
│       │   │   └── workspace/
│       │   │       └── LiveView.tsx     # 에이전트 실시간 활동 뷰
│       │   └── components/
│       │       ├── Layout.tsx           # 듀얼 모드 (MainSidebar / ActivityBar)
│       │       ├── ActivityBar.tsx      # 48px 아이콘 레일 + 리사이즈 패널
│       │       ├── ProjectShell.tsx     # 프로젝트 이벤트 포워딩
│       │       ├── MonacoView.tsx       # 에디터 + 멀티에이전트 프레즌스
│       │       ├── HandoffGraph.tsx     # 서브에이전트 위임 트리 시각화
│       │       ├── activity/           # 10개 탭 패널
│       │       ├── chat/               # 12개 메시징 컴포넌트
│       │       ├── git/                # 4개 Git 컴포넌트
│       │       ├── adapter-fields/     # 7개 폼 필드 렌더러
│       │       ├── ui/                 # 11개 shadcn/ui 기본 컴포넌트
│       │       └── marketplace/
│       └── styles.css              # Tailwind 4 + OKLCH 테마 + 18색 에이전트 팔레트
│
├── packages/
│   ├── core/                    # 공유 타입 (런타임 의존성 0)
│   │   └── src/
│   │       ├── types.ts         # Project, Agent, Thread, Run, RunChange, McpServer, Spec, Delegation
│   │       ├── adapter.ts       # CliAdapter, SpawnArgs, BuiltCommand, TouchedEdit, ToolUse
│   │       ├── manifest.ts      # AdapterManifest, AdapterField, ProbeFn, ListModelsFn
│   │       ├── api-shared.ts    # GitStatus, InsightsSummary, LoomSettings 등 API 응답 타입
│   │       └── index.ts         # 배럴 export
│   │
│   ├── adapter-utils/           # 어댑터 공용 유틸 (Node 표준만)
│   │   └── src/
│   │       ├── define.ts        # defineCliAdapter() 팩토리 + applyPrompt()
│   │       ├── spawn.ts         # spawnProcess() — child_process.spawn 래퍼
│   │       ├── exec.ts          # spawnCapture() — 캡처 모드 (15s 타임아웃)
│   │       ├── probe.ts         # probeBinary(), fileExists(), envIsSet(), homePath()
│   │       └── index.ts         # 배럴 export
│   │
│   └── adapters/
│       ├── claude-code/         # ✅ Reference implementation
│       │   └── src/
│       │       ├── index.ts     # buildClaudeCommand + extractors + defineCliAdapter
│       │       ├── index.test.ts # 단위 테스트 (244줄)
│       │       ├── manifest.ts  # UI 폼 필드 (model, effort, outputFormat 등)
│       │       ├── models.ts    # 프리셋 모델 목록 (CLI에 list 명령 없음)
│       │       ├── probe.ts     # 바이너리 + 인증 탐지 (env/cred/keychain)
│       │       └── preset-models.ts  # Opus 4.7, Sonnet 4.6, Haiku 4.5 등
│       │
│       ├── gemini/              # 🟡 와이어드, 파싱 OK
│       │   └── src/             # --prompt arg 전달, --allowed-mcp-server-names 화이트리스트
│       │       ├── index.ts     # buildGeminiCommand + extractors
│       │       ├── index.test.ts
│       │       ├── manifest.ts  # model, outputFormat, autoApprove, sandbox
│       │       ├── models.ts
│       │       ├── probe.ts
│       │       └── preset-models.ts  # Gemini 3 Pro, 2.5 Pro/Flash 등
│       │
│       ├── codex/               # 🟡 와이어드, 파싱 OK
│       │   └── src/             # stdin 전달, TOML -c 오버라이드로 MCP
│       │       ├── index.ts     # buildCodexCommand + toCodexMcpOverrides + extractors
│       │       ├── index.test.ts
│       │       ├── manifest.ts  # model, reasoningEffort, webSearch, bypass
│       │       ├── models.ts
│       │       ├── probe.ts
│       │       └── preset-models.ts  # GPT-5.5, 5.4, 5.3 Codex 등
│       │
│       └── opencode/            # 🟡 와이어드, 파싱 OK
│           └── src/             # trailing arg 전달, 런타임 config.json 생성
│               ├── index.ts     # buildOpencodeCommand + toOpencodeMcpEntry + extractors
│               ├── index.test.ts
│               ├── manifest.ts  # model (provider/model), agent profile, continue
│               ├── models.ts    # `opencode models` 라이브 호출 + 프리셋 폴백
│               └── probe.ts     # 멀티 프로바이더 인증 체크
│
├── scripts/
│   └── dev.sh                   # Homebrew/nvm Node 22 PATH 자동 설정 + 서버+웹 동시 기동
│
├── docs/
│   ├── assets/                  # 로고, 픽셀 오피스 이미지
│   └── CODEBASE-MAP.md          # ← 이 문서
│
├── .claude/
│   └── launch.json              # Claude Code Preview 설정 (포트 3201)
│
├── package.json                 # workspace root — pnpm scripts
├── pnpm-workspace.yaml          # apps/*, packages/*, packages/adapters/*
├── tsconfig.base.json
├── CLAUDE.md                    # 코딩 규칙
├── SLIM-HARNESS-DESIGN.md       # 설계 철학 (헌법)
├── README.md / README.ko.md
└── LICENSE                      # MIT
```

---

## 3. 데이터베이스 스키마 (16 테이블)

```
projects ─────────────┐
  id, name, path,     │
  description,         │  1:N
  preferred_editor,    ├──────── agents
  clone_url            │           id, project_id, name, prompt,
                       │           role, adapter_kind, adapter_config,
project_env            │           default_cwd
  (project_id, key)    │             │
                       │             ├──── agent_skills (agent_id, skill_id)
                       │             └──── agent_mcp_servers (agent_id, mcp_server_id)
                       │
                       ├──────── threads
                       │           id, project_id, name, status,
                       │           context_bundle, worktree_path
                       │             │
                       │             └──── runs
                       │                     id, agent_id, thread_id,
                       │                     parent_run_id (→ runs.id),
                       │                     prompt, attached_spec_ids,
                       │                     cwd, status, exit_code, pid,
                       │                     log_path, before_ref, after_ref,
                       │                     cost_usd, session_id,
                       │                     resumed_session_id
                       │                       │
                       │                       ├── run_changes (run_id, path, status, +/-)
                       │                       └── delegations (parent_run_id, child_run_id,
                       │                                        target_agent_*, task_description,
                       │                                        status, result_summary)
                       │
specs ─────────────────┘  (id, name, content, agent_id, tags)

mcp_servers                (id, name, kind, command, args, env, url, headers)

loom_settings              (id=1, global_rule, smithery_api_key, skills_sh_api_key)

gemini_sync                (id=1, enabled, last_synced_at, last_error)

schema_migrations          (version, name, applied_at)
```

**Run 상태 머신:** `queued → running → (succeeded | failed | cancelled)`

**세션 영속화:** `session_id` (출력) + `resumed_session_id` (입력). 실패한 run의 세션은 poisoning 처리.

---

## 4. SSE 이벤트 카탈로그

**엔드포인트:** `GET /api/runs/:id/logs` (text/event-stream)

| 이벤트 | 페이로드 | 시점 |
|--------|---------|------|
| `chunk` | `{ ts: ISO8601, stream: "stdout"\|"stderr", data: string }` | 프로세스 stdout/stderr 매 청크 |
| `done` | `{ ts: ISO8601, status: "succeeded"\|"failed"\|"cancelled", exitCode: number\|null }` | 프로세스 종료 |

**구독 흐름:**
1. 클라이언트 EventSource 연결
2. active run → 버퍼된 chunk 리플레이 + 라이브 스트리밍
3. finished run → 전체 chunk 리플레이 + done + 연결 종료

---

## 5. 어댑터 흐름 비교

| | claude-code | gemini | codex | opencode |
|---|---|---|---|---|
| **prompt 전달** | stdin | `--prompt` arg | stdin (trailing `-`) | trailing positional arg |
| **출력 포맷** | stream-json JSONL | stream-json JSONL | `--json` JSONL | `--format json` JSONL |
| **session resume** | `--resume <id>` | 없음 | 없음 | `--continue` / `--session <id>` |
| **MCP 전달** | `--mcp-config` + `--strict-mcp-config` | `--allowed-mcp-server-names` | `-c mcp_servers.<k>=<v>` TOML | 런타임 config.json 생성 |
| **cost 추출** | `type:"result"` → `total_cost_usd` | 동일 | `turn.completed` → usage | 이벤트에서 추출 |
| **tool 추출** | Write/Edit/MultiEdit/NotebookEdit + 전체 | replace/write_file + 전체 | file_change/command_execution + 전체 | edit/write + 전체 |
| **프로브** | env + cred file + keychain config | env + cred file + gcloud | env + cred file | 멀티프로바이더 env |

---

## 6. CLI 도구별 이용 정책 검증 결과

### 종합 판정표

| 항목 | Claude Code | Gemini CLI | Codex CLI | OpenCode |
|---|---|---|---|---|
| **코드 라이선스** | Proprietary | Apache 2.0 | Apache 2.0 | MIT |
| **서비스 약관** | Commercial ToS | Google ToS | OpenAI ToS | 없음 (MIT) |
| **child_process.spawn** | API Key시 허용 | **위험 (회색지대)** | 허용 (공식) | 허용 |
| **stdout 파싱** | 허용 (stream-json 공식) | 허용 | 허용 (--json 공식) | 허용 |
| **세션 재개** | `--resume` 허용 | 미지원 | 미지원 | `--session` 허용 |
| **상업적 사용** | API Key시 허용 | 유료 라이선스시 허용 | 허용 | 허용 |
| **바이너리 재배포** | 불가 | 코드 가능 | 가능 | 가능 |

### 핵심 리스크

**Claude Code — API Key 전제하면 안전**
- Anthropic Agent SDK가 동일한 패턴(subprocess spawn)을 사용 → 공식 선례
- **Consumer OAuth 토큰 사용 절대 금지** (2026년 1월 서버측 차단 + DMCA 조치 전례)
- BYOK(Bring Your Own Key) 모델 유지 필수

**Gemini CLI — 가장 높은 법적 리스크**
- Google FAQ 명시: "Directly accessing the services powering Gemini CLI using third-party software is a violation"
- **2026년 6월 18일부 Antigravity CLI로 전환 예정** — 개인용 요청 처리 중단
- 대안: Gemini API 직접 호출 어댑터 또는 Antigravity CLI 전환 후 새 ToS 확인

**Codex CLI — 가장 안전**
- Apache 2.0 + `codex exec --json`이 "tools wrapping codex exec"를 위해 공식 설계됨
- SDK(@openai/codex-sdk)까지 제공

**OpenCode — 안전**
- MIT 라이선스. 래핑/재배포 제한 없음
- 하위 LLM 프로바이더 개별 약관만 준수하면 됨

### 권고사항
1. **BYOK 모델 철저히 유지** — 사용자가 자신의 API 키를 직접 설정
2. **Gemini CLI 어댑터에 정책 경고 UI 표시** — 사용자 인지 필수
3. **정식 법률 자문 권장** — "경쟁 제품" 조항의 법적 해석 영역

---

## 7. 크로스플랫폼 호환성 분석

### 차단 이슈 (Windows 작동 불가)

| # | 위치 | 문제 | 수정 방향 |
|---|---|---|---|
| 1 | `scripts/dev.sh` | Bash 전용, Unix 경로 하드코딩 | Node 기반 진입점으로 교체 |
| 2 | `services/git-snapshot.ts:69` | `rm -f` 호출 | `fs.promises.unlink()` 사용 |
| 3 | `services/open-in-editor.ts:45-47` | `process.env.HOME` 직접 사용 (Windows는 `USERPROFILE`) | `os.homedir()` 사용 |
| 4 | `adapters/opencode/index.ts:64` | `XDG_CONFIG_HOME` → `.config/` 가정 | 플랫폼별 AppData 경로 |
| 5 | `adapter-utils/spawn.ts:24,47` | `SIGTERM/SIGKILL` — Windows에서 무시됨 | 플랫폼 감지 + 대체 종료 |
| 6 | `adapter-utils/probe.ts:22` | `.exe` 확장자 미탐색 | `PATHEXT` 환경변수 활용 |

### 주요 이슈 (기능 저하)

| # | 위치 | 문제 |
|---|---|---|
| 7 | `services/worktree.ts:89` | 경로 비교 시 백슬래시/슬래시 불일치 |
| 8 | 전체 어댑터 | CLI 바이너리가 Windows에서 `.exe`/`.cmd`로 배포 |

### Electron/Tauri 앱 전환 가능성

| 컴포넌트 | Electron | Tauri | 비고 |
|---|---|---|---|
| Server (Node.js) | main/fork에서 실행 | subprocess로 실행 | |
| better-sqlite3 | 네이티브 리빌드 필요 | subprocess 접근만 | 플랫폼별 pre-built 필요 |
| Git ops | 시스템 git 사용 | 시스템 git 사용 | |
| 어댑터 spawn | 시스템 PATH | 시스템 PATH | |

**예상 작업량:** Windows 호환 ~4-6시간, Electron/Tauri 래핑 ~2-3일

---

## 8. 9대 커스터마이징 컨셉별 갭 분석

### 컨셉 1: CLI 도구 통합 관리

**현재 상태:** ✅ 기본 구조 완성
- 4개 어댑터 등록, `defineCliAdapter` 팩토리 패턴
- `registry.ts`에서 통합 관리 (프로브, 모델 목록, 테스트)
- 어댑터 매니페스트로 UI 폼 자동 생성

**갭:**
- claude-code만 일상 사용 수준. 나머지 3개는 거친 부분 있음
- 어댑터 자동 검출 미구현 (PATH 스캔)
- Gemini CLI → Antigravity CLI 전환 대응 필요
- 새 CLI 추가 시 수동 레지스트리 등록 필요

---

### 컨셉 2: 사용량/에디터 추적 관리

**현재 상태:** 🟡 부분 구현
- `cost_usd` per-run 추적 완성
- `insights.ts`: 프로젝트·에이전트·모델별 누적 비용, 일/주/월 필터
- `run_changes`: 파일별 변경 추적 (additions/deletions)
- 인메모리 `active-touches`, `active-tools` 실시간 추적

**갭:**
- **토큰 단위 추적 미구현** — input/output/cache read/write 토큰 세분화 없음
- **에디터(IDE) 연동 추적 미구현** — 어떤 에디터에서 어떤 파일을 봤는지
- **세션 시간 추적 미구현** — 에이전트별 활동 시간대, 유휴 시간
- Cost dashboard 전용 UI 없음 (insights에 합쳐져 있음)
- 비용 예산/알림 기능 없음

---

### 컨셉 3: 쉬운 리뷰 체계

**현재 상태:** 🟡 부분 구현
- Monaco side-by-side diff (run의 before_ref/after_ref)
- `run_changes` 테이블로 파일별 변경 요약
- Run 이력 페이지 + Run 상세 (로그 스트림)
- RunComparePage (Run 간 비교)

**갭:**
- **코드 리뷰 워크플로우 미구현** — approve/reject/comment 없음
- **Run 요약 자동 생성 미구현** — LLM이 만든 변경의 의도/이유 요약
- **파일 히스토리 타임라인 미구현** — 같은 파일이 어떤 run들에서 변경되었는지
- **인라인 주석 미구현** — diff에 대한 사람의 피드백 기록
- PR 생성 미구현 (Phase 2 항목)
- 로그 전문 검색 미구현 (FTS5 미적용)

---

### 컨셉 4: Rule/Skill/MCP 통합 관리

**현재 상태:** ✅ 기본 구조 완성
- `specs` 테이블: Skills 저장 + 태그 + 에이전트 연결
- `mcp_servers` 테이블: MCP 서버 등록 (stdio/http/sse)
- `agent_skills`, `agent_mcp_servers`: M:N 연결
- `loom_settings.global_rule`: 전역 규칙
- `agent.prompt`: 에이전트별 규칙
- Marketplace: 내장 카탈로그 + skills.sh + Smithery MCP Registry
- Loadout-pointer 패턴: 프롬프트에 인덱스만, 본문은 디스크

**갭:**
- **Rule 계층 구조 미구현** — global → project → agent → thread 순서 오버라이드
- **Rule 버전 관리 미구현** — 변경 이력 추적
- **Skill 의존성 미구현** — Skill A가 Skill B를 필요로 하는 관계
- **MCP 서버 상태 모니터링 미구현** — 연결 상태, 응답 시간
- **Rule/Skill/MCP 공유 미구현** — 팀원 간 공유 또는 내보내기/가져오기
- **CLI별 Rule 차이 미관리** — claude의 CLAUDE.md, gemini의 GEMINI.md 등

---

### 컨셉 5: 하나의 채팅에서 모든 CLI 협력

**현재 상태:** 🔴 미구현
- 현재: 하나의 Thread에 하나의 Agent만 연결
- Run은 단일 agent_id에 종속
- Thread에서 @mention으로 다른 에이전트 호출하는 메커니즘 없음

**갭 (전체 설계 필요):**
- **멀티에이전트 Thread 미구현** — 하나의 채팅에서 여러 에이전트가 응답
- **@mention 라우팅 미구현** — "@claude ..." → claude-code, "@gemini ..." → gemini
- **에이전트 간 컨텍스트 공유 미구현** — A의 결과를 B가 참조
- **동시 실행 오케스트레이션 미구현** — 같은 prompt를 여러 에이전트에게 동시 전달
- **결과 비교/병합 UI 미구현** — A와 B의 응답을 나란히 비교

---

### 컨셉 6: 전문 디자이너 수준의 UI/UX

**현재 상태:** 🟡 기능적이나 개선 여지 큼

현재 디자인 시스템:
- Tailwind 4 + shadcn/ui + OKLCH 컬러
- 단일 CommitMonoChu 모노스페이스 폰트
- 18색 에이전트 팔레트
- Light/dark 모드 (warm paper tone)
- 픽셀 오피스 메타포 (PixelDesk, PixelCharacter SVG 애니메이션)

**갭:**
- **디자인 토큰 시스템 미체계화** — 색상이 styles.css에 하드코딩
- **본문 서체 부재** — 모노스페이스만 사용, sans-serif 본문 서체 없음
- **모바일 반응형 미구현** — 데스크톱 전용 레이아웃
- **마이크로 인터랙션 부족** — 전환 애니메이션 최소화
- **Storybook / 비주얼 테스트 없음** — 컴포넌트 카탈로그 부재
- **접근성(a11y) 최소 수준** — ARIA 기본만, 키보드 네비게이션 미완성
- **온보딩 플로우 없음** — 첫 사용자 안내 없음
- **빈 상태(empty state) 디자인 미흡**
- **에러 상태 디자인 미흡** — 기본 얼럿만
- **로딩 상태 불일치** — 페이지별 다른 로딩 패턴

---

### 컨셉 7: 서브에이전트 하네스 엔지니어링

**현재 상태:** 🔴 인프라만 존재, 실제 동작 미구현

구현된 것:
- `delegations` DB 테이블 + CRUD 헬퍼
- `Run.parentRunId` 체인
- `HandoffGraph` UI 컴포넌트 (트리 시각화)
- `LiveView` 위임 스트림 통합
- `GET /api/projects/:id/active-delegations` 엔드포인트

**미구현 (전체 Phase 2):**
- **어댑터별 Task 도구 감지** — stream-json에서 Task/Agent 도구 호출 파싱
- **`makeDelegationTapper()`** — 실시간 위임 감지 탭퍼
- **자동 child run 생성** — Task 감지 → startRun(parentRunId, targetAgentId)
- **결과 파이프백** — child run 결과를 parent에게 피드백
- **크로스 어댑터 위임** — claude → gemini 위임 라우팅
- **위임 큐** — 동시 위임 제한, 우선순위
- **실패 핸들링** — child 실패 시 parent 통보, 재시도 로직

**예상 작업량:** ~1,500-2,000 LOC (프로덕션 코드 + 테스트)

---

### 컨셉 8: 크로스플랫폼 (Mac/Windows/Web + 네이티브 앱)

**현재 상태:** 🔴 macOS 전용

- macOS에서만 테스트/개발
- 6개 Windows 차단 이슈 (Section 7 참조)
- 네이티브 앱 래핑(Electron/Tauri) 미구현
- PWA 미구현

**필요한 작업:**
1. Windows 호환성 패치 (6개 차단 이슈 해결)
2. Linux 검증
3. Electron 또는 Tauri 래핑
4. 네이티브 앱 빌드 파이프라인 (macOS .dmg, Windows .exe, Linux .AppImage)
5. 자동 업데이트 메커니즘

---

### 컨셉 9: CLI 도구별 이용 정책 검증

**현재 상태:** 🔴 정책 표시 없음

- UI에 정책 경고/안내 없음
- 인증 방식별 제한사항 안내 없음
- BYOK 가이드 없음

**필요한 작업:**
1. 어댑터 매니페스트에 `policyWarnings` 필드 추가
2. 에이전트 생성 시 정책 안내 UI
3. Gemini CLI 특별 경고 (6/18 전환 안내)
4. API Key vs OAuth 인증 방식 구분 UI
5. 정책 변경 시 알림 메커니즘

---

## 9. 우선순위 제안

### Tier 0 — 즉시 (현재 기반 안정화)
1. gemini/codex/opencode 어댑터 안정화 (Phase 1)
2. Windows 차단 이슈 6건 해결
3. CLI 정책 경고 UI 추가

### Tier 1 — 핵심 (차별화 기능)
4. 서브에이전트 위임 완성 (Phase 2)
5. 멀티에이전트 Thread (컨셉 5)
6. Rule/Skill/MCP 계층 구조

### Tier 2 — 품질 (사용성)
7. UI/UX 전면 개선 (디자인 시스템)
8. 코드 리뷰 워크플로우
9. 토큰/비용 세분화 추적
10. 로그 전문 검색 (FTS5)

### Tier 3 — 확장 (배포)
11. Electron/Tauri 네이티브 앱
12. 멀티유저 auth
13. PR 자동 생성
14. Cost dashboard + 예산 알림
