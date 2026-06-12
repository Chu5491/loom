// 사용량 집계 — loom 이 기록한 run 들 기준(우리가 쓴 양). CLI 쪽 잔여 쿼터는
// 표준 조회 수단이 없어(각 CLI 가 비공개) 여기선 소비량·비용만 집계한다.

import { Hono } from "hono";
import { getDb, monthCostUsd } from "../db.js";
import { readBudget } from "../office.js";

export const usageRoute = new Hono();

// ?days=30 — 기간 윈도. byAgent / byDay / totals.
usageRoute.get("/", (c) => {
  const days = Math.max(1, Math.min(365, Number(c.req.query("days") ?? 30) || 30));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const db = getDb();

  const byAgent = db
    .prepare<[string], { agent: string; runs: number; cost_usd: number | null }>(
      `SELECT agent, COUNT(*) AS runs, SUM(COALESCE(cost_usd, 0)) AS cost_usd
       FROM runs WHERE started_at >= ? GROUP BY agent ORDER BY cost_usd DESC, runs DESC`,
    )
    .all(since)
    .map((r) => ({ agent: r.agent, runs: r.runs, costUsd: r.cost_usd ?? 0 }));

  const byDay = db
    .prepare<[string], { day: string; runs: number; cost_usd: number | null }>(
      `SELECT substr(started_at, 1, 10) AS day, COUNT(*) AS runs, SUM(COALESCE(cost_usd, 0)) AS cost_usd
       FROM runs WHERE started_at >= ? GROUP BY day ORDER BY day ASC`,
    )
    .all(since)
    .map((r) => ({ day: r.day, runs: r.runs, costUsd: r.cost_usd ?? 0 }));

  const totals = byAgent.reduce(
    (acc, a) => ({ runs: acc.runs + a.runs, costUsd: acc.costUsd + a.costUsd }),
    { runs: 0, costUsd: 0 },
  );

  // 예산 진행 — 이번 달 누적 vs office/budget.json 한도(없으면 null).
  const budget = readBudget();
  const month = { costUsd: monthCostUsd(), budgetUsd: budget.monthlyUsd };

  return c.json({ days, totals, byAgent, byDay, month });
});
