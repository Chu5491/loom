<p align="center">
  <img src="docs/assets/loom-logo.png" alt="loom" width="160">
</p>

<h1 align="center">loom</h1>
<p align="center"><strong>당신의 CLI 코딩 에이전트들이 같은 사무실에서 일하는 워크스페이스.</strong></p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dark-office.png">
    <img alt="loom — 픽셀 사무실" src="docs/assets/light-office.png">
  </picture>
</p>

<p align="center">
  <a href="#빠른-시작"><b>빠른 시작</b></a> ·
  <a href="#상태"><b>상태</b></a> ·
  <a href="#-새-cli-붙이기"><b>어댑터</b></a> ·
  <a href="#내부-구조"><b>아키텍처</b></a> ·
  <a href="#faq"><b>FAQ</b></a> ·
  <a href="./README.md"><b>English</b></a>
</p>

<p align="center">
  <a href="#-라이선스"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue"></a>
  <a href="#필수-요구사항"><img alt="Node ≥ 22" src="https://img.shields.io/badge/node-%E2%89%A522-green"></a>
  <img alt="TypeScript 5" src="https://img.shields.io/badge/typescript-5-blue">
  <img alt="Status: alpha" src="https://img.shields.io/badge/status-alpha-orange">
</p>

> ⚠️ **loom은 활발히 개발 중인 알파 단계입니다.** 채팅 / 사무실 / claude-code 경로는 로컬 일상 사용에 충분히 안정적입니다. 나머지 어댑터·프로젝트 템플릿·검색은 아직 작업 중 — [**상태**](#상태)에서 정직한 현황을 보세요.

## loom은 뭔가요?

### CLI 코딩 에이전트들이 함께 일하는 사무실.

**Claude Code가 한 명의 터미널이라면, loom은 다섯 명이 같이 일하는 방.**

loom은 Node.js 서버 + React UI로, 여러 CLI 코딩 에이전트(Claude Code, Gemini, Codex, OpenCode)를 한 워크스페이스 안에서 굴리고, 그들의 대화를 그룹 채팅처럼 묶고, 만지는 파일을 실시간으로 추적하고, 실제로 코드를 읽고 싶을 땐 한 번 클릭으로 진짜 IDE를 열어주는 도구입니다.

겉보기엔 채팅 앱 + 작은 픽셀 사무실이지만, 안쪽엔 git worktree, session resume, 비용 원장, MCP 추적, 그리고 **에이전트 입력을 항상 명시적으로 유지하는** 디스패처가 있습니다.

**한 스레드에 여러 에이전트, 한 워크스페이스에 베이비시팅 없음.**

| 단계 | 예 |
|------|---|
| **01** | 팀을 뽑는다: `@frontend`, `@backend`, `@reviewer` — 각자 모델·프롬프트·예산을 가진 진짜 CLI 에이전트 |
| **02** | 스레드를 시작: _"인증을 NextAuth로 마이그레이션하고 테스트도 짜줘."_ |
| **03** | 일하는 걸 본다: 캐릭터들이 자기 자리로 걸어가서 파일을 편집하고 서로에게 위임. 채팅을 읽다 깊게 파고 싶으면 `IDE` 클릭 |

> **곧 추가: gemini / codex / opencode 어댑터** — 같은 명시적 입력 규약, 어댑터 한 개당 약 40줄. 현재 안정 어댑터는 **claude-code**고, 나머지는 골격만 잡혀 registry 등록만 남은 상태.

### 이런 CLI들과 같이 씁니다

| 어댑터 | 명령어 | 입력 방식 | 노출되는 것 |
|---|---|---|---|
| **Claude Code** | `claude` | stdin (`--print -`) | session_id · tool_use · 비용 · MCP 호출 |
| **Gemini CLI** | `gemini` | stdin (non-TTY) | _어댑터 골격만_ |
| **Codex** | `codex exec` | 마지막 인자 | _어댑터 골격만_ |
| **OpenCode** | `opencode run` | 마지막 인자 | _어댑터 골격만_ |

_stdout으로 한 이벤트씩 말할 수 있다면, 사무실에 입주 가능._

---

## 상태

loom은 **알파**입니다 — 로컬에서 쓸 수 있지만, 운영이나 공유 배포에는 아직 단단하지 않습니다. 아래는 영역별 정직한 현황입니다.

### ✅ 안정 — 일상 사용 가능

| 영역 | 동작 |
|---|---|
| **claude-code 어댑터** | stream-json 파싱, poison cascade가 적용된 세션 resume, 비용 캡처, 도구 추출 |
| **스레드 + 런** | 전체 라이프사이클, SSE 로그 스트리밍, 스레드별 git worktree, `run_changes` 영속화 |
| **사무실 뷰** | 픽셀 디오라마, 캐릭터 상태머신(idle / walking / sitting), 라이브 말풍선 |
| **채팅 dock** | VS Code 터미널 패턴, ⌘J 토글, 높이 영속, ThreadList 사이드바 |
| **파일 워크스페이스** | 라이브 presence 점, run별 diff 뷰어, 파일 히스토리 레일, ⌘P 팔레트 |
| **IDE에서 열기** | VS Code / Cursor / Antigravity / Zed / IntelliJ — PATH → 앱 번들 → `open -a` 폴백 |
| **프로젝트 단위 env** | 공유 API 키, 에이전트 단위 오버라이드, agent env보다 낮은 우선순위 |
| **스펙 (markdown 스킬)** | 메시지마다 첨부, 자동 주입 절대 X |
| **라이트 / 다크 테마** | 픽셀 sprite와 사무실 방까지 전부 적용 |

### 🚧 개발 중 — 골격은 있지만 아직 주력 아님

| 영역 | 남은 일 |
|---|---|
| **gemini 어댑터** | `defineCliAdapter` 골격 있음. registry 등록 + 스모크 테스트 필요 |
| **codex 어댑터** | 동일 — stdin 대신 argv-mode 프롬프트 |
| **opencode 어댑터** | 동일 — `opencode run <prompt>` |
| **MCP 서버 칩** | 추출+책상 표시는 되지만 서버별 설정 UI 없음 |
| **Diff 기반 PR 생성** | 브랜치 + before/after refs 캡처는 됨. PR 버튼이 아직 없음 |
| **런 로그 전문 검색** | 로그는 디스크에 영속됨. 검색 인덱스가 아직 없음 |

### 📋 계획 중

| 아이디어 | 스케치 |
|---|---|
| **프로젝트 템플릿 import** | 에이전트 + 스킬 + env를 단일 JSON으로 export → 새 프로젝트에 import |
| **에이전트 간 위임 힌트** | `[NEXT]` / `[ASK]` 마커를 UI가 hand-off 칩으로 렌더 |
| **사무실 데코 베리에이션** | 카페 / 도서관 / 코워킹 등 다른 분위기의 방 |
| **모바일 / 폰 레이아웃** | 사무실 캔버스는 이미 스케일됨. 채팅 + 스레드 스위처에 세로형 스킨 필요 |

### 🚫 의도적으로 **안 하는 것**

`CLAUDE.md`가 못 박은 명시적 비-목표:

- 시스템 프롬프트, AGENTS.md, 스킬 번들 자동 주입
- "에이전트 마켓플레이스" / 플러그인 레지스트리
- 멀티 테넌트 인증 / 클라우드 호스팅
- 자체 비용 추정 (CLI가 보고하는 값만 표시)

---

## 이런 분께 좋습니다

- ✅ 같은 레포에 **Claude Code 터미널 세 개를 띄워놓고** 누가 뭘 했는지 잊어버린 경험이 있는 분
- ✅ **하나의 채팅 스레드**에서 `@backend`가 마이그레이션을 짜고 `@frontend`가 폼을 짜는 걸 슬랙처럼 읽고 싶은 분
- ✅ **에이전트가 어떤 파일을 만지고 있는지 실시간으로** 보고, "지금 그 run이 정확히 뭘 바꿨지?"의 diff를 보고 싶은 분
- ✅ **진짜 IDE에서 코드를 읽고 싶은** 분 (VS Code / Cursor / Antigravity / Zed / IntelliJ) — 또 다른 웹 Monaco 말고
- ✅ **세션 resume**, **스레드별 git worktree**, **run별 비용**을 직접 짜기 싫은 분
- ✅ 메시지에 **시스템 프롬프트가 몰래 붙는 일이 절대 없는** 코딩 에이전트 러너를 원하는 분

---

## 주요 기능

### 💬 에이전트들의 그룹 채팅

스레드가 일급 객체. 스레드 안에서 `@`로 어떤 에이전트든 멘션하고, 메시지 중간에 위임하고, 답변을 다음 메시지에 인용. 인용은 정확한 원문 — 요약 아님.

### 🏢 픽셀 사무실 (진짜로)

"사무실" 뷰는 작은 디오라마. 에이전트는 idle일 때 사무실을 어슬렁거리고, run이 시작되면 자기 책상으로 걸어가서 앉고, 머리 위 말풍선이 지금 편집 중인 파일이나 사용 중인 도구를 보여줍니다. 캐릭터 클릭 → 그 에이전트와 대화. 하루 종일 띄워두는 글랜스용 보드.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dark-office.png">
  <img alt="사무실 뷰" src="docs/assets/light-office.png">
</picture>

### 📂 라이브 파일 활동

파일 트리 점이 에이전트가 파일을 여는 순간 밝아짐. 탭 바는 당신이 타이핑하는 동안 `@backend가 auth.ts:42 편집 중`을 표시. run이 끝나도 점은 남아 — 파일이 어떤 run이 만졌는지 기억. 점을 눌러 그 대화로 점프.

### 🔧 도구 & MCP 가시성

CLI의 `tool_use` 스트림을 라이브로 파싱. Read / Edit / Write / Bash / Grep / WebFetch 모두 에이전트 책상에 칩으로 표시. `mcp__server__method` 호출은 "사용 중인 MCP 서버" 알약으로 묶음. 에이전트가 _진짜로_ 뭘 하고 있는지 추측 X.

### 🌿 워크트리로 격리된 스레드

스레드를 "isolated"로 표시 → loom이 새 `git worktree` 생성, run마다 그 worktree로 `cd`, 스레드 삭제 시 정리. 같은 레포에 대해 두 스레드가 충돌하는 편집을 동시 진행해도 서로 안 밟음.

### 💰 정직한 비용

CLI가 직접 보고한 비용만 표시 — claude-code의 `total_cost_usd` 그대로. 토큰 추정 X. 메시지마다 run 비용, 바에 스레드별 합계, 프로젝트 화면에 프로젝트 합계.

### 🔁 세션 resume

매 run마다 CLI의 `session_id` 캡처. 같은 스레드 + 에이전트의 다음 run이 자동으로 `--resume`. 한 번이라도 실패한 세션 id는 poisoned 처리 → 다시는 시도 안 함.

### ✏️ 스펙 첨부

`Specs`에 적은 markdown 스킬, 메시지에 *당신*이 클립을 클릭할 때만 첨부. 자동 주입 절대 X. 프롬프트에 `=== Skill: <name> ===` 블록으로 합성.

### 🔌 진짜 IDE에서 열기

모든 파일(과 모든 프로젝트 카드)에 버튼 하나 — **VS Code, Cursor, Antigravity, Zed, IntelliJ** 중 선택해서 정확한 라인으로. PATH의 `code` → 앱 번들 절대경로 → `open -a "<App>"` 순으로 폴백해서 셸 커맨드 안 깔아도 동작.

### 🎨 모든 게 테마 인식

라이트, 다크, 시스템. 픽셀 sprite, 사무실 벽, 카펫, 모니터까지 — 전부 CSS 변수가 운전. 테마 토글하면 디오라마도 같이 토글.

---

## loom이 풀어주는 문제

| loom 없을 때 | loom과 함께 |
|---|---|
| ❌ 터미널 다섯 개 열려있고, 서로의 존재를 모름. 컨텍스트를 손으로 복붙. | ✅ 한 스레드, `@mention`으로 에이전트 전환. 모두가 같은 대화를 본다. |
| ❌ "에이전트가 끝났나?" 확인하려면 터미널로 alt-tab 후 스크롤백 응시. | ✅ 사무실 뷰에 누가 자기 자리에 있는지 보이고, 말풍선이 지금 편집 중인 파일을 알려줌. |
| ❌ "방금 그 run이 어떤 파일을 바꿨지?" → `git diff`하고 기도. | ✅ 매 run마다 before/after git ref 캡처, `run_changes` 영속화, run이 끝나도 파일 트리에 표시 유지. |
| ❌ 각 CLI가 자기 로그 포맷. 비용 숫자가 흩어짐. | ✅ 한 SSE 스트림, 어댑터당 한 파서. 비용은 CLI가 보고한 그대로 — 캡처 / 합산 / 표시. |
| ❌ 두 에이전트가 같은 레포를 편집하다 서로 밟음. | ✅ 스레드를 "isolated"로 → 자기 git worktree. 두 스레드가 충돌하는 편집을 동시에. |
| ❌ 진짜 에디터를 옆 창에 띄워두고 웹앱 Monaco에서 코드 읽기. | ✅ 한 클릭으로 파일(과 라인 번호)을 VS Code / Cursor / Antigravity / Zed / IntelliJ로. |
| ❌ 웹 도구가 매 메시지에 시스템 프롬프트 + 40k의 "도움 되는 컨텍스트"를 몰래 붙임. | ✅ CLI가 받는 건: 당신이 친 텍스트 + 당신이 클립한 스펙. 그 외는 절대 X. |

---

## 왜 loom이 특별한가

loom은 _조용한_ 오케스트레이션 문제들을 정직하게 풉니다.

**명시적 입력.**
계약: _사용자 프롬프트 + 사용자가 첨부한 스펙 → CLI stdin/argv._ 시스템 프롬프트 주입 없음, AGENTS.md 자동 발견 없음, 스킬 번들 없음. 예측 가능한 비용, 예측 가능한 동작, "왜 갑자기 내 .env를 알지?"가 없음.

**라이브 도구 추출.**
어댑터가 stream-json에서 `tool_use` 이벤트를 전체 run 버퍼링 없이 파싱. 사무실 책상은 에이전트가 도구 집은 지 약 1초 안에 업데이트. MCP 호출(`mcp__server__method`)은 `(server, method)`로 분리해서 각 책상 옆에 "github" / "context7" 알약 표시.

**Poison-aware 세션 resume.**
실패한 `--resume <id>`는 그 세션 id를 영구 poison. 스레드는 죽은 세션에 매달리지 않고 앞으로 진행 — "No conversation found" 무한 재시도가 더 이상 없음.

**스레드-as-워크트리.**
isolated 스레드는 dangling git worktree를 만들고 에이전트가 거기로 `cd`. 스레드 삭제 시 정리. 브랜치는 머지할 때까지 살아있고, before/after refs는 `run_changes` 행으로 영속화돼서 `git gc` 후에도 살아남음.

**spawn-process 추상화 하나.**
`@loom/adapter-utils`가 `defineCliAdapter()`와 `spawnProcess()`를 export. 새 어댑터는 약 40줄: 명령 빌드, stdin/argv 선택, 등록. 프레임워크 X, 플러그인 마켓 X, DI 컨테이너 X.

**픽셀 사무실은 데이터, 장식 아님.**
사무실의 모든 애니메이션이 실제 상태를 반영 — 말풍선은 `activeTools.recent`를 읽고, 화면 펄스는 `working === true`, 캐릭터가 가는 책상은 자기 할당된 슬롯. 어떤 것도 장식이 아님.

---

## 내부 구조

```
┌──────────────────────────────────────────────────────────────────┐
│                        LOOM 서버 (Hono)                          │
│                                                                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐  │
│  │  프로젝트  │  │   스레드   │  │     런     │  │   어댑터   │  │
│  │   + env    │  │ + worktree │  │  + 세션    │  │   + 비용   │  │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘  │
│                                                                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐  │
│  │  Active    │  │  Active    │  │   Run      │  │   Git      │  │
│  │  touches   │  │  tools     │  │  changes   │  │  snapshots │  │
│  │  (메모리)  │  │  (메모리)  │  │  (sqlite)  │  │   (refs)   │  │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘  │
│                                                                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐  │
│  │   스펙     │  │  Open-in-  │  │  Run별     │  │   헬스     │  │
│  │ (markdown) │  │  IDE 릴레이│  │  Log SSE   │  │   체크     │  │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘  │
└──────────────────────────────────────────────────────────────────┘
                              ▲
       ┌──────────────────────┼──────────────────────┐
       │            stream-json / pty                │
   ┌───┴───┐    ┌────────┐   ┌───────┐   ┌──────────┐
   │claude │    │ gemini │   │ codex │   │ opencode │   ← stdin/argv
   │ code  │    │   CLI  │   │  exec │   │   run    │      CLI 누구나
   └───────┘    └────────┘   └───────┘   └──────────┘     약 40줄로
```

### 시스템 별 설명

**프로젝트** — 디스크 경로 + 프로젝트별 env 변수(agent env보다 낮고 OS env보다 높은 우선순위) + "열기" 버튼이 사용할 IDE. 여러 프로젝트, 한 서버.

**스레드** — 일급 대화 컨테이너. 상태(active/done/archived), 큐레이션된 컨텍스트 번들, 옵션으로 격리된 git worktree, 위임 체인. 채팅 dock 안 `ThreadList` 사이드바가 터미널 탭 등가물.

**런** — 매 CLI 호출이 한 행. 상태, exit code, prompt, 첨부된 spec id, before/after git refs, 비용, 캡처된 session id, resume 시도한 session id. 각 에이전트가 뭘 했는지의 완전한 감사 추적.

**어댑터** — 각 CLI는 얇은 모듈: `buildCommand()` → `{command, args}`, 공유 `spawnProcess`로 spawn, 옵션으로 `extractSessionId` / `extractTouchedEdits` / `extractToolUses`. `apps/server/src/adapters/registry.ts`에 등록. 새 어댑터는 그냥 추가.

**Active touches & tools** — 메모리 인-메모리, run 끝나면 비움. 라이브 "@backend가 auth.ts 편집 중" 펄스, 사무실 말풍선, MCP 서버 알약을 구동.

**Run changes & git snapshots** — Before/after work-tree 스냅샷(dangling 커밋) → diff stat → 영속화된 `run_changes` 행. `git gc` 후에도 생존. 파일 히스토리 레일과 run별 diff 뷰를 구동.

**스펙** — 메시지에 첨부 가능한 markdown 문서. 프롬프트에 `=== Skill: <name> ===` 블록으로 합성. 자동 주입 X.

**Open-in-IDE** — Spawn 릴레이: PATH 검색 → 앱 번들 절대경로 → `open -a "<App Name>"` 폴백 (macOS). 아무것도 못 찾으면 후보 목록 같이 404.

**Log SSE** — Run당 한 스트림, `text/event-stream`, 재연결 시 디스크에서 replay. 채팅 패널이 파싱된 이벤트를 렌더, 라이브 tail은 계속 스트림.

---

## loom이 아닌 것

**Claude Code 래퍼 아님.**
loom은 어떤 에이전트도 번들하지 않습니다. CLI 바이너리(claude, gemini, codex, opencode 또는 stdin으로 프롬프트 받고 stdout 찍는 무엇이든)는 당신이 가져옴.

**자율 에이전트 아님.**
loom은 다른 에이전트를 호출할지 결정하지 않습니다. 매 위임은 버튼 누름. 매 스펙 첨부는 체크박스 틱. 사용자가 의도적으로 루프 안에 있음.

**프롬프트 매니저 아님.**
시스템 프롬프트를 합성하지 않고, 모델을 선택해 주지 않으며, "스킬 마켓플레이스"를 운영하지 않습니다. 모델은 `agent.adapterConfig.model`에. 프롬프트는 `agent.prompt`에.

**코드 에디터 대체 아님.**
Monaco는 에디터 뷰에서 diff 검사용으로 살지만, "IDE에서 열기" 버튼이 실제 편집의 주력 경로. 사용자의 진짜 IDE를 일급 목적지로 대우 — 폴백이 아님.

**멀티 테넌트 아님.**
로컬 단일 사용자 도구. SQLite, 인증 없음, 팀 계정 없음. 공개 IP에 올리면 당신 권한으로 임의 명령을 실행함.

**워크플로우 빌더 아님.**
DAG 없음, 노드 없음, 캔버스 없음. 그냥 스레드, 런, 에이전트, 그들 사이의 메시지.

---

## 화면

### 사무실 — 픽셀 디오라마

<table>
  <tr>
    <td width="50%"><img alt="라이트 사무실" src="docs/assets/light-office.png"></td>
    <td width="50%"><img alt="다크 사무실" src="docs/assets/dark-office.png"></td>
  </tr>
</table>

캐릭터들이 idle일 때 통로에서 어슬렁, run이 시작되면 자기 책상으로 걸어가고, 말풍선이 만지는 파일이나 사용 중인 도구를 알려줌. 창문, 커피 머신, 책장, 화분 — 모두 SVG `<rect>` 픽셀 아트가 CSS 변수로 운전돼서 라이트/다크에 자동 적응.

### 에디터 — Monaco + diff

<table>
  <tr>
    <td width="50%"><img alt="라이트 에디터" src="docs/assets/light-editor.png"></td>
    <td width="50%"><img alt="다크 에디터" src="docs/assets/dark-editor.png"></td>
  </tr>
</table>

"편집기" 탭이 디오라마를 진짜 파일 뷰어로 교체. run별 diff와 어떤 run이 그 파일을 만졌는지 보여주는 "히스토리" 레일. 툴바의 `IDE에서 열기` 버튼이 현재 파일(과 활성 라인)을 진짜 에디터로 보냄.

### 프로젝트 — 여러 레포, IDE 선택

<table>
  <tr>
    <td width="50%"><img alt="라이트 프로젝트" src="docs/assets/light-projects.png"></td>
    <td width="50%"><img alt="다크 프로젝트" src="docs/assets/dark-projects.png"></td>
  </tr>
</table>

각 카드에 에이전트 수와 프로젝트별 선호 IDE (VS Code / Cursor / Antigravity / Zed / IntelliJ). "열기" 버튼은 그 IDE의 CLI가 PATH에 있든 없든 동작.

### 에이전트 — 프로젝트별 작은 조직도

<table>
  <tr>
    <td width="50%"><img alt="라이트 에이전트" src="docs/assets/light-agents.png"></td>
    <td width="50%"><img alt="다크 에이전트" src="docs/assets/dark-agents.png"></td>
  </tr>
</table>

각 에이전트는 이름, 역할, 색상, 어댑터 종류, 모델, 커스텀 프롬프트, 옵션의 autonomy를 가짐. 카드는 할당된 스킬 + 공유 API 키용 프로젝트 단위 env 편집기.

### 스킬 — 당신이 직접 켜는 markdown

<table>
  <tr>
    <td width="50%"><img alt="라이트 스킬" src="docs/assets/light-skills.png"></td>
    <td width="50%"><img alt="다크 스킬" src="docs/assets/dark-skills.png"></td>
  </tr>
</table>

스킬은 평범한 markdown 파일. 메시지의 클립을 틱해서 첨부 — 자동 주입 X, 깜짝 컨텍스트 X.

### 히스토리 — 모든 run, 영원히

<table>
  <tr>
    <td width="50%"><img alt="라이트 히스토리" src="docs/assets/light-history.png"></td>
    <td width="50%"><img alt="다크 히스토리" src="docs/assets/dark-history.png"></td>
  </tr>
</table>

에이전트 / 상태 / 스레드로 필터. 각 행이 run 페이지(전체 로그 + diff)와 원본 채팅 메시지로 연결.

---

## 빠른 시작

자체 호스팅, 단일 바이너리 느낌. 로컬 개발 전용 — 인증 X, 클라우드 X.

### 필수 요구사항

- **Node.js ≥ 22**
- **pnpm ≥ 9**
- 지원하는 CLI 중 하나 이상이 PATH에 설치: `claude`, `gemini`, `codex`, `opencode`

### 실행

```bash
git clone https://github.com/Chu5491/loom.git
cd loom
pnpm install
pnpm dev
```

두 프로세스가 뜸:

- **서버** `http://localhost:3200` — REST + SSE
- **웹** `http://localhost:3201` — 브라우저로 열기

디스크의 레포를 가리키는 프로젝트 생성, 에이전트 추가(CLI 명령 이름 입력), 스레드에 메시지 보내기.

### 빌드 검증

```bash
pnpm -r typecheck      # 모든 패키지
pnpm -r test           # vitest (서버 + 어댑터)
pnpm --filter @loom/web build
```

---

## FAQ

**`pnpm dev` 외에 뭔가 더 띄워야 하나요?**
아니요. SQLite는 첫 부팅 시 `~/.loom/loom.db`에 생성. 로그는 `~/.loom/logs/`. 워크트리는 `~/.loom/worktrees/`. 별도 Postgres / Redis 없음.

**왜 시스템 프롬프트를 자동 주입 안 하나요?**
예측 가능한 비용, 예측 가능한 동작, 예측 가능한 보안 표면. 시스템 프롬프트가 필요하면 스펙으로 적고 첨부하세요. CLI는 당신이 친 것 + 당신이 틱한 것만 봅니다 — 그 외 X.

**한 스레드에서 여러 에이전트가 동시 작업 가능한가요?**
가능합니다. 매 `@mention`이 새 run을 spawn, 각 run이 실시간 스트림. 사무실 뷰는 그들이 자기 책상에 동시에 앉아있는 걸 보여줌.

**제 IDE가 PATH에 없으면요?**
"열기" 버튼이 시도하는 순서: PATH 명령(`code`, `cursor`, `zed`, ...) → 앱 번들 절대경로(`/Applications/Visual Studio Code.app/...`) → macOS `open -a "<App>"`. 대부분의 macOS 사용자는 셸 커맨드 안 깔고도 2번이나 3번에서 잡힙니다.

**새 CLI 어댑터를 어떻게 추가하나요?**
`packages/adapters/claude-code/`를 복사해서 `kind`와 `buildCommand`만 바꾸고, `apps/server/src/adapters/registry.ts`에 등록. 약 40줄. 계약은 [`CLAUDE.md §4`](./CLAUDE.md) 참고.

**"isolated" 스레드가 뭔가요?**
자기만의 git worktree를 가진 스레드. 에이전트가 매 run마다 그 worktree로 `cd`. 두 스레드가 충돌하는 편집을 병렬로 진행해도 충돌 X. 스레드 생성 시 토글.

**Windows에서 돌아가나요?**
서버는 POSIX 경로 규약과 macOS 친화 IDE 릴레이 폴백을 사용합니다. Linux 가능. Windows는 stdin spawn은 동작할 듯하지만 `open -a` 폴백은 안 됨, 테스트도 안 함.

---

## 개발

```bash
pnpm dev                         # 풀 스택 (서버 :3200 + 웹 :3201, watch)
pnpm dev:server                  # 서버만
pnpm --filter @loom/web dev      # 웹만
pnpm -r typecheck                # 모든 패키지
pnpm -r test                     # 모든 단위 테스트 (vitest)
pnpm --filter @loom/server test  # 서버 테스트만
pnpm -r build                    # 프로덕션 빌드
```

### 폴더 구조

```
loom/
├── apps/
│   ├── server/        Hono API + SQLite + run executor + git snapshots
│   └── web/           React SPA + Vite + TanStack Query + Tailwind v4
└── packages/
    ├── core/                      공유 타입 (Project, Run, Thread, …)
    ├── adapter-utils/             defineCliAdapter() + spawnProcess()
    └── adapters/
        ├── claude-code/           안정
        ├── gemini/                골격
        ├── codex/                 골격
        └── opencode/              골격
```

작업 규약(이름, 주석, 추상화 룰)은 [`CLAUDE.md`](./CLAUDE.md), 원래의 설계 의도는 [`SLIM-HARNESS-DESIGN.md`](./SLIM-HARNESS-DESIGN.md) 참고.

---

## 🔌 새 CLI 붙이기

새 어댑터는 파일 한 개. `claude-code` 어댑터 축약본:

```ts
import { defineCliAdapter } from "@loom/adapter-utils";

export const claudeCodeAdapter = defineCliAdapter({
  kind: "claude-code",
  buildCommand: (cfg) => ({
    command: cfg.command ?? "claude",
    args: ["--print", "-", "--output-format", "stream-json", "--verbose",
           ...(cfg.model ? ["--model", cfg.model] : []),
           ...(cfg.extraArgs ?? [])],
  }),
  prompt: { via: "stdin" },
  applyResume: (args, sessionId) => ["--resume", sessionId, ...args],
  extractSessionId: extractClaudeSessionId,
  extractTouchedEdits: extractClaudeTouchedEdits,
  extractToolUses: extractClaudeToolUses,
});
```

등록:

```ts
// apps/server/src/adapters/registry.ts
import { claudeCodeAdapter } from "@loom/adapter-claude-code";
import { yourAdapter } from "@loom/adapter-yours";

export const adapters: Record<string, CliAdapter> = {
  "claude-code": claudeCodeAdapter,
  "yours":       yourAdapter,
};
```

이게 계약의 전부. **CLI는 stdin/argv + signals를 받음. 웹은 stdout 청크 + 파싱된 이벤트를 받음. 그 외 흐르는 거 X.**

---

## 로드맵

- ✅ 라이브 파일 presence + active touches
- ✅ 픽셀 사무실 + 캐릭터 상태머신 + 말풍선
- ✅ Open-in-IDE 릴레이 (vscode / cursor / antigravity / zed / intellij)
- ✅ 프로젝트별 env + 스레드별 격리 worktree
- ✅ Run별 비용 캡처, 스레드별 합산
- ✅ 실패 시 poison되는 세션 resume
- ✅ stream-json에서 도구 & MCP 추출
- ⚪ gemini / codex / opencode 어댑터를 registry에 등록
- ⚪ Run 로그 replay 검색 (전문)
- ⚪ Diff 기반 PR 생성
- ⚪ 에이전트 간 위임 패턴 (`[NEXT]` / `[ASK]`)
- ⚪ 프로젝트 템플릿 import (에이전트 + 스킬 + env)

---

## 📜 라이선스

MIT © 2026 — 진짜 에디터에서 코드를 읽고 싶은 사람들을 위해.
