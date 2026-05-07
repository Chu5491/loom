// 프로젝트 단위 관측·비용 통계. 이미 캡처돼 있는 runs / run_changes / agents 만
// JOIN 해서 집계 — 별도 라이팅 없음. UI 가 한 번 부르면 끝나는 단일 응답.
//
// 모든 시간 필터는 `created_at >= now - <windowDays> days` 기준. 정확히 sliding
// window — 캘린더 day 기준이 아니라 호출 시점 기준 24h * N.

import { getDb } from "./client.js";

export interface InsightsSummary {
  /** 윈도우 안의 모든 run 개수. */
  totalRuns: number;
  /** 윈도우 안의 cost_usd 합. cost 가 NULL 인 run 은 합산에서 제외. */
  totalCostUsd: number;
  /** 윈도우 안에서 succeeded 비율 (0~1). 분모는 종료된 run 만 — 진행 중 제외. */
  successRate: number;
  /** 지금 진행 중(queued + running) 인 run 개수. 윈도우 무관. */
  activeRuns: number;
  /** 윈도우 안에서 한 번이라도 실행된 agent 의 수. */
  activeAgents: number;
}

export interface InsightsDaily {
  /** ISO 날짜 (YYYY-MM-DD). 윈도우의 모든 일자가 포함됨 (run 0 인 날도). */
  day: string;
  runs: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  costUsd: number;
}

export interface InsightsAgent {
  agentId: string;
  agentName: string;
  adapterKind: string;
  runs: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  costUsd: number;
  /** started_at ~ ended_at 평균(초). 둘 다 채워진 run 만 집계. */
  avgDurationSecs: number | null;
}

export interface InsightsFile {
  path: string;
  /** 윈도우 안에서 이 path 를 건드린 run_changes row 개수. */
  touches: number;
  additions: number;
  deletions: number;
  /** 마지막으로 건드린 run 의 created_at. */
  lastTouchedAt: string;
}

export interface ProjectInsights {
  windowDays: number;
  summary: InsightsSummary;
  daily: InsightsDaily[];
  agents: InsightsAgent[];
  files: InsightsFile[];
}

/** 워크스페이스 전체(=모든 프로젝트 합) 통계. files 섹션은 cross-project 라
 *  noisy 해서 빼고, 대신 프로젝트별 집계를 얹음. */
export interface WorkspaceInsights {
  windowDays: number;
  summary: InsightsSummary & { activeProjects: number };
  daily: InsightsDaily[];
  projects: InsightsProject[];
  agents: InsightsWorkspaceAgent[];
}

export interface InsightsProject {
  projectId: string;
  projectName: string;
  runs: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  costUsd: number;
  /** 윈도우 안의 마지막 run 시각. 한 번도 없으면 null. */
  lastRunAt: string | null;
}

/** 프로젝트 정보까지 같이 — 같은 이름 agent 가 여러 프로젝트에 있으면 분리되게. */
export interface InsightsWorkspaceAgent extends InsightsAgent {
  projectId: string;
  projectName: string;
}

/** sliding window 의 ISO datetime cutoff. SQLite `datetime('now', '-N days')`
 *  와 동일 의미지만 JS 에서 계산해서 한 query 에 박는 게 plan 안정. */
function cutoffIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

export function getProjectInsights(
  projectId: string,
  windowDays: number,
): ProjectInsights {
  const db = getDb();
  const cutoff = cutoffIso(windowDays);

  // 1) Summary — 한 row 로 끝.
  const summaryRow = db
    .prepare<
      [string, string],
      {
        total_runs: number;
        total_cost: number | null;
        finished: number;
        succeeded: number;
        active_agents: number;
      }
    >(
      `SELECT
         COUNT(*) AS total_runs,
         SUM(r.cost_usd) AS total_cost,
         SUM(CASE WHEN r.status IN ('succeeded','failed','cancelled') THEN 1 ELSE 0 END) AS finished,
         SUM(CASE WHEN r.status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
         COUNT(DISTINCT r.agent_id) AS active_agents
       FROM runs r
       JOIN agents a ON r.agent_id = a.id
       WHERE a.project_id = ? AND r.created_at >= ?`,
    )
    .get(projectId, cutoff);

  const activeRunsRow = db
    .prepare<[string], { n: number }>(
      `SELECT COUNT(*) AS n
       FROM runs r
       JOIN agents a ON r.agent_id = a.id
       WHERE a.project_id = ? AND r.status IN ('queued', 'running')`,
    )
    .get(projectId);

  const finished = summaryRow?.finished ?? 0;
  const succeeded = summaryRow?.succeeded ?? 0;
  const summary: InsightsSummary = {
    totalRuns: summaryRow?.total_runs ?? 0,
    totalCostUsd: summaryRow?.total_cost ?? 0,
    successRate: finished > 0 ? succeeded / finished : 0,
    activeRuns: activeRunsRow?.n ?? 0,
    activeAgents: summaryRow?.active_agents ?? 0,
  };

  // 2) Daily — 일자별 집계. SQLite 의 date() 가 UTC 기준이라 동일.
  const dailyRows = db
    .prepare<
      [string, string],
      {
        day: string;
        runs: number;
        succeeded: number;
        failed: number;
        cancelled: number;
        cost: number | null;
      }
    >(
      `SELECT
         date(r.created_at) AS day,
         COUNT(*) AS runs,
         SUM(CASE WHEN r.status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
         SUM(CASE WHEN r.status = 'failed'    THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN r.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
         SUM(r.cost_usd) AS cost
       FROM runs r
       JOIN agents a ON r.agent_id = a.id
       WHERE a.project_id = ? AND r.created_at >= ?
       GROUP BY day
       ORDER BY day ASC`,
    )
    .all(projectId, cutoff);

  // 윈도우의 *모든* 날짜를 0 으로 채워 넣음 — 차트가 빈 날을 건너뛰지 않게.
  const daily = fillDailyGaps(dailyRows, windowDays);

  // 3) Per-agent stats — agent 별 한 row.
  const agentRows = db
    .prepare<
      [string, string],
      {
        agent_id: string;
        agent_name: string;
        adapter_kind: string;
        runs: number;
        succeeded: number;
        failed: number;
        cancelled: number;
        cost: number | null;
        avg_duration_secs: number | null;
      }
    >(
      `SELECT
         a.id AS agent_id,
         a.name AS agent_name,
         a.adapter_kind,
         COUNT(r.id) AS runs,
         SUM(CASE WHEN r.status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
         SUM(CASE WHEN r.status = 'failed'    THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN r.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
         SUM(r.cost_usd) AS cost,
         AVG(
           CASE WHEN r.started_at IS NOT NULL AND r.ended_at IS NOT NULL
                THEN (julianday(r.ended_at) - julianday(r.started_at)) * 86400
                ELSE NULL END
         ) AS avg_duration_secs
       FROM agents a
       LEFT JOIN runs r
         ON r.agent_id = a.id AND r.created_at >= ?
       WHERE a.project_id = ?
       GROUP BY a.id
       HAVING runs > 0
       ORDER BY runs DESC, cost DESC`,
    )
    .all(cutoff, projectId);

  const agents: InsightsAgent[] = agentRows.map((r) => ({
    agentId: r.agent_id,
    agentName: r.agent_name,
    adapterKind: r.adapter_kind,
    runs: r.runs,
    succeeded: r.succeeded,
    failed: r.failed,
    cancelled: r.cancelled,
    costUsd: r.cost ?? 0,
    avgDurationSecs: r.avg_duration_secs,
  }));

  // 4) File activity — 윈도우 안에 가장 자주 만진 path top 20.
  const fileRows = db
    .prepare<
      [string, string],
      {
        path: string;
        touches: number;
        additions: number;
        deletions: number;
        last_touched: string;
      }
    >(
      `SELECT
         rc.path AS path,
         COUNT(*) AS touches,
         SUM(rc.additions) AS additions,
         SUM(rc.deletions) AS deletions,
         MAX(r.created_at) AS last_touched
       FROM run_changes rc
       JOIN runs r ON rc.run_id = r.id
       JOIN agents a ON r.agent_id = a.id
       WHERE a.project_id = ? AND r.created_at >= ?
       GROUP BY rc.path
       ORDER BY touches DESC, last_touched DESC
       LIMIT 20`,
    )
    .all(projectId, cutoff);

  const files: InsightsFile[] = fileRows.map((r) => ({
    path: r.path,
    touches: r.touches,
    additions: r.additions,
    deletions: r.deletions,
    lastTouchedAt: r.last_touched,
  }));

  return { windowDays, summary, daily, agents, files };
}

export function getWorkspaceInsights(windowDays: number): WorkspaceInsights {
  const db = getDb();
  const cutoff = cutoffIso(windowDays);

  // 1) Summary — 모든 프로젝트 합. project JOIN 도 안 필요.
  const summaryRow = db
    .prepare<
      [string],
      {
        total_runs: number;
        total_cost: number | null;
        finished: number;
        succeeded: number;
        active_agents: number;
        active_projects: number;
      }
    >(
      `SELECT
         COUNT(*) AS total_runs,
         SUM(r.cost_usd) AS total_cost,
         SUM(CASE WHEN r.status IN ('succeeded','failed','cancelled') THEN 1 ELSE 0 END) AS finished,
         SUM(CASE WHEN r.status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
         COUNT(DISTINCT r.agent_id) AS active_agents,
         COUNT(DISTINCT a.project_id) AS active_projects
       FROM runs r
       JOIN agents a ON r.agent_id = a.id
       WHERE r.created_at >= ?`,
    )
    .get(cutoff);

  const activeRunsRow = db
    .prepare<[], { n: number }>(
      `SELECT COUNT(*) AS n FROM runs WHERE status IN ('queued', 'running')`,
    )
    .get();

  const finished = summaryRow?.finished ?? 0;
  const succeeded = summaryRow?.succeeded ?? 0;
  const summary = {
    totalRuns: summaryRow?.total_runs ?? 0,
    totalCostUsd: summaryRow?.total_cost ?? 0,
    successRate: finished > 0 ? succeeded / finished : 0,
    activeRuns: activeRunsRow?.n ?? 0,
    activeAgents: summaryRow?.active_agents ?? 0,
    activeProjects: summaryRow?.active_projects ?? 0,
  };

  // 2) Daily — 워크스페이스 전체 합산.
  const dailyRows = db
    .prepare<
      [string],
      {
        day: string;
        runs: number;
        succeeded: number;
        failed: number;
        cancelled: number;
        cost: number | null;
      }
    >(
      `SELECT
         date(r.created_at) AS day,
         COUNT(*) AS runs,
         SUM(CASE WHEN r.status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
         SUM(CASE WHEN r.status = 'failed'    THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN r.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
         SUM(r.cost_usd) AS cost
       FROM runs r
       WHERE r.created_at >= ?
       GROUP BY day
       ORDER BY day ASC`,
    )
    .all(cutoff);

  const daily = fillDailyGaps(dailyRows, windowDays);

  // 3) Per-project breakdown.
  const projectRows = db
    .prepare<
      [string],
      {
        project_id: string;
        project_name: string;
        runs: number;
        succeeded: number;
        failed: number;
        cancelled: number;
        cost: number | null;
        last_run_at: string | null;
      }
    >(
      `SELECT
         p.id AS project_id,
         p.name AS project_name,
         COUNT(r.id) AS runs,
         SUM(CASE WHEN r.status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
         SUM(CASE WHEN r.status = 'failed'    THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN r.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
         SUM(r.cost_usd) AS cost,
         MAX(r.created_at) AS last_run_at
       FROM projects p
       LEFT JOIN agents a ON a.project_id = p.id
       LEFT JOIN runs r   ON r.agent_id = a.id AND r.created_at >= ?
       GROUP BY p.id
       HAVING runs > 0
       ORDER BY runs DESC, cost DESC`,
    )
    .all(cutoff);

  const projects: InsightsProject[] = projectRows.map((r) => ({
    projectId: r.project_id,
    projectName: r.project_name,
    runs: r.runs,
    succeeded: r.succeeded,
    failed: r.failed,
    cancelled: r.cancelled,
    costUsd: r.cost ?? 0,
    lastRunAt: r.last_run_at,
  }));

  // 4) Top agents (cross-project) — 같은 이름 agent 가 여러 프로젝트에 있을 수
  // 있으니 project 정보까지 붙임.
  const agentRows = db
    .prepare<
      [string],
      {
        agent_id: string;
        agent_name: string;
        adapter_kind: string;
        project_id: string;
        project_name: string;
        runs: number;
        succeeded: number;
        failed: number;
        cancelled: number;
        cost: number | null;
        avg_duration_secs: number | null;
      }
    >(
      `SELECT
         a.id AS agent_id,
         a.name AS agent_name,
         a.adapter_kind,
         p.id  AS project_id,
         p.name AS project_name,
         COUNT(r.id) AS runs,
         SUM(CASE WHEN r.status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
         SUM(CASE WHEN r.status = 'failed'    THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN r.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
         SUM(r.cost_usd) AS cost,
         AVG(
           CASE WHEN r.started_at IS NOT NULL AND r.ended_at IS NOT NULL
                THEN (julianday(r.ended_at) - julianday(r.started_at)) * 86400
                ELSE NULL END
         ) AS avg_duration_secs
       FROM agents a
       JOIN projects p ON a.project_id = p.id
       LEFT JOIN runs r ON r.agent_id = a.id AND r.created_at >= ?
       GROUP BY a.id
       HAVING runs > 0
       ORDER BY runs DESC, cost DESC
       LIMIT 20`,
    )
    .all(cutoff);

  const agents: InsightsWorkspaceAgent[] = agentRows.map((r) => ({
    agentId: r.agent_id,
    agentName: r.agent_name,
    adapterKind: r.adapter_kind,
    projectId: r.project_id,
    projectName: r.project_name,
    runs: r.runs,
    succeeded: r.succeeded,
    failed: r.failed,
    cancelled: r.cancelled,
    costUsd: r.cost ?? 0,
    avgDurationSecs: r.avg_duration_secs,
  }));

  return { windowDays, summary, daily, projects, agents };
}

/** SQL group-by 는 빈 날짜를 빼는데 차트는 연속이 보기 좋음 — 0 으로 메움. */
function fillDailyGaps(
  rows: ReadonlyArray<{
    day: string;
    runs: number;
    succeeded: number;
    failed: number;
    cancelled: number;
    cost: number | null;
  }>,
  windowDays: number,
): InsightsDaily[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: InsightsDaily[] = [];
  const today = new Date();
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    const day = d.toISOString().slice(0, 10);
    const r = byDay.get(day);
    out.push({
      day,
      runs: r?.runs ?? 0,
      succeeded: r?.succeeded ?? 0,
      failed: r?.failed ?? 0,
      cancelled: r?.cancelled ?? 0,
      costUsd: r?.cost ?? 0,
    });
  }
  return out;
}
