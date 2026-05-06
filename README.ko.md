<p align="center">
  <img src="docs/assets/loom-logo.png" alt="loom" width="140">
</p>

<h1 align="center">loom</h1>
<p align="center"><strong>여러 CLI 코딩 에이전트가 한 워크스페이스에서 같이 일하는 방.</strong></p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dark-office.png">
    <img alt="loom — CLI 에이전트들의 픽셀 사무실" src="docs/assets/light-office.png">
  </picture>
</p>

<p align="center">
  <a href="./README.md"><b>English</b></a> ·
  <a href="./SLIM-HARNESS-DESIGN.md">설계 노트</a> ·
  <a href="./CLAUDE.md">작업 가이드</a>
</p>

> **상태 — alpha.** 로컬 1인 사용 전용. claude-code 어댑터는 일상 사용 가능, 나머지는 연결돼서 출력 파싱까지 동작하지만 거친 부분 있음.

---

## 개요

loom 은 로컬 Node.js + React 워크스페이스에요. **Claude Code, Gemini CLI, Codex, OpenCode** 같은 CLI 코딩 에이전트들을 한 프로젝트 안에서 같이 부려요.

스레드로 대화하고, 파일 편집을 실시간으로 보고, 변경 내역을 스트림처럼 리뷰합니다. CLI 들은 그대로 — loom 은 그들이 같이 쓰는 방.

## 만든 이유

각 CLI 가 자기 터미널을 따로 쓰니까 컨텍스트 옮기고, 파일 옮기고, 스레드 별로 누가 뭘 했는지 추적하는 게 매번 수작업이라 빠르게 지쳐요. 그래서 한 방에 다 모으고, **시스템 프롬프트 자동 주입 같은 건 없이** (사용자가 명시한 입력만) CLI 별로 얇은 dispatcher 만 두는 식으로 만들었어요.

## 하려던 것

- **프로젝트 1개 = 워크스페이스 1개.** 스레드 = 작업 단위, run = 한 턴.
- **스킬/MCP 는 시스템 카탈로그.** 에이전트가 자기 loadout 으로 골라 씀.
- **Loadout 포인터 프롬프트.** 스킬 본문은 디스크에 두고, 프롬프트엔 `path/skill.md` 인덱스만 — 캐시가 안 깨짐.
- **진짜 CLI 세션.** CLI 별 `--resume <id>`, 실제 cost 캡처, 실제 도구 추적.
- **잡일 안 하기.** 코드를 직접 보고 싶으면 한 클릭으로 진짜 IDE 열기.

## 구현된 것

| 영역 | 상태 |
|---|---|
| **Claude Code 어댑터** | ✅ stream-json · 세션 resume · cost · 도구 추적 · `--mcp-config + --strict-mcp-config` |
| **Gemini / Codex / OpenCode** | ✅ prompt + MCP 연결 (CLI 별로 filter / per-key / XDG override) |
| **스레드 · run · SSE 로그** | ✅ 전체 라이프사이클 · 스레드별 git worktree · `run_changes` 영속 |
| **워크스페이스 카탈로그** | ✅ 스킬 · MCP 서버 · 프로젝트 env · **모든 프롬프트에 prepend 되는 global rule** |
| **Office / Chat dock / 파일** | ✅ 픽셀 사무실 · ⌘J 채팅 dock · 라이브 파일 presence · ⌘P 팔레트 |
| **Git 관리** | ✅ status / stage / commit / branch / log + **fetch / pull / push** SourceTree 풍 페이지 |
| **채팅 @/ 멘션** | ✅ `@<파일>` (프로젝트 파일) · `/<skill\|mcp>` (에이전트 loadout) |
| **IDE 열기** | ✅ VS Code · Cursor · Antigravity · Zed · IntelliJ |
| **라이트/다크 테마** | ✅ 픽셀 스프라이트까지 모두 커버 |

🚧 아직: PR 생성, 로그 전문 검색, 멀티 유저, 배포 hardening.

## 빠른 시작

요구사항: **Node ≥ 22**, **pnpm**.

```bash
pnpm install
pnpm dev
# web → http://localhost:3201
```

쓸 CLI (`claude`, `gemini`, `codex`, `opencode`) 가 `PATH` 에 있어야 해요. UI 들어와서:

1. 프로젝트 만들기 — 로컬 저장소 경로를 가리킴
2. 에이전트 추가 — CLI 와 모델 고르고, 카탈로그에서 스킬/MCP 골라 loadout 구성
3. 스레드 열고 메시지 시작

## 프로젝트 구조

```
apps/server                      # Hono 백엔드 — DB · run 라이프사이클 · SSE · git
apps/web                         # React + Vite UI
packages/core                    # 공유 타입
packages/adapters/{claude-code,gemini,codex,opencode}
packages/adapter-utils           # spawnProcess + defineCliAdapter
```

설계 배경: [`SLIM-HARNESS-DESIGN.md`](./SLIM-HARNESS-DESIGN.md).
코딩 규약 / 어댑터 컨벤션: [`CLAUDE.md`](./CLAUDE.md).

## 라이선스

MIT
