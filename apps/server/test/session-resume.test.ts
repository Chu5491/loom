import { describe, it, expect, beforeEach } from "vitest";
import { createAgent } from "../src/db/agents.js";
import { createProject } from "../src/db/projects.js";
import {
  createRun,
  getLatestSessionId,
  markRunFinished,
  setRunSessionId,
} from "../src/db/runs.js";
import { createThread } from "../src/db/threads.js";
import { getDb } from "../src/db/client.js";

function reset(): void {
  const db = getDb();
  db.exec("DELETE FROM runs");
  db.exec("DELETE FROM threads");
  db.exec("DELETE FROM agents");
  db.exec("DELETE FROM projects");
}

function setup() {
  const project = createProject({ name: "p", path: "/tmp/p" });
  const agent = createAgent({
    projectId: project.id,
    name: "a",
    adapterKind: "claude-code",
    adapterConfig: {},
  });
  const thread = createThread({ projectId: project.id, name: "t" });
  return { agent, thread };
}

describe("getLatestSessionId — poison-aware lookup", () => {
  beforeEach(reset);

  it("returns null when there are no runs", () => {
    const { agent, thread } = setup();
    expect(
      getLatestSessionId({ threadId: thread.id, agentId: agent.id }),
    ).toBeNull();
  });

  it("returns the latest succeeded run's session id", () => {
    const { agent, thread } = setup();
    const run = createRun({
      agentId: agent.id,
      threadId: thread.id,
      prompt: "p",
      cwd: "/tmp",
    });
    setRunSessionId(run.id, "sess-1");
    markRunFinished(run.id, "succeeded", 0);
    expect(
      getLatestSessionId({ threadId: thread.id, agentId: agent.id }),
    ).toBe("sess-1");
  });

  it("ignores session ids captured by failed runs", () => {
    const { agent, thread } = setup();
    const run = createRun({
      agentId: agent.id,
      threadId: thread.id,
      prompt: "p",
      cwd: "/tmp",
    });
    setRunSessionId(run.id, "sess-x");
    markRunFinished(run.id, "failed", 1);
    expect(
      getLatestSessionId({ threadId: thread.id, agentId: agent.id }),
    ).toBeNull();
  });

  it("poisons a session id whose later resume attempt failed", () => {
    const { agent, thread } = setup();
    // First run: succeeds, captures sess-A.
    const r1 = createRun({
      agentId: agent.id,
      threadId: thread.id,
      prompt: "p",
      cwd: "/tmp",
    });
    setRunSessionId(r1.id, "sess-A");
    markRunFinished(r1.id, "succeeded", 0);

    // Second run: tries to resume sess-A, fails (CLI rejected the
    // expired session). sess-A is now poisoned.
    const r2 = createRun({
      agentId: agent.id,
      threadId: thread.id,
      prompt: "p2",
      cwd: "/tmp",
      resumedSessionId: "sess-A",
    });
    markRunFinished(r2.id, "failed", 1);

    expect(
      getLatestSessionId({ threadId: thread.id, agentId: agent.id }),
    ).toBeNull();
  });

  it("falls back to an older non-poisoned succeeded session", () => {
    const { agent, thread } = setup();
    // Older succeeded run captures sess-A.
    const r1 = createRun({
      agentId: agent.id,
      threadId: thread.id,
      prompt: "p",
      cwd: "/tmp",
    });
    setRunSessionId(r1.id, "sess-A");
    markRunFinished(r1.id, "succeeded", 0);

    // Newer succeeded run captures sess-B.
    const r2 = createRun({
      agentId: agent.id,
      threadId: thread.id,
      prompt: "p2",
      cwd: "/tmp",
    });
    setRunSessionId(r2.id, "sess-B");
    markRunFinished(r2.id, "succeeded", 0);

    // Latest run resumed sess-B and failed. sess-B is poisoned.
    const r3 = createRun({
      agentId: agent.id,
      threadId: thread.id,
      prompt: "p3",
      cwd: "/tmp",
      resumedSessionId: "sess-B",
    });
    markRunFinished(r3.id, "failed", 1);

    // Should fall back to sess-A.
    expect(
      getLatestSessionId({ threadId: thread.id, agentId: agent.id }),
    ).toBe("sess-A");
  });
});
