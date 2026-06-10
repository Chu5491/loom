import { describe, it, expect, beforeEach } from "vitest";
import { createAgent } from "../src/db/agents.js";
import { createProject } from "../src/db/projects.js";
import {
  createSchedule,
  deleteSchedule,
  getSchedule,
  listEnabledSchedules,
  listSchedules,
  recordScheduleFired,
  updateSchedule,
} from "../src/db/schedules.js";
import {
  computeNextFire,
  reloadSchedules,
  stopScheduler,
  validateCron,
  _armedScheduleIds,
} from "../src/services/scheduler.js";
import { getDb } from "../src/db/client.js";

function reset(): void {
  const db = getDb();
  db.exec("DELETE FROM scheduled_runs");
  db.exec("DELETE FROM agents");
  db.exec("DELETE FROM projects");
}

function makeAgent(): string {
  const project = createProject({ name: "p", path: "/tmp/p" });
  return createAgent({
    projectId: project.id,
    name: "a",
    adapterKind: "claude-code",
    adapterConfig: {},
  }).id;
}

describe("validateCron", () => {
  it("accepts a standard 5-field expression", () => {
    expect(validateCron("0 9 * * 1-5")).toBeNull();
  });

  it("rejects an out-of-range expression", () => {
    expect(validateCron("99 99 99 99 99")).not.toBeNull();
  });
});

describe("computeNextFire", () => {
  it("returns a future ISO timestamp for a valid expression", () => {
    const from = new Date("2026-06-10T08:00:00.000Z");
    const next = computeNextFire("0 0 * * *", "UTC", from);
    expect(next).toBe("2026-06-11T00:00:00.000Z");
  });

  it("returns null for an invalid expression", () => {
    expect(computeNextFire("not a cron")).toBeNull();
  });
});

describe("scheduled_runs CRUD", () => {
  beforeEach(reset);

  it("creates and reads back a schedule", () => {
    const agentId = makeAgent();
    const created = createSchedule({
      agentId,
      name: "nightly",
      prompt: "summarize today",
      cron: "0 0 * * *",
      timezone: "Asia/Seoul",
    });
    const fetched = getSchedule(created.id);
    expect(fetched?.name).toBe("nightly");
    expect(fetched?.timezone).toBe("Asia/Seoul");
    expect(fetched?.enabled).toBe(true);
  });

  it("listEnabledSchedules excludes disabled rows", () => {
    const agentId = makeAgent();
    createSchedule({ agentId, name: "on", prompt: "p", cron: "0 0 * * *" });
    createSchedule({
      agentId,
      name: "off",
      prompt: "p",
      cron: "0 0 * * *",
      enabled: false,
    });
    const enabled = listEnabledSchedules();
    expect(enabled).toHaveLength(1);
    expect(enabled[0]?.name).toBe("on");
  });

  it("updates only the provided fields", () => {
    const agentId = makeAgent();
    const s = createSchedule({
      agentId,
      name: "old",
      prompt: "p",
      cron: "0 0 * * *",
    });
    const updated = updateSchedule(s.id, { name: "new", enabled: false });
    expect(updated?.name).toBe("new");
    expect(updated?.enabled).toBe(false);
    expect(updated?.prompt).toBe("p");
  });

  it("recordScheduleFired stamps fire time and next fire when the run didn't start", () => {
    const agentId = makeAgent();
    const s = createSchedule({
      agentId,
      name: "n",
      prompt: "p",
      cron: "0 0 * * *",
    });
    // runId null = firing happened but startRun was rejected (e.g. concurrency cap).
    recordScheduleFired(s.id, {
      runId: null,
      nextFireAt: "2026-06-12T00:00:00.000Z",
    });
    const after = getSchedule(s.id);
    expect(after?.lastRunId).toBeNull();
    expect(after?.lastFiredAt).not.toBeNull();
    expect(after?.nextFireAt).toBe("2026-06-12T00:00:00.000Z");
  });

  it("deletes a schedule", () => {
    const agentId = makeAgent();
    const s = createSchedule({
      agentId,
      name: "n",
      prompt: "p",
      cron: "0 0 * * *",
    });
    expect(deleteSchedule(s.id)).toBe(true);
    expect(getSchedule(s.id)).toBeNull();
    expect(listSchedules()).toHaveLength(0);
  });

  it("cascades delete when the agent is removed", () => {
    const agentId = makeAgent();
    createSchedule({ agentId, name: "n", prompt: "p", cron: "0 0 * * *" });
    getDb().prepare("DELETE FROM agents WHERE id = ?").run(agentId);
    expect(listSchedules()).toHaveLength(0);
  });
});

describe("scheduler engine — arming", () => {
  beforeEach(reset);

  it("arms enabled schedules only, and stop clears them", () => {
    const agentId = makeAgent();
    createSchedule({ agentId, name: "on", prompt: "p", cron: "0 0 * * *" });
    createSchedule({
      agentId,
      name: "off",
      prompt: "p",
      cron: "0 0 * * *",
      enabled: false,
    });
    reloadSchedules();
    expect(_armedScheduleIds()).toHaveLength(1);
    stopScheduler();
    expect(_armedScheduleIds()).toHaveLength(0);
  });
});
