// scheduled_runs CRUD. 순수 DB 계층 — cron 계산/타이머는 services/scheduler.ts.

import { randomUUID } from "node:crypto";
import type { ScheduledRun } from "@loom/core";
import { getDb } from "./client.js";

interface ScheduledRunRow {
  id: string;
  agent_id: string;
  name: string;
  prompt: string;
  cron: string;
  timezone: string | null;
  cwd: string | null;
  enabled: number;
  last_fired_at: string | null;
  last_run_id: string | null;
  next_fire_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToSchedule(row: ScheduledRunRow): ScheduledRun {
  return {
    id: row.id,
    agentId: row.agent_id,
    name: row.name,
    prompt: row.prompt,
    cron: row.cron,
    timezone: row.timezone,
    cwd: row.cwd,
    enabled: row.enabled === 1,
    lastFiredAt: row.last_fired_at,
    lastRunId: row.last_run_id,
    nextFireAt: row.next_fire_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listSchedules(filter: { agentId?: string } = {}): ScheduledRun[] {
  const db = getDb();
  const rows = filter.agentId
    ? db
        .prepare<[string], ScheduledRunRow>(
          `SELECT * FROM scheduled_runs WHERE agent_id = ? ORDER BY created_at DESC`,
        )
        .all(filter.agentId)
    : db
        .prepare<[], ScheduledRunRow>(
          `SELECT * FROM scheduled_runs ORDER BY created_at DESC`,
        )
        .all();
  return rows.map(rowToSchedule);
}

export function listEnabledSchedules(): ScheduledRun[] {
  const rows = getDb()
    .prepare<[], ScheduledRunRow>(
      `SELECT * FROM scheduled_runs WHERE enabled = 1 ORDER BY created_at ASC`,
    )
    .all();
  return rows.map(rowToSchedule);
}

export function getSchedule(id: string): ScheduledRun | null {
  const row = getDb()
    .prepare<[string], ScheduledRunRow>(
      `SELECT * FROM scheduled_runs WHERE id = ?`,
    )
    .get(id);
  return row ? rowToSchedule(row) : null;
}

export interface CreateScheduleInput {
  agentId: string;
  name: string;
  prompt: string;
  cron: string;
  timezone?: string | null;
  cwd?: string | null;
  enabled?: boolean;
  nextFireAt?: string | null;
}

export function createSchedule(input: CreateScheduleInput): ScheduledRun {
  const now = new Date().toISOString();
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO scheduled_runs
         (id, agent_id, name, prompt, cron, timezone, cwd, enabled,
          next_fire_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.agentId,
      input.name,
      input.prompt,
      input.cron,
      input.timezone ?? null,
      input.cwd ?? null,
      input.enabled === false ? 0 : 1,
      input.nextFireAt ?? null,
      now,
      now,
    );
  return getSchedule(id)!;
}

export interface UpdateScheduleInput {
  name?: string;
  prompt?: string;
  cron?: string;
  timezone?: string | null;
  cwd?: string | null;
  enabled?: boolean;
  nextFireAt?: string | null;
}

export function updateSchedule(
  id: string,
  input: UpdateScheduleInput,
): ScheduledRun | null {
  const existing = getSchedule(id);
  if (!existing) return null;
  const next = {
    name: input.name ?? existing.name,
    prompt: input.prompt ?? existing.prompt,
    cron: input.cron ?? existing.cron,
    timezone: input.timezone !== undefined ? input.timezone : existing.timezone,
    cwd: input.cwd !== undefined ? input.cwd : existing.cwd,
    enabled: input.enabled !== undefined ? input.enabled : existing.enabled,
    nextFireAt:
      input.nextFireAt !== undefined ? input.nextFireAt : existing.nextFireAt,
  };
  getDb()
    .prepare(
      `UPDATE scheduled_runs
       SET name = ?, prompt = ?, cron = ?, timezone = ?, cwd = ?,
           enabled = ?, next_fire_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      next.name,
      next.prompt,
      next.cron,
      next.timezone,
      next.cwd,
      next.enabled ? 1 : 0,
      next.nextFireAt,
      new Date().toISOString(),
      id,
    );
  return getSchedule(id);
}

/** 발화 기록 — lastFiredAt 갱신 + (성공 시) lastRunId + nextFireAt 재계산값. */
export function recordScheduleFired(
  id: string,
  args: { runId: string | null; nextFireAt: string | null },
): void {
  getDb()
    .prepare<[string, string | null, string | null, string]>(
      `UPDATE scheduled_runs
       SET last_fired_at = ?, last_run_id = ?, next_fire_at = ?
       WHERE id = ?`,
    )
    .run(new Date().toISOString(), args.runId, args.nextFireAt, id);
}

export function deleteSchedule(id: string): boolean {
  const result = getDb()
    .prepare(`DELETE FROM scheduled_runs WHERE id = ?`)
    .run(id);
  return result.changes > 0;
}
