import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { spawn } from "node:child_process";
import type { CliAdapter, RunHandle, SpawnArgs } from "@loom/core";
import { registerAdapter, clearAdapters } from "../src/adapters/registry.js";
import { claudeCodeAdapter } from "@loom/adapter-claude-code";
import { createAgent } from "../src/db/agents.js";
import { createProject } from "../src/db/projects.js";
import { createSpec, getSpec, listSpecs, updateSpec, deleteSpec } from "../src/db/specs.js";
import { getRun } from "../src/db/runs.js";
import {
  startRun,
  isRunActive,
  composePrompt,
} from "../src/services/run-service.js";
import { readLogFile } from "../src/services/log-store.js";
import { getDb } from "../src/db/client.js";

function captureShellAdapter(): CliAdapter & { lastPrompt: () => string | null } {
  let lastPrompt: string | null = null;
  return {
    kind: "capture-shell",
    lastPrompt: () => lastPrompt,
    buildCommand: () => ({ command: "/bin/cat", args: [] }),
    async spawn(args: SpawnArgs): Promise<RunHandle> {
      lastPrompt = args.prompt;
      const proc = spawn("/bin/cat", [], {
        cwd: args.cwd,
        env: { ...process.env, ...args.env },
        stdio: ["pipe", "pipe", "pipe"],
      });
      proc.stdout.on("data", (b: Buffer) => args.onStdout(b.toString("utf8")));
      proc.stderr.on("data", (b: Buffer) => args.onStderr(b.toString("utf8")));
      proc.stdin.write(args.prompt);
      proc.stdin.end();
      const promise = new Promise<{ exitCode: number; signal: NodeJS.Signals | null }>(
        (resolve, reject) => {
          proc.on("error", reject);
          proc.on("exit", (code, signal) =>
            resolve({ exitCode: code ?? -1, signal }),
          );
        },
      );
      return { pid: proc.pid ?? -1, promise, kill: () => proc.kill("SIGTERM") };
    },
  };
}

const captureAdapter = captureShellAdapter();

async function waitFor(p: () => boolean, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (p()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

beforeAll(() => {
  getDb();
  clearAdapters();
  registerAdapter(captureAdapter);
  registerAdapter(claudeCodeAdapter);
});

let testProjectId: string;

beforeEach(() => {
  getDb().exec(
    "DELETE FROM runs; DELETE FROM specs; DELETE FROM agents; DELETE FROM projects;",
  );
  testProjectId = createProject({ name: "test", path: process.cwd() }).id;
});

describe("specs CRUD", () => {
  it("creates, lists, updates, and deletes a spec", () => {
    const created = createSpec({
      name: "Coding standards",
      content: "# Rules\n- be terse\n- write tests",
      tags: ["style", "core"],
    });
    expect(created.id).toBeTruthy();
    expect(created.tags).toEqual(["style", "core"]);

    const fetched = getSpec(created.id);
    expect(fetched?.content).toContain("be terse");

    const updated = updateSpec(created.id, { content: "v2" });
    expect(updated?.content).toBe("v2");
    expect(updated?.tags).toEqual(["style", "core"]);

    expect(listSpecs()).toHaveLength(1);
    expect(deleteSpec(created.id)).toBe(true);
    expect(listSpecs()).toHaveLength(0);
  });

  it("filters by agentId", () => {
    const a = createAgent({ projectId: testProjectId, name: "x", adapterKind: "capture-shell" });
    const b = createAgent({ projectId: testProjectId, name: "y", adapterKind: "capture-shell" });
    createSpec({ name: "for-a", content: "", agentId: a.id });
    createSpec({ name: "for-b", content: "", agentId: b.id });
    createSpec({ name: "shared", content: "", agentId: null });

    expect(listSpecs({ agentId: a.id })).toHaveLength(1);
    expect(listSpecs({ agentId: a.id })[0]!.name).toBe("for-a");
    expect(listSpecs()).toHaveLength(3);
  });
});

describe("composePrompt", () => {
  it("returns user prompt unchanged when no skills + empty agent prompt", () => {
    expect(composePrompt("hi", [])).toBe("hi");
  });

  it("prepends each skill with delimiters in order", () => {
    const a = createSpec({ name: "First", content: "alpha" });
    const b = createSpec({ name: "Second", content: "beta" });
    const composed = composePrompt("user-task", [a, b]);
    expect(composed).toBe(
      "=== Skill: First ===\nalpha\n=== End Skill ===\n\n=== Skill: Second ===\nbeta\n=== End Skill ===\n\nuser-task",
    );
  });

  it("prepends agent prompt before skills and user task", () => {
    const a = createSpec({ name: "S", content: "skill" });
    const composed = composePrompt("task", [a], "be terse");
    expect(composed).toBe(
      "=== Agent Instructions ===\nbe terse\n=== End Instructions ===\n\n=== Skill: S ===\nskill\n=== End Skill ===\n\ntask",
    );
  });
});

describe("startRun with attached specs", () => {
  it("attaches specs to run record AND prepends to CLI prompt", async () => {
    const agent = createAgent({ projectId: testProjectId, name: "cap", adapterKind: "capture-shell" });
    const spec1 = createSpec({ name: "S1", content: "rules-1" });
    const spec2 = createSpec({ name: "S2", content: "rules-2" });

    const result = await startRun({
      agentId: agent.id,
      prompt: "do thing",
      attachedSpecIds: [spec1.id, spec2.id],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.run.prompt).toBe("do thing");
    expect(result.run.attachedSpecIds).toEqual([spec1.id, spec2.id]);

    await waitFor(() => !isRunActive(result.run.id));

    const sent = captureAdapter.lastPrompt();
    expect(sent).toContain("=== Skill: S1 ===");
    expect(sent).toContain("rules-1");
    expect(sent).toContain("=== Skill: S2 ===");
    expect(sent).toContain("rules-2");
    expect(sent!.endsWith("do thing")).toBe(true);

    const final = getRun(result.run.id)!;
    expect(final.status).toBe("succeeded");
    const events = await readLogFile(final.logPath!);
    const stdout = events
      .filter((e) => e.kind === "chunk" && e.chunk.stream === "stdout")
      .map((e) => (e as { kind: "chunk"; chunk: { data: string } }).chunk.data)
      .join("");
    expect(stdout).toContain("rules-1");
    expect(stdout).toContain("rules-2");
  });

  it("returns 404 when an attached spec id does not exist", async () => {
    const agent = createAgent({ projectId: testProjectId, name: "cap", adapterKind: "capture-shell" });
    const result = await startRun({
      agentId: agent.id,
      prompt: "x",
      attachedSpecIds: ["00000000-0000-0000-0000-000000000000"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.error).toContain("spec_not_found");
    }
  });

  it("preserves spec order when composing", async () => {
    const agent = createAgent({ projectId: testProjectId, name: "cap", adapterKind: "capture-shell" });
    const a = createSpec({ name: "A", content: "first" });
    const b = createSpec({ name: "B", content: "second" });
    const c = createSpec({ name: "C", content: "third" });

    const result = await startRun({
      agentId: agent.id,
      prompt: "go",
      attachedSpecIds: [c.id, a.id, b.id],
    });
    if (!result.ok) throw new Error("expected ok");
    await waitFor(() => !isRunActive(result.run.id));

    const sent = captureAdapter.lastPrompt()!;
    const idxA = sent.indexOf("first");
    const idxB = sent.indexOf("second");
    const idxC = sent.indexOf("third");
    expect(idxC).toBeGreaterThan(0);
    expect(idxA).toBeGreaterThan(idxC);
    expect(idxB).toBeGreaterThan(idxA);
  });

  it("works with no specs (backward compatible)", async () => {
    const agent = createAgent({ projectId: testProjectId, name: "cap", adapterKind: "capture-shell" });
    const result = await startRun({ agentId: agent.id, prompt: "lonely" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.run.attachedSpecIds).toEqual([]);
    await waitFor(() => !isRunActive(result.run.id));
    expect(captureAdapter.lastPrompt()).toBe("lonely");
  });
});
