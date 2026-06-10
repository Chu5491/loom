// 하네스 자동 발화의 통합 검증 — 가짜 shell 어댑터로 실제 run 라이프사이클을
// 돌려 (1) auto 엣지가 자식 run 을 띄우는지, (2) carry_result 가 부모 결과를
// 자식 프롬프트에 싣는지, (3) 순환 하네스가 hop 한도에서 멈추는지 확인.

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { spawn } from "node:child_process";
import type { CliAdapter, RunHandle, SpawnArgs } from "@loom/core";
import { registerAdapter, clearAdapters } from "../src/adapters/registry.js";
import { createAgent } from "../src/db/agents.js";
import { createProject } from "../src/db/projects.js";
import { createHarnessEdge } from "../src/db/harness-edges.js";
import { listRuns } from "../src/db/runs.js";
import { startRun, isRunActive } from "../src/services/run-service.js";
import { MAX_HARNESS_HOPS } from "../src/services/harness.js";
import { getDb } from "../src/db/client.js";

// echo 한 줄 + exit 0. config.extraArgs 로 stdout 내용을 바꿀 수 있다.
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
      proc.stdout.on("data", (b: Buffer) => args.onStdout(b.toString("utf8")));
      proc.stderr.on("data", (b: Buffer) => args.onStderr(b.toString("utf8")));
      proc.stdin.write(args.prompt);
      proc.stdin.end();
      const promise = new Promise<{ exitCode: number; signal: NodeJS.Signals | null }>(
        (resolve, reject) => {
          proc.on("error", reject);
          proc.on("exit", (code, signal) => resolve({ exitCode: code ?? -1, signal }));
        },
      );
      return { pid: proc.pid ?? -1, promise, kill: () => proc.kill("SIGTERM") };
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

function shellAgent(projectId: string, name: string, sh: string) {
  return createAgent({
    projectId,
    name,
    adapterKind: "shell",
    adapterConfig: { command: "/bin/sh", extraArgs: ["-c", sh] },
  });
}

beforeAll(() => {
  getDb();
  clearAdapters();
  registerAdapter(shellAdapter());
});

let projectId: string;

beforeEach(() => {
  getDb().exec(
    "DELETE FROM harness_edges; DELETE FROM runs; DELETE FROM agents; DELETE FROM projects;",
  );
  projectId = createProject({ name: "test", path: process.cwd() }).id;
});

describe("harness auto-fire", () => {
  it("an auto on_success edge spawns a child run for the target agent", async () => {
    const builder = shellAgent(projectId, "builder", "echo built; exit 0");
    const reviewer = shellAgent(projectId, "reviewer", "exit 0");
    createHarnessEdge({
      projectId,
      fromAgentId: builder.id,
      toAgentId: reviewer.id,
      trigger: "on_success",
      mode: "auto",
      prompt: "review the work",
    });

    const res = await startRun({ agentId: builder.id, prompt: "build it" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const parentId = res.run.id;

    await waitFor(() => !isRunActive(parentId));
    // child is fired after the parent's finally — wait for it to appear + settle.
    await waitFor(() => listRuns({ agentId: reviewer.id }).length === 1);
    await waitFor(
      () => listRuns({ agentId: reviewer.id }).every((r) => !isRunActive(r.id)),
    );

    const childRuns = listRuns({ agentId: reviewer.id });
    expect(childRuns).toHaveLength(1);
    expect(childRuns[0]?.parentRunId).toBe(parentId);
    expect(childRuns[0]?.threadId).toBe(res.run.threadId);
    expect(childRuns[0]?.prompt).toBe("review the work");
  });

  it("carry_result carries the parent's result into the child prompt", async () => {
    const builder = shellAgent(
      projectId,
      "builder",
      `echo '{"type":"result","result":"BUILDER_OUTPUT"}'; exit 0`,
    );
    const reviewer = shellAgent(projectId, "reviewer", "exit 0");
    createHarnessEdge({
      projectId,
      fromAgentId: builder.id,
      toAgentId: reviewer.id,
      trigger: "on_success",
      mode: "auto",
      prompt: "review",
      carryResult: true,
    });

    const res = await startRun({ agentId: builder.id, prompt: "build" });
    if (!res.ok) throw new Error("start failed");
    await waitFor(() => !isRunActive(res.run.id));
    await waitFor(() => listRuns({ agentId: reviewer.id }).length === 1);

    const child = listRuns({ agentId: reviewer.id })[0]!;
    expect(child.prompt).toContain("=== Result from @builder");
    expect(child.prompt).toContain("BUILDER_OUTPUT");
    expect(child.prompt).toContain("review");
  });

  it("a cyclic harness stops at the hop limit instead of looping forever", async () => {
    const a = shellAgent(projectId, "a", "exit 0");
    const b = shellAgent(projectId, "b", "exit 0");
    // a -> b -> a, both auto on_success — would loop without the hop guard.
    createHarnessEdge({ projectId, fromAgentId: a.id, toAgentId: b.id, trigger: "on_success", mode: "auto", prompt: "to b" });
    createHarnessEdge({ projectId, fromAgentId: b.id, toAgentId: a.id, trigger: "on_success", mode: "auto", prompt: "to a" });

    const res = await startRun({ agentId: a.id, prompt: "kick off" });
    if (!res.ok) throw new Error("start failed");

    // let the cascade run and settle.
    await waitFor(() => !isRunActive(res.run.id));
    await waitFor(
      () => listRuns({}).every((r) => !isRunActive(r.id)) && listRuns({}).length >= 2,
      8000,
    );
    // settle margin — ensure no further children appear.
    await new Promise((r) => setTimeout(r, 300));

    const total = listRuns({}).length;
    // chain is bounded by MAX_HARNESS_HOPS; never unbounded.
    expect(total).toBeLessThanOrEqual(MAX_HARNESS_HOPS + 2);
    expect(total).toBeGreaterThan(1);
  });
});
