// 워크스페이스 전체(=모든 프로젝트 합) 통계. 프로젝트 단위 통계는
// `/api/projects/:id/insights` 에 따로 — main mode 의 lobby 화면에서 한 번에
// 워크스페이스 흐름을 보고 싶을 때 사용.

import { Hono } from "hono";
import { getWorkspaceInsights } from "../db/insights.js";

export const insightsRoute = new Hono();

insightsRoute.get("/", (c) => {
  const raw = Number(c.req.query("windowDays") ?? "30");
  const windowDays =
    Number.isFinite(raw) && raw > 0 ? Math.min(365, Math.max(1, Math.floor(raw))) : 30;
  return c.json(getWorkspaceInsights(windowDays));
});
