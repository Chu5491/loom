// 스케줄 CRUD API. cron 식은 저장 전 croner 로 검증, nextFireAt 은 서버가 계산.
// 변경 후 reloadSchedules() 로 타이머를 즉시 갱신.

import { Hono } from "hono";
import { z } from "zod";
import { isResponse, parseBody } from "./helpers.js";
import { getAgent } from "../db/agents.js";
import {
  createSchedule,
  deleteSchedule,
  getSchedule,
  listSchedules,
  updateSchedule,
} from "../db/schedules.js";
import {
  computeNextFire,
  reloadSchedules,
  validateCron,
} from "../services/scheduler.js";

export const schedulesRoute = new Hono();

schedulesRoute.get("/", (c) => {
  const agentId = c.req.query("agentId");
  return c.json({ schedules: listSchedules(agentId ? { agentId } : {}) });
});

schedulesRoute.get("/:id", (c) => {
  const schedule = getSchedule(c.req.param("id"));
  if (!schedule) return c.json({ error: "not_found" }, 404);
  return c.json({ schedule });
});

const createSchema = z.object({
  agentId: z.string().min(1),
  name: z.string().min(1).max(120),
  prompt: z.string().min(1).max(16384),
  cron: z.string().min(1).max(120),
  timezone: z.string().max(64).nullable().optional(),
  cwd: z.string().max(1024).nullable().optional(),
  enabled: z.boolean().optional(),
});

schedulesRoute.post("/", async (c) => {
  const data = await parseBody(c, createSchema);
  if (isResponse(data)) return data;

  if (!getAgent(data.agentId)) {
    return c.json({ error: "agent_not_found" }, 404);
  }
  const cronError = validateCron(data.cron, data.timezone);
  if (cronError) {
    return c.json({ error: "invalid_cron", message: cronError }, 400);
  }

  const schedule = createSchedule({
    ...data,
    nextFireAt: computeNextFire(data.cron, data.timezone),
  });
  reloadSchedules();
  return c.json({ schedule }, 201);
});

const updateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    prompt: z.string().min(1).max(16384).optional(),
    cron: z.string().min(1).max(120).optional(),
    timezone: z.string().max(64).nullable().optional(),
    cwd: z.string().max(1024).nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "at least one field required",
  });

schedulesRoute.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = getSchedule(id);
  if (!existing) return c.json({ error: "not_found" }, 404);

  const data = await parseBody(c, updateSchema);
  if (isResponse(data)) return data;

  // cron 또는 timezone 이 바뀌면 둘의 조합으로 재검증 + nextFireAt 재계산.
  const cron = data.cron ?? existing.cron;
  const timezone = data.timezone !== undefined ? data.timezone : existing.timezone;
  if (data.cron !== undefined || data.timezone !== undefined) {
    const cronError = validateCron(cron, timezone);
    if (cronError) {
      return c.json({ error: "invalid_cron", message: cronError }, 400);
    }
  }

  const schedule = updateSchedule(id, {
    ...data,
    nextFireAt: computeNextFire(cron, timezone),
  });
  reloadSchedules();
  return c.json({ schedule });
});

schedulesRoute.delete("/:id", (c) => {
  const ok = deleteSchedule(c.req.param("id"));
  if (!ok) return c.json({ error: "not_found" }, 404);
  reloadSchedules();
  return c.json({ ok: true });
});
