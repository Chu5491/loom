<p align="center">
  <img src="docs/assets/loom-logo.png" alt="loom" width="140">
</p>

<h1 align="center">loom</h1>
<p align="center"><strong>One workspace where your CLI coding agents work side by side.</strong></p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dark-office.png">
    <img alt="loom — pixel office for your CLI agents" src="docs/assets/light-office.png">
  </picture>
</p>

<p align="center">
  <a href="./README.ko.md"><b>한국어</b></a> ·
  <a href="./SLIM-HARNESS-DESIGN.md">Design notes</a> ·
  <a href="./CLAUDE.md">Working rules</a>
</p>

> **Status — alpha.** Local single-user only. Daily-use stable on the claude-code adapter; the others are wired and parsing output, but expect rough edges.

---

## Overview

loom is a local Node.js + React workspace for running multiple CLI coding agents — **Claude Code, Gemini CLI, Codex, OpenCode** — in one project.

You chat with them in threads, watch what files they touch in real time, and review their changes as a stream. The CLIs stay the CLIs — loom is the room they share.

## Why I made it

Each CLI ships its own terminal. Switching between them, copying context in and out, and tracking who did what across threads got tedious fast. loom puts all of them in one workspace, with **explicit prompt boundaries** (no hidden system prompts injected by the harness) and a thin per-CLI dispatcher.

## What it tries to be

- **One project, one workspace.** Threads for tasks, runs for turns.
- **Skills + MCP as a system catalog.** Agents pick what they need into a per-agent loadout.
- **Loadout-pointer prompts.** Skill content lives on disk; the prompt only carries `path/skill.md` indices, so the cache stays warm.
- **Real CLI sessions.** `--resume <id>` per CLI, real cost capture, real tool tracing.
- **No babysitting.** Walk to your real IDE in one click when you want to read code yourself.

## What's working

| Area | Status |
|---|---|
| **Claude Code adapter** | ✅ stream-json, session resume, cost, tool tracing, MCP via `--mcp-config + --strict-mcp-config` |
| **Gemini / Codex / OpenCode** | ✅ prompt + MCP wired (filter / per-key / XDG override per CLI) |
| **Threads · Runs · SSE logs** | ✅ full lifecycle, per-thread git worktree, `run_changes` persistence |
| **Workspace catalog** | ✅ Skills, MCP servers, project env vars, **global rule** prepended to every prompt |
| **Office / Chat dock / Files** | ✅ pixel office, ⌘J chat dock, live file presence, ⌘P palette |
| **Git management** | ✅ status / stage / commit / branch / log + **fetch / pull / push** as a SourceTree-style page |
| **@ / mentions in chat** | ✅ `@<file>` (project files) · `/<skill\|mcp>` (agent's loadout) |
| **Open in IDE** | ✅ VS Code · Cursor · Antigravity · Zed · IntelliJ |
| **Light / dark theme** | ✅ full coverage incl. pixel sprites |

🚧 Not yet: PR creation, log full-text search, multi-user, hardened deploy.

## Quick start

Requirements: **Node ≥ 22**, **pnpm**.

```bash
pnpm install
pnpm dev
# web → http://localhost:3201
```

Make sure the CLI you want to drive (`claude`, `gemini`, `codex`, `opencode`) is on your `PATH`. Then in the UI:

1. Create a project (point it at a local repo path).
2. Add an agent — pick the CLI, model, and any skills/MCPs from the catalog.
3. Open a thread and start chatting.

## Project layout

```
apps/server                      # Hono backend — DB, run lifecycle, SSE, git
apps/web                         # React + Vite UI
packages/core                    # shared types
packages/adapters/{claude-code,gemini,codex,opencode}
packages/adapter-utils           # spawnProcess + defineCliAdapter
```

Design background: [`SLIM-HARNESS-DESIGN.md`](./SLIM-HARNESS-DESIGN.md).
Coding rules / adapter conventions: [`CLAUDE.md`](./CLAUDE.md).

## License

MIT
