// 휴먼 게이트 API — 대기 목록 + 승인/거부. 게이트는 인메모리(v1 — 재시작 시 소실).

import { Hono } from "hono";
import { listGates, resolveGate } from "../run/workflow.js";

export const gatesRoute = new Hono();

// ?threadId=<id> — 스레드 스코프(Talk), 없으면 전체.
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
