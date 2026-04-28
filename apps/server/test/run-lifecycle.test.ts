import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { spawn } from "node:child_process";
import type { CliAdapter, RunHandle, SpawnArgs } from "@loom/core";
import { registerAdapter, clearAdapters } from "../src/adapters/registry.js";
import { claudeCodeAdapter } from "@loom/adapter-claude-code";
import { createAgent } from "../src/db/agents.js";
import { createProject } from "../src/db/projects.js";
import { getRun } from "../src/db/runs.js";
import { startRun, cancelRun, isRunActive } from "../src/services/run-service.js";
import { readLogFile } from "../src/services/log-store.js";
import { getDb } from "../src/db/client.js";

function shellAdapter(): CliAdapter {
  return {
    kind: "shell",
    buildCommand: (config) => ({
      command: (config.command as string) ?? "/bin/sh",
      args: (config.extraArgs as string[]) ?? ["-c", "true"],
    }),
    async spawn(args: SpawnArgs, config): Promise<RunHandle> {
      const cmd = (config.command as string) ?? "/bin/sh";
      const cmdArgs = (config.extraArgs as string[]) ?? ["-c", "true"];
      const proc = spawn(cmd, cmdArgs, {
        cwd: args.cwd,
        env: { ...process.env, ...args.env },
        stdio: ["pipe", "pipe", "pipe"],
      });
      if (args.signal) {
        const onAbort = () => proc.kill("SIGTERM");
        if (args.signal.aborted) onAbort();
        else args.signal.addEventListener("abort", onAbort, { once: true });
      }
      proc.stdout.on("data", (b: Buffer) => args.onStdout(b.toString("utf8")));
      proc.stderr.on("data", (b: Buffer) => args.onStderr(b.toString("utf8")));
      proc.stdin.write(args.prompt);
      proc.stdin.end();
      const promise = new Promise<{ exitCode: number; signal: NodeJS.Signals | null }>(
        (resolve, reject) => {
          proc.on("error", reject);
          proc.on("exit", (code, signal) => {
            resolve({ exitCode: code ?? -1, signal });
          });
        },
      );
      return {
        pid: proc.pid ?? -1,
        promise,
        kill: () => proc.kill("SIGTERM"),
      };
    },
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000,
  intervalMs = 25,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("waitFor timeout");
}

beforeAll(() => {
  getDb();
  clearAdapters();
  registerAdapter(shellAdapter());
  registerAdapter(claudeCodeAdapter);
});

let testProjectId: string;

beforeEach(() => {
  getDb().exec(
    "DELETE FROM runs; DELETE FROM agents; DELETE FROM projects;",
  );
  testProjectId = createProject({ name: "test", path: process.cwd() }).id;
});

describe("run lifecycle", () => {
  it("succeeds with exit 0 and writes logs", async () => {
    const agent = createAgent({
      projectId: testProjectId,
      name: "shell-success",
      adapterKind: "shell",
      adapterConfig: {
        command: "/bin/sh",
        extraArgs: ["-c", "echo hello-out; echo hello-err 1>&2; exit 0"],
      },
    });

    const result = await startRun({ agentId: agent.id, prompt: "ignored" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const runId = result.run.id;
    expect(result.run.status).toBe("queued");

    await waitFor(() => !isRunActive(runId));

    const final = getRun(runId)!;
    expect(final.status).toBe("succeeded");
    expect(final.exitCode).toBe(0);
    expect(final.startedAt).not.toBeNull();
    expect(final.endedAt).not.toBeNull();
    expect(final.pid).toBeGreaterThan(0);

    expect(final.logPath).not.toBeNull();
    const events = await readLogFile(final.logPath!);
    const stdoutEvents = events.filter((e) => e.kind === "chunk" && e.chunk.stream === "stdout");
    const stderrEvents = events.filter((e) => e.kind === "chunk" && e.chunk.stream === "stderr");
    const doneEvents = events.filter((e) => e.kind === "done");

    expect(stdoutEvents.map((e) => (e as { kind: "chunk"; chunk: { data: string } }).chunk.data).join("")).toContain("hello-out");
    expect(stderrEvents.map((e) => (e as { kind: "chunk"; chunk: { data: string } }).chunk.data).join("")).toContain("hello-err");
    expect(doneEvents).toHaveLength(1);
    expect((doneEvents[0] as { kind: "done"; done: { status: string } }).done.status).toBe("succeeded");
  });

  it("marks failed on non-zero exit", async () => {
    const agent = createAgent({
      projectId: testProjectId,
      name: "shell-fail",
      adapterKind: "shell",
      adapterConfig: {
        command: "/bin/sh",
        extraArgs: ["-c", "echo nope 1>&2; exit 7"],
      },
    });

    const result = await startRun({ agentId: agent.id, prompt: "ignored" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await waitFor(() => !isRunActive(result.run.id));
    const final = getRun(result.run.id)!;
    expect(final.status).toBe("failed");
    expect(final.exitCode).toBe(7);
  });

  it("marks cancelled on abort", async () => {
    const agent = createAgent({
      projectId: testProjectId,
      name: "shell-sleep",
      adapterKind: "shell",
      adapterConfig: {
        command: "/bin/sh",
        extraArgs: ["-c", "sleep 30"],
      },
    });

    const result = await startRun({ agentId: agent.id, prompt: "ignored" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const runId = result.run.id;

    await waitFor(() => {
      const r = getRun(runId);
      return r?.status === "running";
    });

    const cancel = cancelRun(runId);
    expect(cancel.ok).toBe(true);

    await waitFor(() => !isRunActive(runId));
    const final = getRun(runId)!;
    expect(final.status).toBe("cancelled");
  });

  it("returns 404 when starting run with unknown agent", async () => {
    const result = await startRun({
      agentId: "00000000-0000-0000-0000-000000000000",
      prompt: "x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });

  it("returns 400 when agent's adapter kind is not registered", async () => {
    const agent = createAgent({
      projectId: testProjectId,
      name: "ghost",
      adapterKind: "does-not-exist",
      adapterConfig: {},
    });
    const result = await startRun({ agentId: agent.id, prompt: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("cancel returns 404 for unknown run, 409 for terminal run", async () => {
    expect(cancelRun("does-not-exist")).toMatchObject({ ok: false, status: 404 });

    const agent = createAgent({
      projectId: testProjectId,
      name: "shell-quick",
      adapterKind: "shell",
      adapterConfig: { command: "/bin/sh", extraArgs: ["-c", "exit 0"] },
    });
    const result = await startRun({ agentId: agent.id, prompt: "x" });
    if (!result.ok) throw new Error("expected start");
    await waitFor(() => !isRunActive(result.run.id));

    expect(cancelRun(result.run.id)).toMatchObject({ ok: false, status: 409 });
  });
});
