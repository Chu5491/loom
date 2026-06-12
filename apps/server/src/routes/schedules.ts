// 스케줄 API — CRUD + 즉시 실행. 변경 시마다 스케줄러 재등록.

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import type { Schedule } from "@loom/core";
import { deleteScheduleDb, getProjectDb, getScheduleDb, insertSchedule, listSchedulesDb, updateScheduleDb } from "../db.js";
import { readAgents, readWorkflows } from "../office.js";
import { startRun } from "../run/engine.js";
import { nextRunAt, reschedule, validateCron } from "../run/scheduler.js";
import { startWorkflow } from "../run/workflow.js";
import { isResponse, parseBody } from "./helpers.js";

export const schedulesRoute = new Hono();

const withNext = (s: Schedule): Schedule => ({ ...s, nextRunAt: s.enabled ? nextRunAt(s.cron) : null });

// ?projectId=<id|none> — 프로젝트 스코프, 없으면 전체.
schedulesRoute.get("/", (c) => {
  const q = c.req.query("projectId");
  const list = q === undefined ? listSchedulesDb() : listSchedulesDb(q === "none" ? null : q);
  return c.json({ schedules: list.map(withNext) });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  // workflow 지정 시 agent 는 무시(그래프가 정함) — 빈 문자열 허용.
  agent: z.string().default(""),
  prompt: z.string().trim().min(1).max(20_000),
  cron: z.string().trim().min(1),
  workflow: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  enabled: z.boolean().default(true),
});

function validateTarget(data: { agent: string; workflow: string | null }): string | null {
  if (data.workflow) {
    return readWorkflows().some((w) => w.name === data.workflow) ? null : "workflow_not_found";
  }
  if (!data.agent) return "agent_or_workflow_required";
  return readAgents().some((a) => a.name === data.agent) ? null : "agent_not_found";
}

schedulesRoute.post("/", async (c) => {
  const data = await parseBody(c, createSchema);
  if (isResponse(data)) return data;
  const targetErr = validateTarget(data);
  if (targetErr) return c.json({ error: targetErr }, 400);
  if (data.projectId && !getProjectDb(data.projectId)) return c.json({ error: "project_not_found" }, 400);
  const cronErr = validateCron(data.cron);
  if (cronErr) return c.json({ error: `invalid_cron: ${cronErr}` }, 400);
  const s: Schedule = { id: randomUUID(), ...data, lastRunAt: null, createdAt: new Date().toISOString() };
  insertSchedule(s);
  reschedule();
  return c.json({ schedule: withNext(s) }, 201);
});

const patchSchema = createSchema.partial();
schedulesRoute.patch("/:id", async (c) => {
  const cur = getScheduleDb(c.req.param("id"));
  if (!cur) return c.json({ error: "not_found" }, 404);
  const data = await parseBody(c, patchSchema);
  if (isResponse(data)) return data;
  const next: Schedule = { ...cur, ...data };
  const targetErr = validateTarget({ agent: next.agent, workflow: next.workflow ?? null });
  if (targetErr) return c.json({ error: targetErr }, 400);
  if (data.cron) {
    const cronErr = validateCron(data.cron);
    if (cronErr) return c.json({ error: `invalid_cron: ${cronErr}` }, 400);
  }
  updateScheduleDb(next);
  reschedule();
  return c.json({ schedule: withNext(next) });
});

schedulesRoute.delete("/:id", (c) => {
  const ok = deleteScheduleDb(c.req.param("id"));
  if (ok) reschedule();
  return ok ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

// 지금 실행 — cron 을 기다리지 않고 같은 내용으로 1회.
schedulesRoute.post("/:id/run", async (c) => {
  const s = getScheduleDb(c.req.param("id"));
  if (!s) return c.json({ error: "not_found" }, 404);
  if (s.workflow) {
    const wf = readWorkflows().find((w) => w.name === s.workflow);
    if (!wf) return c.json({ error: "workflow_not_found" }, 400);
    const result = await startWorkflow(wf, { input: s.prompt, projectId: s.projectId });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ run: result.run }, 201);
  }
  const result = await startRun({ agent: s.agent, prompt: s.prompt, projectId: s.projectId });
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ run: result.run }, 201);
});
