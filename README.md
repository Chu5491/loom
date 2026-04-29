# loom

> **Slim, pass-through orchestrator for multi-agent CLI workflows.**
> Claude Code · Gemini · Codex · OpenCode 네 가지 CLI를 하나의 웹 UI에서 협업시키는 얇은 dispatcher.

[![status](https://img.shields.io/badge/status-active-brightgreen)](#)
[![node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)](#)
[![license](https://img.shields.io/badge/license-MIT-blue)](#)

---

## 한 줄 요약

여러 CLI 에이전트(claude / gemini / codex / opencode)를 *프로젝트별 thread*로 묶어 채팅하듯 협업시키되, 작업 결과(파일 변경 / diff / 비용)를 같은 화면에서 추적하는 **VSCode + Discord** 류의 단일 워크스페이스.

핵심 신념: **자동 주입은 죄.** 사용자가 적은 prompt + 사용자가 명시적으로 attach한 context — 그게 CLI에 도달하는 입력의 전부다.

---

## 무엇을 할 수 있나

### 멀티-에이전트 채팅
- 프로젝트별 **Thread**로 대화 그룹핑 (이름·상태·context bundle)
- **Reply / Hand-off** — 같은 에이전트 이어가기 / 다른 에이전트로 명시적 위임
- **Broadcast composer** — 한 메시지를 N개 에이전트에 동시 전송 (모두 같은 thread 안에)
- **@mention 자동완성** — `@`로 에이전트 빠른 선택, target chip 자동 추가
- **부분 인용** — 답변에서 텍스트 드래그 → "Quote selection" → 다음 메시지에 인용
- 메시지에서 **부모 점프** 클릭 가능한 hand-off 뱃지로 사슬 시각화

### 작업물 가시화
- **Workspace** = 우측 채팅 drawer + 가운데 파일 뷰어 + 좌측 파일 트리
- 채팅과 파일을 *동시에* 볼 수 있음 — `⌘L`로 채팅 drawer 토글
- **ChangedFiles 패널** — 각 run이 만진 파일 목록 + +/-, unified diff 인라인 펼침
- **트리 데코레이션** — 만진 파일에 점, 닫힌 폴더에 변경 파일 수 뱃지
- **파일 history** — 한 파일을 어떤 에이전트가 언제 어떻게 만졌는지 시간순
- **시점별 diff** — history 행 클릭 → 그 시점에 한 변경의 unified diff
- 파일 ↔ 채팅 양방향 점프 (파일 history → 그 메시지로 / ChangedFiles 클릭 → 파일)

### Context Bundle
- Thread별 markdown 메모를 사용자가 직접 작성·편집
- composer 토글로 **명시 attach** — 자동 주입 안 함
- attach 시 prompt에 `=== Thread Context ===` 섹션으로 prepend
- per-thread 토글 상태 영구화

### Worktree 격리
- "새 isolated thread" 만들면 **`git worktree`로 별도 체크아웃** 생성
- 같은 프로젝트의 여러 thread가 충돌 없이 동시 진행 가능
- thread 삭제 시 worktree 자동 cleanup
- `~/.loom/worktrees/<thread-id>` 경로, `loom/thread-<short>` 브랜치

### 비용 추적
- 각 run의 stream-json `result.total_cost_usd`를 실시간 캡처 → DB 저장
- 메시지 status 옆 `$0.0042`, ThreadBar에 thread 총 비용
- 어댑터가 비용 안 알려주면 NULL — 토큰 추정 안 함

### 검색 / 단축키
- **`⌘P`** — 파일 fuzzy search 팔레트 (subsequence + basename + streak 가중치)
- **`⌘L`** — 채팅 drawer 토글
- **`⇧⌘A`** — 활성 thread archive/unarchive

### 어댑터 4종
- 모두 `defineCliAdapter` 팩토리 (~40줄/어댑터, 공통 모양)
- `claude-code` (stdin · stream-json · cost) · `gemini` (stdin) · `codex` (arg) · `opencode` (arg)

---

## 의도적으로 빠진 것

| 항목 | 이유 |
| --- | --- |
| **자동 위임 / sub-agent 트리** | 매 hand-off는 사용자 confirm — "loom은 손잡이를 사용자가 쥐는 도구" |
| **고정 워크플로우** | 사용 패턴이 굳기 전에 추상화하면 잘못 잡음 (rule of three) |
| **에이전트 자동 발견 / 플러그인 마켓** | 어댑터는 패키지로 코드에 등록 |
| **여러 사용자 / 인증** | 단일 사용자 로컬 도구 |
| **AGENTS.md 자동 주입** | "자동 주입은 죄" — Context Bundle로 대체 |

남은 후보 (커밋 안 한 디자인): 에이전트 제안 패턴 `[NEXT]` / `[ASK]`, 워크플로우 템플릿(`.loom/workflows/*.yml`).

---

## 빠른 시작

```bash
git clone https://github.com/Chu5491/loom.git
cd loom
pnpm install
pnpm dev      # 서버(:3200) + 웹(:3201) 병렬 실행
```

브라우저: <http://localhost:3201>

```bash
pnpm -r typecheck
pnpm -r test       # server + adapter 단위 테스트
pnpm -r build
```

---

## 워크스페이스 레이아웃

```
┌── Sidebar ─┬──────── Workspace ────────────────────────────────────┐
│            │ ┌── TopAgentsStrip ─────────────────────────────────┐ │
│            │ │ MEMBERS · 4   🤖 백엔드[● 47s]  🤖 프엔지[idle]   │ │
│            │ ├────────────────────────────────────────────────────┤ │
│            │ │ ┌─Files─┬───── Center ─────┬──── Chat drawer ────┐ │ │
│            │ │ │ ▾ src │ src/auth.ts ×    │ 💬 thread name      │ │ │
│            │ │ │   .ts │ ─────────────── │ ─────────────────── │ │ │
│            │ │ │ ▾ ts/ │  파일 / diff     │  메시지들            │ │ │
│            │ │ │       │                  │                     │ │ │
│            │ │ │       │                  │  composer + 📎      │ │ │
│            │ │ └───────┴──────────────────┴─────────────────────┘ │ │
│            │ └────────────────────────────────────────────────────┘ │
└────────────┴────────────────────────────────────────────────────────┘
                                ↑ ⌘L로 drawer 토글, ⌘P로 파일 검색
```

- **Sidebar** — 프로젝트 목록 + 테마/언어 (collapsible)
- **TopAgentsStrip** — 프로젝트 멤버 + 현재 작업 중인 에이전트 (가로 스트립)
- **Files panel** — 좌측 트리 (touched 파일 점/뱃지, collapsible)
- **Center** — 파일 탭 시스템 (탭 + 뷰어 + 시점별 diff)
- **Chat drawer** — 우측 토글 가능 (440px), 안에 ThreadBar + 메시지 + composer

---

## 폴더 구조

```
loom/
├── apps/
│   ├── server/                 @loom/server (Hono + better-sqlite3)
│   │   ├── src/
│   │   │   ├── adapters/registry.ts
│   │   │   ├── db/             schema + migrations + projects/agents/specs/
│   │   │   │                    runs/threads/run-changes
│   │   │   ├── routes/         projects · agents · specs · runs · threads · adapters · health
│   │   │   └── services/       run-service · log-store · git-snapshot ·
│   │   │                        worktree · project-fs
│   │   └── test/               run-lifecycle · specs
│   └── web/                    @loom/web (React + Vite + TanStack Query)
│       └── src/
│           ├── pages/          HomePage · WorkspacePage · ProjectsPage ·
│           │                   AgentsPage · SpecsPage · RunsPage · RunDetailPage
│           ├── components/     Sidebar · ProjectShell · TopAgentsStrip ·
│           │                   Chat (ChatPanel + Composer + ChangedFiles) ·
│           │                   FilesTree · FileTab · FilePalette ·
│           │                   ContextDrawer · LoomLogo · AdapterIcon
│           ├── api/            client (REST + SSE)
│           ├── context/        Theme · I18n
│           └── i18n/           dictionaries (en/ko)
└── packages/
    ├── core/                   타입 (Project / Agent / Spec / Run / RunChange /
    │                            Thread / TouchedPath / FileContent / FileHistoryEntry) +
    │                            CliAdapter 인터페이스
    ├── adapter-utils/          spawnProcess · defineCliAdapter · 공통 probe
    └── adapters/
        ├── claude-code/        stream-json + stdin (cost 추적)
        ├── gemini/             stdin
        ├── codex/              arg
        └── opencode/           arg
```

---

## 데이터 모델 (간략)

```
Project (id, name, path, ...)
  ├── Agent (project_id, name, prompt, role, adapter_kind, adapter_config, default_cwd, skill_ids)
  │     └── agent_skills (M:N → Spec)
  ├── Thread (project_id, name, status, context_bundle, worktree_path)
  │     └── Run (agent_id, thread_id, parent_run_id, prompt, attached_spec_ids,
  │              cwd, before_ref, after_ref, cost_usd, status, ...)
  │           └── run_changes (path, status, additions, deletions, from_path)
  └── Spec (name, content, agent_id, tags)
```

`thread_id`는 일급 컨테이너. `parent_run_id`는 hand-off 사슬용 (한 thread 안에서 sub-grouping). `before_ref`/`after_ref`는 작업 트리 dangling commit으로 git diff 계산. `run_changes`는 영구 저장돼 git gc 후에도 살아남음.

---

## API 표면

```
# Projects
GET    /api/projects
GET    /api/projects/:id
POST   /api/projects
PATCH  /api/projects/:id
DELETE /api/projects/:id
GET    /api/projects/:id/tree?path=…           # 한 디렉토리 lazy
GET    /api/projects/:id/files-flat            # 전체 파일 path (Cmd+P)
GET    /api/projects/:id/file?path=…
GET    /api/projects/:id/touched               # touched paths + 최근 toucher
GET    /api/projects/:id/file-history?path=…   # 한 파일을 만진 run 시간순

# Threads
GET    /api/threads?projectId=…
GET    /api/threads/:id
POST   /api/threads                            # body.isolate=true → worktree
PATCH  /api/threads/:id                        # name / status / contextBundle
DELETE /api/threads/:id                        # worktree 자동 cleanup

# Runs
GET    /api/runs?agentId=&threadId=&status=
GET    /api/runs/:id
GET    /api/runs/:id/result                    # 최종 result text
GET    /api/runs/:id/changes                   # 파일 변경 목록
GET    /api/runs/:id/changes/patch?path=…      # 파일 unified diff
POST   /api/runs                               # body.includeContext / threadId / parentRunId
POST   /api/runs/:id/cancel
GET    /api/runs/:id/logs                      # SSE: chunk + done

# Agents / Specs / Adapters / Health  (표준 CRUD)
```

---

## 어댑터 추가 패턴

`@loom/adapter-utils`의 `defineCliAdapter` 팩토리가 보일러플레이트를 처리. 새 CLI ~40줄:

```ts
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
  prompt: { via: "stdin" },          // 또는 { via: "arg", flag: "--prompt" }
  resolveEnv: (cfg) => cfg.env ?? {},
});
```

추가 파일:
- `manifest.ts` — UI 폼 필드 정의
- `probe.ts` — 바이너리 존재 + 로그인 상태 확인
- `models.ts` — 사용 가능한 모델 조회
- `preset-models.ts` — 기본 모델 fallback
- `index.test.ts` — `buildXxxCommand` 단위 테스트

마지막으로 `apps/server/src/adapters/registry.ts`에 등록.

비용을 surface하려면 어댑터의 stdout JSON 라인에 `{"type":"result", "total_cost_usd": <number>}` 형태로 emit (서버가 이를 자동 캡처).

---

## 키보드 단축키

| 단축키 | 동작 |
| --- | --- |
| `⌘P` / `Ctrl+P` | 파일 검색 팔레트 |
| `⌘L` / `Ctrl+L` | 채팅 drawer 토글 |
| `⇧⌘A` / `Ctrl+Shift+A` | 활성 thread archive 토글 |
| `⏎` (composer) | 메시지 전송 |
| `⇧⏎` (composer) | 줄바꿈 |
| `@` (composer) | 멘션 자동완성 |
| `Esc` (palette/drawer) | 닫기 |

---

## 라이선스

MIT.
