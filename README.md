# loom

> **Slim, pass-through orchestrator for multi-agent CLI workflows.**
> Claude Code · Gemini · Codex · OpenCode 네 가지 CLI를 하나의 웹 UI에서 띄우는 가벼운 dispatcher.

[![status](https://img.shields.io/badge/status-baseline-orange)](#)
[![node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)](#)
[![license](https://img.shields.io/badge/license-MIT-blue)](#)

> **Status (2026-04-29):** 4개 CLI 어댑터까지 연결된 베이스라인. 그 위에 얹었던 픽셀 룸·채팅 미션 패널·디스크 미러·수동 위임 chip은 모두 제거됨. **하네스 / 위임 / 스킬 관리 방식은 다음 디스커션 후에 결정됩니다.**

---

## 지금 동작하는 것

- `@loom/core` — 타입 + `CliAdapter` 인터페이스
- `@loom/adapter-utils` — `spawnProcess` + `defineCliAdapter` factory + 공통 probe
- **4개 어댑터** — Claude Code / Gemini / Codex / OpenCode (각 ~40줄, 공통 모양)
- 서버 (Hono + better-sqlite3):
  - `projects` / `agents` / `specs` / `runs` CRUD + `agent_skills` 다대다
  - SSE 로그 스트리밍 (`GET /api/runs/:id/logs`)
  - 어댑터 probe / models / test 라우트
  - `composePrompt` — 스킬을 프롬프트에 인라인하는 단순한 베이스라인 합성
- 웹 (React + Vite + TanStack Query):
  - 평면 nav: **Projects · Agents · Skills · Runs**
  - 각 페이지는 list + form
  - i18n (en/ko), 테마 (system/light/dark)

## 의도적으로 빠진 것

- 픽셀 사무실 / 채팅 UI / Mission Pane
- 자동 위임 / Hand-off chip / parent-child 위임 시각화
- 디스크 스킬 미러링
- 프로젝트 단위 nested routing
- Worktree 격리 / 비용 추적

이 결정들은 v0.x design discussion에서 합의 후 다시 추가됩니다.

---

## 빠른 시작

```bash
git clone https://github.com/Chu5491/loom.git
cd loom
pnpm install
pnpm dev    # 서버(:3200) + 웹(:3201) 병렬
```

브라우저: <http://localhost:3201>

```bash
pnpm -r typecheck
pnpm -r test    # 28개 케이스
pnpm -r build
```

---

## 폴더 구조 (베이스라인)

```
loom/
├── apps/
│   ├── server/           @loom/server
│   │   ├── src/
│   │   │   ├── adapters/registry.ts
│   │   │   ├── db/         schema + projects/agents/specs/runs/agent-skills
│   │   │   ├── routes/     projects/agents/specs/runs/adapters/health
│   │   │   └── services/   run-service · log-store
│   │   └── test/           run-lifecycle · specs (15 케이스)
│   └── web/              @loom/web
│       └── src/
│           ├── App.tsx       4 routes (flat)
│           ├── components/   Layout · ui · AdapterFields/Icon/Status/Test
│           ├── pages/        Projects · Agents · Specs · Runs · RunDetail
│           ├── context/      Theme · I18n
│           └── i18n/         dictionaries (en/ko)
└── packages/
    ├── core/             타입 + adapter 인터페이스
    ├── adapter-utils/    spawn · define · probe
    └── adapters/         claude-code · gemini · codex · opencode
```

---

## 어댑터 추가 패턴

`@loom/adapter-utils`의 `defineCliAdapter` factory가 보일러플레이트를 처리합니다. 새 CLI 추가 ~40줄:

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

추가 파일: `manifest.ts` (UI 폼 정의) · `probe.ts` (binary + auth) · `models.ts` (라이브 모델 조회) · `index.test.ts`.

마지막으로 `apps/server/src/adapters/registry.ts`에 4줄 등록:

```ts
[xxxAdapter, { manifest: xxxManifest, probe: xxxProbe, listModels: xxxListModels }],
```

---

## 라이선스

MIT.
