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

loom 은 **Claude Code · Codex · OpenCode · Devin · Antigravity** 같은 CLI 코딩 에이전트를 *하나의 회사*처럼 부리는 로컬 Node.js + React 워크스페이스.

팀을 한 번 정의하면(에이전트·규약·스킬·MCP 서버·워크플로우·기능 프롬프트) 전부 `office/` 디렉토리의 평범한 파일이 되고 git 에 커밋된다. 채팅으로 팀과 대화하면 매 턴 실제 CLI 가 프로젝트 디렉토리에서 spawn 되고, 출력이 구조화된 이벤트로 흘러온다. 에이전트는 일하다 팀원에게 위임하고, run 이 끝나면 워크플로우가 이어받고, 사람은 게이트에서 승인한다. CLI 는 CLI 그대로 — loom 은 그들이 공유하는 오피스다.

## 헌법

1. **CLI 그대로** — 래핑하되 변형하지 않는다.
2. **자동 주입은 죄** — 내가 적은 프롬프트 + 명시적으로 첨부한 spec 이 입력의 전부.
3. **CLI root 불가침** — `~/.claude`, `~/.gemini` 등은 절대 안 건드린다. 주입은 run별 loadout/플래그로.
4. **정의는 git, 기록은 로컬** — `office/`는 커밋, `data/`(sqlite·로그·loadout)는 gitignore.
5. **Raw 가 진실** — CLI 원본 출력은 항상 디스크 보존, 파싱된 이벤트는 그 위의 뷰.

## 들어있는 것

| 영역 | 하는 일 |
|---|---|
| **회사 홈** | 인원(에이전트)·양식(office 정의)·연결(CLI)·사용량(30일 비용/run) 대시보드 + 진행 중인 프로젝트. 프로젝트에 "들어가서" 일한다(헤더는 `회사 / 프로젝트` 브레드크럼). |
| **대화** | 에이전트와 채팅(스레드 사이드바, 세션 resume 으로 맥락 유지). `@` 하나로 에이전트·스킬(이 run에 첨부)·프로젝트 파일을 멘션, 드래그앤드롭/붙여넣기 첨부. 실시간 도구/파일 트레이스, 팀 현황 보드, run 상세(전달된 프롬프트·Raw 로그), 중지·비용 합계. |
| **파일 · Git** | Monaco 코드/Diff 뷰어, 어떤 에이전트가 어떤 파일을 바꿨는지 활동 피드, stage/commit + AI 커밋 메시지 생성. |
| **분석** | 분석 에이전트가 프로젝트를 읽고 구조화 리포트 — 건강도 점수 링·언어 구성·리스크/제안 배지. 히스토리(추이 그래프)로 시간에 따른 변화 추적. |
| **스케줄** | cron 으로 에이전트 run 반복 실행(매시/매일/커스텀, 지금 실행, 켜기/끄기). |
| **워크플로우** | 노드 그래프(캔버스 편집): 에이전트 스텝을 `success / fail / always` 엣지로 잇고, **트리거**(에이전트 run 종료 시 자동/제안)·**휴먼 게이트**(승인/거부 대기)·**병렬 join**(분기 결과 합침)을 조합. Talk 에서 수동 실행 + 라이브 진행 보드. |
| **위임** | `delegate` 켠 에이전트는 작업 중 팀원을 서브에이전트로 직접 호출(사유 기록). MCP 도구(claude/codex/opencode/devin) 또는 셸 브리지(antigravity) — 5/5 CLI 커버. |
| **오피스** | 팀을 파일로 정의: 규약, 스킬(단일 `.md` 또는 폴더), MCP 서버, 에이전트(CLI+모델+역할+권한), 워크플로우, 기능 프롬프트(커밋 메시지·분석 지침 — 양식은 코드 고정). |
| **연결** | 이 머신의 CLI 발견 · 인증 확인 · 모델 선택 · 연동 테스트. 인증된 CLI 는 헤더에 항상 표시. |

## 빠른 시작

준비물: **Node ≥ 20**, **pnpm**, 그리고 부릴 CLI 가 `PATH` 에 (`claude`, `codex`, `opencode`, `devin`, `agy`).

```bash
pnpm install
pnpm dev
# web → http://localhost:3201
```

1. **연결** — CLI 가 발견·인증됐는지 확인.
2. **오피스** — 에이전트 생성(CLI + 모델 필수), 필요하면 규약/스킬/MCP/워크플로우.
3. **회사 홈**에서 프로젝트(로컬 디렉토리)를 등록하고 들어가 대화 시작.

## 디렉토리 구조

```
office/                git 커밋되는 정의 (rules / skills / mcp / agents / workflows / prompts)
data/                  gitignore 되는 기록 (sqlite 히스토리, raw 로그·프롬프트, run별 loadout, 분석)
apps/server/           Hono — office 로더, 런 엔진, 워크플로우·스케줄러, SSE
apps/web/              React + Vite + Tailwind 4 — 회사 홈 / 프로젝트 워크스페이스 / 오피스 / 연결
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
| `LOOM_MAX_RUNS` | 동시 CLI run 한도(FIFO 대기열, 위임 자식은 우회). 기본 `4`. |

MCP secret 은 `office/mcp/servers.json` 에 `"${ENV_NAME}"` 참조로 적고 spawn 시점에 서버 환경변수에서 resolve — 리터럴 저장 금지.

## 기여

[CLAUDE.md](./CLAUDE.md) 먼저 — 네이밍 규칙, 추상화 한도, 어댑터 패턴, 그리고 위의 헌법.

```bash
pnpm typecheck   # green 필수
pnpm test        # green 필수
```

## 라이선스

MIT — [`LICENSE`](./LICENSE).
