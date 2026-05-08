<p align="center">
  <img src="docs/assets/loom-logo.png" alt="loom" width="140">
</p>

<h1 align="center">loom</h1>
<p align="center"><strong>여러 CLI 에이전트가 한 워크스페이스에서 같이 일하는 도구.</strong></p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dark-office.png">
    <img alt="loom — 멀티에이전트 워크스페이스" src="docs/assets/light-office.png">
  </picture>
</p>

<p align="center">
  <a href="./README.md"><b>English</b></a> ·
  <a href="./SLIM-HARNESS-DESIGN.md">설계 노트</a> ·
  <a href="./CLAUDE.md">작업 규칙</a>
</p>

> **상태 — alpha.** 로컬 단일 사용자. claude-code 어댑터는 데일리 사용 안정. gemini / codex / opencode 는 와이어드 + 출력 파싱은 되지만 거친 부분 있음.

---

## 개요

loom 은 **Claude Code · Gemini CLI · Codex · OpenCode** 같은 CLI 코딩 에이전트를 *한 프로젝트* 안에서 함께 부리기 위한 로컬 Node.js + React 워크스페이스.

스레드로 대화하고, 파일을 만지는 걸 실시간으로 보고, 모든 run 의 변경을 *side-by-side diff* 로 검토하고, 스테이징/커밋까지 앱을 안 떠나고 한다. CLI 자체는 그대로 — loom 은 그들이 함께 들어가는 *방*.

## 왜 만들었나

CLI 마다 자기 터미널이 따로 있다. 왔다갔다 하고, 컨텍스트 복붙하고, 어떤 thread 에서 누가 뭘 했는지 추적하는 게 금방 지친다. loom 은 이걸 한 워크스페이스에 모은다 + **명시적 prompt 경계** (하네스가 시스템 프롬프트를 몰래 끼워넣지 않음) + 얇은 per-CLI dispatcher.

## 무엇이 들어있나

| 화면 | 역할 |
|---|---|
| **라이브 뷰** | 모든 에이전트의 현재 상태 한눈에 — 편집 중 파일, 사용 중 도구, 소속 thread, 라인 수. 통합 활동 스트림이 모든 에이전트의 도구 호출 + 서브에이전트 위임을 시간순 병합. |
| **에디터** | Monaco 기반 파일 뷰어 + 그 파일을 만진 *모든 과거 run* 에 대한 **side-by-side diff**. ⌘P 퍼지 팔레트, 활성/비활성 폭 균형 멀티탭. |
| **Git** | 풀 커밋 그래프 + 브랜치/원격 + 워킹 트리 staging + fetch / pull / push 한 페이지에. 사이드바는 브랜치/스태시 navigation, 메인은 실제 커밋 작업. |
| **이력** | 과거 모든 run — 상태, 비용, 변경 파일, 메시지로 점프. |
| **통계** | 비용 / 시간 / 파일 활동, 에이전트별 · 프로젝트별. |
| **Skills + MCP** | 에이전트별 loadout — 내장 카탈로그 + skills.sh + 공식 MCP Registry (Smithery 등). API 키는 UI 로 DB 저장, env-var fallback. |
| **Threads** | thread 마다 격리된 git worktree 옵션. 같은 thread 의 다음 run 에 직전 session_id 자동 feed (`--resume <id>` per CLI). |
| **에이전트 관리** | 라이브 캔버스에서 인라인 추가 / 편집 / 삭제 — 페이지 이동 X. |

🚧 아직 안 됨: PR 생성, 로그 풀텍스트 검색, 멀티 사용자, 하든된 배포, 서브에이전트 Task spawn (Phase 2 — 스키마 + UI 자리는 깔려있음, 어댑터 감지 미구현).

## 빠른 시작

요구사항:
- **Node ≥ 22**
- **pnpm**
- 부리고 싶은 CLI 가 PATH 에 있어야 함: `claude` · `gemini` · `codex` · `opencode`

```bash
pnpm install
pnpm dev
# 웹 → http://localhost:3201
```

UI 에서:

1. 프로젝트 만들기 — 로컬 repo 경로 또는 git URL 붙여넣기 (loom 이 clone).
2. 에이전트 추가 — CLI + 모델 선택, 스킬/MCP 옵션.
3. 스레드 열고 대화 시작. `@<파일>` 으로 프로젝트 파일 멘션, `/<skill|mcp>` 로 에이전트의 loadout 에서 추가.

## 한 문단 아키텍처

단일 SQLite 파일 (`./data/loom.db`) 이 프로젝트, 에이전트, 스레드, run, run_changes, delegations, settings, 카탈로그를 보관. 서버 (`apps/server`) 는 Hono 프로세스 — 이 DB + 인메모리 로그 store 를 소유, CLI run 은 `child_process.spawn` 으로 어댑터별 spawn, 출력은 SSE 스트림. UI (`apps/web`) 는 React + Vite SPA — REST 폴링 + run 별 SSE 구독. Git 활동은 *워킹 인덱스 / stash / untracked 를 안 건드리는* 가벼운 before/after `git commit-tree` 스냅샷 으로 캡처.

## 프로젝트 구조

```
apps/
  server/                       Hono 백엔드 — DB, run 라이프사이클, SSE, git
  web/                          React + Vite UI
packages/
  core/                         공유 타입
  adapter-utils/                spawnProcess + defineCliAdapter
  adapters/
    claude-code/
    gemini/
    codex/
    opencode/
docs/                           설계 노트 + 자산
.claude/launch.json             dev 서버 config (preview 툴)
```

## 환경 변수

서버가 읽는 변수 (모두 옵션):

| 변수 | 용도 |
|---|---|
| `LOOM_PORT` | 서버 포트. 기본 `3201`. |
| `LOOM_DATA_DIR` | DB + 로그 위치. 기본 `./data`. |
| `LOOM_LOG_LEVEL` | `debug` / `info` / `warn` / `error`. 기본 `info`. |
| `LOOM_SMITHERY_API_KEY` | 옵션. Smithery MCP 마켓 활성. UI 저장 키가 우선. |
| `LOOM_SKILLS_SH_API_KEY` | 옵션. skills.sh 스킬 마켓 활성. UI 저장 키가 우선. |

프로젝트별 env 변수 (그 프로젝트의 모든 run 에 주입) 는 **프로젝트 → ENV** UI 섹션에서 관리. 셸 env 가 아님.

## 스크립트

| 명령 | 동작 |
|---|---|
| `pnpm dev` | 서버 + Vite 동시 |
| `pnpm dev:server` | 서버만 |
| `pnpm dev:web` | UI 만 |
| `pnpm build` | 모든 워크스페이스 빌드 |
| `pnpm typecheck` | 워크스페이스 전반 `tsc --noEmit` |
| `pnpm test` | 패키지 테스트 |

## 배포

loom 은 현재 *로컬 단일 사용자* 용. 공유 배포 하려면 최소:

- `LOOM_DATA_DIR` 에 영속 볼륨 마운트 (SQLite + 로그 + worktrees).
- 런타임 이미지에 CLI 바이너리 포함.
- HTTP 서버 앞에 인증/인가 (loom 자체 인증 없음).

엔터프라이즈 turnkey 배포는 로드맵 — 현재 어떤 배포든 *신뢰할 수 있는 네트워크에 노출된 개인 워크스페이스* 로 봐야.

## 기여

non-trivial PR 보내기 전에 [CLAUDE.md](./CLAUDE.md) 읽을 것. 네이밍 / 추상화 한도 / 어댑터 패턴 / 테스트 스킵 기준 / prompt 주입 규칙 ("자동 주입은 죄") 모두 거기.

```bash
pnpm install
pnpm typecheck   # 그린이어야
pnpm test        # 테스트 있는 패키지는 그린이어야
```

새 어댑터 추가는 CLAUDE.md §4 의 레시피 따름 — 3개 파일 (`index.ts` · `index.test.ts` · `package.json`) 각 ~30~50줄, registry 에 등록.

## 설계 배경

- [`SLIM-HARNESS-DESIGN.md`](./SLIM-HARNESS-DESIGN.md) — 원래 "얇은 dispatcher" 사고.
- [`CLAUDE.md`](./CLAUDE.md) — 현재 작업 규칙, 4-어댑터 추상화 포함.

## 라이선스

MIT — [`LICENSE`](./LICENSE) 참고.
