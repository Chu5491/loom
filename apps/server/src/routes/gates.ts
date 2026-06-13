// 휴먼 게이트 API — 대기 목록 + 승인/거부. 게이트는 sqlite 영속 + 부팅 시 복원
// (restoreWorkflowState) — 재시작을 견딘다.

import { Hono } from "hono";
import { listGates, resolveGate } from "../run/workflow.js";

export const gatesRoute = new Hono();

// ?threadId=<id> — 스레드 스코프(Talk). threadId 없으면 전체(전역 게이트 벨) —
// 스케줄 발 워크플로우의 게이트는 threadId 가 없어 이 경로로만 보인다.
gatesRoute.get("/", (c) => {
  const threadId = c.req.query("threadId");
  return c.json({ gates: listGates(threadId) });
});

gatesRoute.post("/:id/approve", async (c) => {
  const r = await resolveGate(c.req.param("id"), true);
  return r.ok ? c.json({ ok: true }) : c.json({ error: r.error }, 404);
});

gatesRoute.post("/:id/reject", async (c) => {
  const r = await resolveGate(c.req.param("id"), false);
  return r.ok ? c.json({ ok: true }) : c.json({ error: r.error }, 404);
});
