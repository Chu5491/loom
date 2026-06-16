// 스케줄 API — CRUD + 즉시 실행. 변경 시마다 스케줄러 재등록.

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import type { Schedule } from "@loom/core";
import { deleteScheduleDb, getProjectDb, getScheduleDb, insertSchedule, listSchedulesDb, updateScheduleDb } from "../db.js";
import { readAgents, readWorkflows } from "../office.js";
import { startRun } from "../run/engine.js";
import { nextRunAt, reschedule, validateCron } from "../run/scheduler.js";
import { runStandup } from "../run/standup.js";
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
  // feature 스케줄(standup)은 서버가 프롬프트를 조립 — 빈 문자열 허용.
  prompt: z.string().trim().max(20_000).default(""),
  cron: z.string().trim().min(1),
  workflow: z.string().nullable().default(null),
  feature: z.enum(["standup"]).nullable().default(null),
  projectId: z.string().nullable().default(null),
  enabled: z.boolean().default(true),
});

type Target = { agent: string; workflow: string | null; feature: "standup" | null; prompt: string; projectId: string | null };
function validateTarget(data: Target): string | null {
  if (data.feature === "standup") {
    // standup 은 기능(office) 으로 돈다 — agent 불요, 프로젝트만 있으면 된다.
    if (!data.projectId) return "project_required_for_standup";
    return null;
  }
  if (!data.prompt) return "prompt_required";
  if (data.workflow) {
    return readWorkflows().some((w) => w.name === data.workflow) ? null : "workflow_not_found";
  }
  if (!data.agent) return "agent_or_workflow_required";
  return readAgents().some((a) => a.name === data.agent) ? null : "agent_not_found";
}

schedulesRoute.post("/", async (c) => {
  const data = await parseBody(c, createSchema);
  if (isResponse(data)) return data;
  const targetErr = validateTarget({ ...data, feature: data.feature ?? null, workflow: data.workflow ?? null });
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
  const targetErr = validateTarget({ agent: next.agent, workflow: next.workflow ?? null, feature: next.feature ?? null, prompt: next.prompt, projectId: next.projectId });
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
  if (s.feature === "standup") {
    if (!s.projectId) return c.json({ error: "project_required_for_standup" }, 400);
    const r = await runStandup(s.projectId, "ko");
    if (!r.ok) return c.json({ error: r.error }, r.status as 400);
    return c.json({ standup: r.standup }, 201);
  }
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
