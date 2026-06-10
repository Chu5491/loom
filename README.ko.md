<p align="center">
  <img src="docs/assets/loom-logo.png" alt="loom" width="140">
</p>

<h1 align="center">loom</h1>
<p align="center"><strong>내 CLI 코딩 에이전트들을 한 오피스에.</strong></p>

<p align="center">
  <a href="./README.md"><b>English</b></a> ·
  <a href="./docs/V2-PLAN.md">설계 노트</a> ·
  <a href="./CLAUDE.md">작업 규칙</a>
</p>

> **상태 — alpha, 로컬 단일 사용자.** 어댑터 5종 검증: claude-code · codex · opencode · devin · antigravity.

---

## 개요

loom 은 **Claude Code · Codex · OpenCode · Devin · Antigravity** 같은 CLI 코딩 에이전트를 *하나의 팀*으로 부리는 로컬 Node.js + React 워크스페이스.

팀을 한 번 정의하면(에이전트·규약·스킬·MCP 서버·핸드오프 규칙) 전부 `office/` 디렉토리의 평범한 파일이 되고 git 에 커밋된다. 채팅으로 팀과 대화하면 매 턴 실제 CLI 가 프로젝트 디렉토리에서 spawn 되고, 출력이 구조화된 이벤트로 흘러온다. CLI 는 CLI 그대로 — loom 은 그들이 공유하는 오피스다.

## 헌법

1. **CLI 그대로** — 래핑하되 변형하지 않는다.
2. **자동 주입은 죄** — 내가 적은 프롬프트 + 명시적으로 첨부한 spec 이 입력의 전부.
3. **CLI root 불가침** — `~/.claude`, `~/.gemini` 등은 절대 안 건드린다. 주입은 run별 loadout/플래그로.
4. **정의는 git, 기록은 로컬** — `office/`는 커밋, `data/`(sqlite·로그·loadout)는 gitignore.
5. **Raw 가 진실** — CLI 원본 출력은 항상 디스크 보존, 파싱된 이벤트는 그 위의 뷰.

## 들어있는 것

| 화면 | 하는 일 |
|---|---|
| **대화** | 아무 에이전트와 채팅. `@` 하나로 에이전트(라우팅)·스킬(이 run에 첨부)·프로젝트 파일(라이브 검색)을 멘션. 마크다운 렌더, 실시간 도구/파일 트레이스, 중지 버튼, 비용 합계, 핸드오프 제안. |
| **오피스** | 팀을 파일로 정의: 규약(항상 붙는 컨텍스트), 스킬(단일 `.md` 또는 references 딸린 폴더), MCP 서버(폼 에디터), 에이전트(CLI+모델+끌고 갈 것), 하네스 엣지(누가 누구에게, 언제 넘기나). |
| **연결** | 이 머신의 CLI 발견 · 인증 확인 · 모델 선택 · 연동 테스트. 인증된 CLI 는 헤더에 항상 표시. |
| **하네스** | `on_success / on_fail / on_changes` 엣지는 다음 에이전트를 자동 발화(루프 가드), `ask / manual` 은 원클릭 제안 버튼. 결과는 명시적으로 마크된 블록으로 전달. |
| **프로젝트** | 로컬 작업 디렉토리를 등록하면 run 이 거기서 실행. 오피스는 전역 공유("팀"), 프로젝트는 "일할 곳". |

## 빠른 시작

준비물: **Node ≥ 20**, **pnpm**, 그리고 부릴 CLI 가 `PATH` 에 (`claude`, `codex`, `opencode`, `devin`, `agy`).

```bash
pnpm install
pnpm dev
# web → http://localhost:3201
```

1. **연결** — CLI 가 발견·인증됐는지 확인.
2. **오피스** — 에이전트 생성(CLI + 모델 필수), 필요하면 규약/스킬/MCP.
3. 헤더에서 **프로젝트**(로컬 디렉토리)를 고르고 대화 시작.

## 디렉토리 구조

```
office/                git 커밋되는 정의 (rules / skills / mcp / agents / harness)
data/                  gitignore 되는 기록 (sqlite 히스토리, raw 로그, run별 loadout)
apps/server/           Hono — office 로더, 런 엔진, SSE, 하네스
apps/web/              React + Vite + Tailwind 4 — 대화 / 오피스 / 연결
packages/core/         공유 타입 (런타임 의존성 0)
packages/adapter-utils/ spawnProcess + defineCliAdapter
packages/adapters/     claude-code · antigravity · codex · opencode · devin
```

## 설정

| 변수 | 용도 |
|---|---|
| `LOOM_PORT` | 서버 포트. 기본 `3200`. |
| `LOOM_HOST` | 바인드 주소. 기본 `127.0.0.1`. |
| `LOOM_HOME` | 오피스 루트(`office/`·`data/` 위치). 기본: 리포 루트. |

MCP secret 은 `office/mcp/servers.json` 에 `"${ENV_NAME}"` 참조로 적고 spawn 시점에 서버 환경변수에서 resolve — 리터럴 저장 금지.

## 기여

[CLAUDE.md](./CLAUDE.md) 먼저 — 네이밍 규칙, 추상화 한도, 어댑터 패턴, 그리고 위의 헌법.

```bash
pnpm typecheck   # green 필수
pnpm test        # green 필수
```

## 라이선스

MIT — [`LICENSE`](./LICENSE).
