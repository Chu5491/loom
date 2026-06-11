// 스케줄 API — CRUD + 즉시 실행. 변경 시마다 스케줄러 재등록.

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import type { Schedule } from "@loom/core";
import { deleteScheduleDb, getProjectDb, getScheduleDb, insertSchedule, listSchedulesDb, updateScheduleDb } from "../db.js";
import { readAgents } from "../office.js";
import { startRun } from "../run/engine.js";
import { nextRunAt, reschedule, validateCron } from "../run/scheduler.js";
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
  agent: z.string().min(1),
  prompt: z.string().trim().min(1).max(20_000),
  cron: z.string().trim().min(1),
  projectId: z.string().nullable().default(null),
  enabled: z.boolean().default(true),
});

schedulesRoute.post("/", async (c) => {
  const data = await parseBody(c, createSchema);
  if (isResponse(data)) return data;
  if (!readAgents().some((a) => a.name === data.agent)) return c.json({ error: "agent_not_found" }, 400);
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
  if (data.agent && !readAgents().some((a) => a.name === data.agent)) return c.json({ error: "agent_not_found" }, 400);
  if (data.cron) {
    const cronErr = validateCron(data.cron);
    if (cronErr) return c.json({ error: `invalid_cron: ${cronErr}` }, 400);
  }
  const next: Schedule = { ...cur, ...data };
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
  const result = await startRun({ agent: s.agent, prompt: s.prompt, projectId: s.projectId });
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ run: result.run }, 201);
});
