<p align="center">
  <img src="docs/assets/loom-logo.png" alt="loom" width="140">
</p>

<h1 align="center">loom</h1>
<p align="center"><strong>One workspace where your CLI coding agents work side by side.</strong></p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dark-office.png">
    <img alt="loom — multi-agent workspace" src="docs/assets/light-office.png">
  </picture>
</p>

<p align="center">
  <a href="./README.ko.md"><b>한국어</b></a> ·
  <a href="./SLIM-HARNESS-DESIGN.md">Design notes</a> ·
  <a href="./CLAUDE.md">Working rules</a>
</p>

> **Status — alpha.** Local single-user. Stable on the claude-code adapter; gemini / codex / opencode are wired and parsing output, but expect rough edges.

---

## Overview

loom is a local Node.js + React workspace for running multiple CLI coding agents — **Claude Code, Gemini CLI, Codex, OpenCode** — in one project.

You chat with them in threads, watch what files they touch in real time, review side-by-side diffs of every run, and stage/commit changes without leaving the app. The CLIs stay the CLIs — loom is the room they share.

## Why it exists

Each CLI ships its own terminal. Switching between them, copying context in and out, and tracking who did what across threads got tedious fast. loom puts all of them in one workspace, with **explicit prompt boundaries** (no hidden system prompts injected by the harness) and a thin per-CLI dispatcher.

## What's in the box

| Surface | What it does |
|---|---|
| **Live view** | Every agent's current state at a glance — file being edited, tool in use, thread membership, line counts. Inline activity stream merges all agents' tool calls + sub-agent delegations chronologically. |
| **Editor** | Monaco-backed file viewer with **side-by-side diff** for any prior run that touched the file. ⌘P fuzzy palette, multi-tab with active/inactive width balance. |
| **Git** | Full commit graph + branches/remotes + working tree staging + fetch / pull / push, all in one page. Sidebar holds branch/stash navigation; main holds the actual commit work. |
| **History** | Every past run with status, cost, file changes, jump-to-message. |
| **Insights** | Cost / time / file activity, per agent and per project. |
| **Skills + MCP** | Per-agent loadout — pick from a built-in catalog plus skills.sh and the official MCP registry (Smithery, etc). API keys stored in DB via UI, env-var fallback. |
| **Threads** | Each thread can isolate to its own git worktree. Session resume threads CLI conversations across runs (`--resume <id>` per CLI). |
| **Agent management** | Create / edit / delete agents inline from the live canvas — no page navigation. |

🚧 Not yet: PR creation, log full-text search, multi-user, hardened deploy, sub-agent task spawning (Phase 2 — schema + UI surfaces are in place, adapter detection pending).

## Quick start

Prerequisites:
- **Node ≥ 22**
- **pnpm**
- The CLI(s) you want to drive available on `PATH`: `claude`, `gemini`, `codex`, `opencode`

```bash
pnpm install
pnpm dev
# web → http://localhost:3201
```

In the UI:

1. Create a project (point at a local repo path or paste a git URL — loom will clone).
2. Add an agent (pick CLI + model; optional skills/MCPs from the catalog).
3. Open a thread, start chatting. `@<file>` mentions project files; `/<skill|mcp>` adds from the agent's loadout.

## Architecture in one paragraph

A single SQLite file (`./data/loom.db`) holds projects, agents, threads, runs, run_changes, delegations, settings, and the catalogs. The server (`apps/server`) is a Hono process that owns this DB plus an in-memory log store; CLI runs are spawned via `child_process.spawn` per adapter and stream output as SSE. The UI (`apps/web`) is a React + Vite SPA that polls the REST routes and subscribes to per-run SSE for live logs. Git activity is captured via lightweight before/after `git commit-tree` snapshots that don't disturb the working index, stash list, or untracked files.

## Project layout

```
apps/
  server/                       Hono backend — DB, run lifecycle, SSE, git
  web/                          React + Vite UI
packages/
  core/                         shared types
  adapter-utils/                spawnProcess + defineCliAdapter
  adapters/
    claude-code/
    gemini/
    codex/
    opencode/
docs/                           design notes + assets
.claude/launch.json             dev server config (preview tooling)
```

## Configuration

Server reads these from env (all optional):

| Variable | Purpose |
|---|---|
| `LOOM_PORT` | Server port. Default `3201`. |
| `LOOM_DATA_DIR` | DB + logs location. Default `./data`. |
| `LOOM_LOG_LEVEL` | `debug` / `info` / `warn` / `error`. Default `info`. |
| `LOOM_SMITHERY_API_KEY` | Optional. Enables Smithery MCP marketplace. UI-stored key takes precedence. |
| `LOOM_SKILLS_SH_API_KEY` | Optional. Enables skills.sh skill marketplace. UI-stored key takes precedence. |

Per-project env vars (passed into every CLI run for that project) live in the **Project → ENV** UI section, not in shell env.

## Scripts

| Command | Action |
|---|---|
| `pnpm dev` | Server + Vite together |
| `pnpm dev:server` | Server only |
| `pnpm dev:web` | UI only |
| `pnpm build` | Build all workspaces |
| `pnpm typecheck` | `tsc --noEmit` across workspaces |
| `pnpm test` | Run package-local tests |

## Deployment

loom is currently designed for local single-user use. For shared deployment, you'll at minimum need:

- A persistent volume mounted at `LOOM_DATA_DIR` (SQLite + logs + worktrees).
- The CLI binaries available in the runtime image.
- Authentication / authorization in front of the HTTP server (loom has no built-in auth).

A turnkey enterprise deploy is on the roadmap but not shipped — treat any current deployment as a **personal workspace exposed to a trusted network**.

## Contributing

Read [CLAUDE.md](./CLAUDE.md) before sending a non-trivial PR. It covers naming conventions, abstraction limits, adapter patterns, when to skip tests, and the prompt-injection rules ("automatic injection is a sin").

```bash
pnpm install
pnpm typecheck   # must be green
pnpm test        # must be green for packages with tests
```

Adapter additions follow the recipe in CLAUDE.md §4 — three files (`index.ts`, `index.test.ts`, `package.json`) of ~30–50 lines each, and registry registration in `apps/server/src/adapters/registry.ts`.

## Design background

- [`SLIM-HARNESS-DESIGN.md`](./SLIM-HARNESS-DESIGN.md) — the original "thin dispatcher" thinking.
- [`CLAUDE.md`](./CLAUDE.md) — current working rules, including the four-adapter abstraction.

## License

MIT — see [`LICENSE`](./LICENSE).
