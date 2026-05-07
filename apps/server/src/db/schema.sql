CREATE TABLE IF NOT EXISTS projects (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  path              TEXT NOT NULL,
  description       TEXT,
  -- 외부 IDE — vscode | cursor | antigravity | zed | intellij. NULL이면
  -- 클라이언트의 기본값(vscode) 사용. "Open in IDE" 버튼이 spawn할 CLI 결정.
  preferred_editor  TEXT,
  -- git 으로 clone 해서 만든 프로젝트의 origin URL. NULL = 사용자가 로컬 path
  -- 로 직접 추가한 프로젝트. UI 가 "View on GitHub" 같은 링크 띄우는 용도.
  clone_url         TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  prompt          TEXT NOT NULL DEFAULT '',
  role            TEXT,
  adapter_kind    TEXT NOT NULL,
  adapter_config  TEXT NOT NULL DEFAULT '{}',
  default_cwd     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- Many-to-many: which skills (specs) are assigned to which agents.
-- The agent will see its assigned skills in every run, before the user prompt.
CREATE TABLE IF NOT EXISTS agent_skills (
  agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  skill_id    TEXT NOT NULL REFERENCES specs(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (agent_id, skill_id)
);

-- System-level MCP server catalog. Configured once, picked from a multi-select
-- when creating an agent. Each row is a single MCP server config (name, kind,
-- and the runtime args). When an agent runs, the server merges only this
-- agent's enabled servers into the .mcp.json that the CLI sees.
CREATE TABLE IF NOT EXISTS mcp_servers (
  id          TEXT PRIMARY KEY,
  -- Unique key — also the key used inside .mcp.json's "mcpServers" map.
  -- Constrained at the row level so the same name can't be added twice.
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  -- "stdio" | "http" | "sse". stdio uses (command, args, env); the
  -- network kinds use (url, headers).
  kind        TEXT NOT NULL DEFAULT 'stdio',
  command     TEXT,                              -- stdio only
  args        TEXT NOT NULL DEFAULT '[]',        -- json array
  env         TEXT NOT NULL DEFAULT '{}',        -- json object
  url         TEXT,                              -- http/sse only
  headers     TEXT NOT NULL DEFAULT '{}',        -- json object
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Many-to-many: which MCP servers does this agent have permission to call.
-- Mirrors agent_skills exactly. Inserts/deletes happen in a transaction
-- when an agent is updated.
CREATE TABLE IF NOT EXISTS agent_mcp_servers (
  agent_id      TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  mcp_server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (agent_id, mcp_server_id)
);

-- One-row settings table for the Gemini settings.json sync feature.
-- gemini doesn't accept a runtime --mcp-config flag and isn't XDG-aware,
-- so loom optionally mirrors its catalog into ~/.gemini/settings.json's
-- mcpServers field. This row tracks whether that mirroring is enabled
-- + the latest sync result. CHECK (id=1) keeps it singleton.
CREATE TABLE IF NOT EXISTS gemini_sync (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  enabled         INTEGER NOT NULL DEFAULT 1,
  last_synced_at  TEXT,
  last_error      TEXT
);
INSERT OR IGNORE INTO gemini_sync (id, enabled) VALUES (1, 1);

-- Workspace-wide single-row settings. Adds global_rule for now; future settings
-- (default model, default autonomy) just add columns here. CHECK (id=1) singleton.
CREATE TABLE IF NOT EXISTS loom_settings (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  global_rule       TEXT NOT NULL DEFAULT '',
  smithery_api_key  TEXT,
  skills_sh_api_key TEXT,
  updated_at        TEXT NOT NULL
);
INSERT OR IGNORE INTO loom_settings (id, global_rule, updated_at)
  VALUES (1, '', datetime('now'));

-- The agents.project_id index is created in applyMigrations() after the
-- ALTER-add-column step so fresh-install and upgrade paths share one source.

CREATE TABLE IF NOT EXISTS specs (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  content     TEXT NOT NULL,
  agent_id    TEXT REFERENCES agents(id) ON DELETE SET NULL,
  tags        TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Conversation threads. Promoted from "implicit chains via parent_run_id"
-- (which still works as a sub-grouping inside a thread for hand-off
-- visualization) to a first-class container with a name, a status, and
-- a curated context bundle that the user can opt into attaching.
CREATE TABLE IF NOT EXISTS threads (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',  -- active | done | archived
  context_bundle  TEXT NOT NULL DEFAULT '',
  -- Optional isolated git worktree for this thread. When set, runs
  -- belonging to the thread cd into this path instead of the
  -- project's main path. NULL means "share the project's path with
  -- every other thread" (the default).
  worktree_path   TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_threads_project ON threads(project_id);
CREATE INDEX IF NOT EXISTS idx_threads_status  ON threads(status);

CREATE TABLE IF NOT EXISTS runs (
  id                  TEXT PRIMARY KEY,
  agent_id            TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  thread_id           TEXT REFERENCES threads(id) ON DELETE SET NULL,
  parent_run_id       TEXT REFERENCES runs(id) ON DELETE SET NULL,
  prompt              TEXT NOT NULL,
  attached_spec_ids   TEXT NOT NULL DEFAULT '[]',
  cwd                 TEXT NOT NULL,
  status              TEXT NOT NULL,
  exit_code           INTEGER,
  pid                 INTEGER,
  log_path            TEXT,
  -- Working-tree snapshots (dangling commit SHAs) used to compute the
  -- file-level diff for "what did this run change?". NULL when the cwd
  -- is not a git repo or snapshot failed.
  before_ref          TEXT,
  after_ref           TEXT,
  -- Cost in USD as reported by the CLI (e.g. claude-code's `result`
  -- event total_cost_usd). NULL when the adapter doesn't surface cost
  -- — we don't fabricate estimates from token counts.
  cost_usd            REAL,
  -- CLI session id captured during this run (claude-code's session_id,
  -- opencode's --session, …). The next run in the same thread/agent
  -- pulls the most recent non-null one and feeds it back as a resume
  -- token, so the CLI keeps its conversation memory across turns.
  session_id          TEXT,
  -- Session id this run *attempted* to resume from. When the run fails
  -- (e.g. the CLI says "no conversation found"), the session-lookup
  -- code marks that id as poisoned and never resumes it again.
  resumed_session_id  TEXT,
  started_at          TEXT,
  ended_at            TEXT,
  created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_agent  ON runs(agent_id);
CREATE INDEX IF NOT EXISTS idx_runs_parent ON runs(parent_run_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_specs_agent ON specs(agent_id);
-- idx_runs_thread is created in applyMigrations() after the
-- ALTER-add-column step so fresh installs and existing-DB upgrades go
-- through one path. Same convention as idx_agents_project above.

-- Per-run, per-file changes derived from before/after work-tree snapshots
-- and persisted at run-finish time. Persisting (rather than always
-- recomputing from refs) means file-history queries don't need git
-- access and survive git gc collecting the dangling snapshot commits.
CREATE TABLE IF NOT EXISTS run_changes (
  run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  path        TEXT NOT NULL,
  from_path   TEXT,                       -- non-null only for renames
  status      TEXT NOT NULL,              -- added | modified | deleted | renamed
  additions   INTEGER NOT NULL DEFAULT 0,
  deletions   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, path)
);
CREATE INDEX IF NOT EXISTS idx_run_changes_path ON run_changes(path);

-- 프로젝트 단위 환경변수. 같은 프로젝트의 모든 에이전트 run에 공통 주입.
-- 우선순위: agent.adapterConfig.env > project_env > 시스템 env. UI에서
-- 마스터-가편집 표 형태로 관리. API 키 같은 공유 secret 보관용.
CREATE TABLE IF NOT EXISTS project_env (
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  PRIMARY KEY (project_id, key)
);
