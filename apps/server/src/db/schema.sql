CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  path        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
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

CREATE TABLE IF NOT EXISTS runs (
  id                  TEXT PRIMARY KEY,
  agent_id            TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  parent_run_id       TEXT REFERENCES runs(id) ON DELETE SET NULL,
  prompt              TEXT NOT NULL,
  attached_spec_ids   TEXT NOT NULL DEFAULT '[]',
  cwd                 TEXT NOT NULL,
  status              TEXT NOT NULL,
  exit_code           INTEGER,
  pid                 INTEGER,
  log_path            TEXT,
  started_at          TEXT,
  ended_at            TEXT,
  created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_agent ON runs(agent_id);
CREATE INDEX IF NOT EXISTS idx_runs_parent ON runs(parent_run_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_specs_agent ON specs(agent_id);
