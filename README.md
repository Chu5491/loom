<p align="center">
  <img src="docs/assets/loom-logo.png" alt="loom" width="140">
</p>

<h1 align="center">loom</h1>
<p align="center"><strong>Your CLI coding agents, one office.</strong></p>

<p align="center">
  <a href="./README.ko.md"><b>한국어</b></a> ·
  <a href="./docs/V2-PLAN.md">Design notes</a> ·
  <a href="./CLAUDE.md">Working rules</a>
</p>

> **Status — alpha, local single-user.** Five adapters wired and verified: claude-code, codex, opencode, devin, antigravity.

---

## Overview

loom is a local Node.js + React workspace for running multiple CLI coding agents — **Claude Code, Codex, OpenCode, Devin, Antigravity** — as one team.

You define the team once (agents, rules, skills, MCP servers, hand-off rules) as plain files in `office/`, commit them to git, and talk to the team in a chat. Each turn spawns the real CLI in your project directory; output streams back as structured events. The CLIs stay the CLIs — loom is the office they share.

## Constitution

1. **CLIs stay untouched** — wrap, never mutate.
2. **Automatic injection is a sin** — your prompt + the specs you explicitly attach are the only input.
3. **CLI roots are sacred** — `~/.claude`, `~/.gemini` etc. are never written. Injection happens per-run via loadouts/flags.
4. **Definitions in git, records local** — `office/` is committed; `data/` (sqlite, logs, loadouts) is gitignored.
5. **Raw is truth** — original CLI output is always kept on disk; parsed events are a view.

## What's in the box

| Surface | What it does |
|---|---|
| **Talk** | Chat with any agent. `@` mentions agents (routing), skills (attach to this run), and project files (live search). Markdown-rendered replies, live tool/file traces, stop button, cost rollup, hand-off suggestions. |
| **Office** | Define the team as files: rules (always-on context), skills (single `.md` or folder with bundled references), MCP servers (form editor), agents (CLI + model + what they carry), harness edges (who hands off to whom, when). |
| **Connections** | Discover · authenticate · pick models · smoke-test every CLI on the machine. The header shows authenticated CLIs at all times. |
| **Harness** | `on_success / on_fail / on_changes` edges auto-fire the next agent (loop-guarded); `ask / manual` edges become one-click suggestions. Results carry over in explicitly marked blocks. |
| **Projects** | Register local working directories; runs execute there. The office is global ("the team"), projects are where it works. |

## Quick start

Prerequisites: **Node ≥ 20**, **pnpm**, and the CLI(s) you want on `PATH` (`claude`, `codex`, `opencode`, `devin`, `agy`).

```bash
pnpm install
pnpm dev
# web → http://localhost:3201
```

1. **Connections** — check your CLIs are detected and authenticated.
2. **Office** — create an agent (CLI + model are required), optionally rules/skills/MCP.
3. Pick a **project** in the header (a local directory) and start talking.

## Project layout

```
office/                git-committed definitions (rules / skills / mcp / agents / harness)
data/                  gitignored records (sqlite history, raw logs, per-run loadouts)
apps/server/           Hono — office loader, run engine, SSE, harness
apps/web/              React + Vite + Tailwind 4 — Talk / Office / Connections
packages/core/         shared types (zero runtime deps)
packages/adapter-utils/ spawnProcess + defineCliAdapter
packages/adapters/     claude-code · antigravity · codex · opencode · devin
```

## Configuration

| Variable | Purpose |
|---|---|
| `LOOM_PORT` | Server port. Default `3200`. |
| `LOOM_HOST` | Bind address. Default `127.0.0.1`. |
| `LOOM_HOME` | Office root (where `office/` and `data/` live). Default: repo root. |

MCP secrets are written as `"${ENV_NAME}"` references in `office/mcp/servers.json` and resolved from the server's environment at spawn time — never stored as literals.

## Contributing

Read [CLAUDE.md](./CLAUDE.md) first — naming rules, abstraction limits, adapter patterns, and the constitution above.

```bash
pnpm typecheck   # must be green
pnpm test        # must be green
```

## License

MIT — see [`LICENSE`](./LICENSE).
