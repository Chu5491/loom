# loom v2 마스터플랜 — 나만의 AI 오피스

> 최종 목표: CLI 도구들을 통합하고, 규약·스킬·MCP 스펙을 이 프로젝트 안에서 관리하며,
> 에이전트들이 하네스로 서로 소통하고, 개발자는 모든 행동·소통·관계를 눈으로 확인한다.
> git에 배포하면 어디서든 clone → install → 나의 오피스가 재현된다 (CLI는 사용자가 설치).

작성: 2026-06-10 · 기준 브랜치: v2-core · 풀 기능 v1은 main(1ea14f0)에 보존

---

## 헌법 (모든 단계를 지배하는 5원칙)

1. **CLI는 CLI 그대로** — loom은 그들이 모이는 방. 래핑하지 않고 spawn한다.
2. **자동 주입은 죄** — 사용자가 office/에 정의한 것만, 출처를 표시하고 주입한다.
3. **CLI root 불가침** — `~/.claude`, `~/.codex`, `~/.config/opencode` 등에 절대 쓰지 않는다.
   주입은 per-spawn 플래그·env·임시파일로만.
4. **정의는 git, 기록은 로컬** — `office/` = 휴대용 영혼(커밋), `data/` = 이 머신의 기억(gitignore).
5. **Raw는 진실, Parsed는 경험** — 원시 스트림은 항상 보존, 파싱 이벤트가 UX를 만든다.

## 디렉토리 설계 (office-as-code)

```
office/                      ← git 커밋 = 나의 오피스
  rules/global.md            ← 규약 (전역 + 에이전트별 참조)
  skills/<name>.md           ← 스킬 (frontmatter: name, description)
  mcp/servers.json           ← MCP 카탈로그 — secret은 "${ENV_NAME}" 참조만, 리터럴 금지
  agents/<name>.json         ← adapter, model, mention, prompt, rules[], skills[], mcp[]
  harness/edges.json         ← 핸드오프 규칙
data/                        ← gitignore = 이 머신의 기억
  loom.db                    ← runs/threads (sqlite — 런타임 기록 전용, 정의 금지)
  logs/<run>.ndjson          ← raw 스트림
  loadouts/                  ← per-run 주입 임시 작업물
.env.local                   ← secrets (gitignore)
```

## Spec 주입 매트릭스 (CLI root 불가침)

loadout-pointer 패턴(v1 검증): 스킬 본문은 디스크, 프롬프트엔 인덱스만.

| CLI | rules·스킬 | MCP | 격리 |
|---|---|---|---|
| claude-code | 프롬프트 합성 + `--add-dir` loadout | `--mcp-config` + `--strict-mcp-config` | 완전 |
| opencode | 프롬프트 합성 | `XDG_CONFIG_HOME` 오버라이드 | 완전 |
| codex | 프롬프트 합성 | `-c mcp_servers.*` 오버라이드 | 완전 |
| devin | `--agent-config` (선언적 JSON) | 자체 관리 (정책 안내) | 부분 |
| antigravity | 프롬프트 합성 | `--allowed-mcp-server-names` | 부분 |

## 통합 이벤트 모델 (파싱 → 경험)

```ts
type OfficeEvent =
  | { kind: "text";    text: string }
  | { kind: "tool";    name: string; target?: string }
  | { kind: "file";    path: string; action: "edit" | "write" }
  | { kind: "handoff"; toAgent: string; via: "edge" | "delegation" }
  | { kind: "result";  text: string; costUsd?: number; sessionId?: string }
  | { kind: "error";   message: string };
```

어댑터마다 `parseEvents(chunk): OfficeEvent[]` 하나 (v1 추출기 5종 통합).
서버: raw ndjson 저장 + 이벤트 SSE 푸시. UI는 이벤트만 구독.

## 하네스

- `edges.json`: `{from, to, trigger: on_success|on_fail|on_changes|manual, mode: ask|auto, prompt, carryResult}`
- run 종료 → 엣지 평가 → auto = 즉시 자식 run (hop guard 5단), ask = UI 제안 카드
- @mention 라우팅 (한 입력 → 여러 에이전트 분배)
- carry는 `=== Result from @name ===` 마크 블록 — 몰래 주입 없음
- CLI 내부 위임(Task tool)도 이벤트로 감지 → 그래프 표시

## GUI — 화면 3개

- **Talk**: 채팅·스레드, 에이전트 색·아이콘 버블, 인라인 툴칩·파일칩, @mention 컴포저
- **Office**: rules/skills/mcp/agents 편집 (파일과 양방향)
- **Connections**: 발견·연결·모델·연동 테스트 (완성됨)

우측 동행 패널: 라이브 하네스 그래프 (작업 중 글로우 펄스, 엣지 발화 애니메이션, ask 제안 점선+버튼).
디자인: 기존 미래지향 토큰 (near-black, violet→cyan, 글래스, Inter/Space Grotesk).

## 단계

| 단계 | 내용 | 검증 | 규모 |
|---|---|---|---|
| P1 | office/ 스키마(zod)·로더·CRUD API + Office 화면 | 파일 편집 ↔ UI 편집 왕복 일치 | 작음 |
| P2 | agents 파일 + 런 엔진 (spawn·sqlite 기록·raw 로그·parseEvents·SSE·세션 resume) | 실제 1턴 대화 + 이벤트 스트림 | 중간 |
| P3 | Talk 워크스페이스 (스레드·버블·@mention) | 한 스레드에서 두 에이전트 대화 | 중간 |
| P4 | 하네스 (edges·자동발화·ask 카드·라이브 그래프) | builder→reviewer 자동 핸드오프 실연 | 중간 |
| P5 | 휴대성 마감 (비용·피드·README·.env 패턴) | 새 폴더 clone → install → 오피스 재현 | 작음 |
| P6 | 폴리시 (온보딩, 문서 v2, 선택: diff 뷰) | — | 작음 |

## 재사용 vs 신규

- **main에서 cherry-pick**: composePrompt, loadout materializer, applyMcpServers(어댑터별),
  @mention 라우터, 하네스 triggerMatches·hop guard, 세션 resume·poison 처리
- **신규**: office 파일 로더·스키마, parseEvents 단일 파서, SSE 스트림, 모든 UI

## 컴팩트 규율

- 화면 3개 초과 금지 · rule of three 전 추상화 금지
- 의존성 추가는 커밋에 이유 명시 (예정: better-sqlite3 복귀 1개)
- 각 단계 끝: "새 머신에 clone해도 깨지지 않는가" 자문
