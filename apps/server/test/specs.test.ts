import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CliAdapter, RunHandle, SpawnArgs } from "@loom/core";
import { registerAdapter, clearAdapters } from "../src/adapters/registry.js";
import { claudeCodeAdapter } from "@loom/adapter-claude-code";
import { createAgent, deleteAgent, updateAgent } from "../src/db/agents.js";
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
let testProjectPath: string;

beforeEach(() => {
  getDb().exec(
    "DELETE FROM runs; DELETE FROM specs; DELETE FROM agents; DELETE FROM projects;",
  );
  // skill-sync writes to <project.path>/.loom/... — give each test a fresh
  // tmpdir so writes can't pollute the working tree or leak across tests.
  testProjectPath = mkdtempSync(join(tmpdir(), "loom-test-"));
  testProjectId = createProject({ name: "test", path: testProjectPath }).id;
});

afterEach(() => {
  if (testProjectPath) {
    try {
      rmSync(testProjectPath, { recursive: true, force: true });
    } catch {
      // ignore — best effort cleanup
    }
  }
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
    expect(composePrompt({ userPrompt: "hi", skills: [] })).toBe("hi");
  });

  it("prepends agent prompt before user task", () => {
    const composed = composePrompt({
      userPrompt: "task",
      skills: [],
      agentPrompt: "be terse",
    });
    expect(composed).toBe(
      "=== Agent Instructions ===\nbe terse\n=== End Instructions ===\n\ntask",
    );
  });

  it("emits a skill manifest (paths + first-line summary) — not the full bodies", () => {
    const project = {
      id: testProjectId,
      name: "test",
      path: testProjectPath,
      description: null,
      createdAt: "",
      updatedAt: "",
    };
    const agent = createAgent({
      projectId: testProjectId,
      name: "engineer",
      adapterKind: "capture-shell",
    });
    const a = createSpec({
      name: "API Conventions",
      content: [
        "REST conventions overview",
        "POST is not idempotent",
        "Endpoints return JSON",
      ].join("\n"),
    });
    const composed = composePrompt({
      userPrompt: "task",
      skills: [a],
      project,
      agent,
    });
    // The manifest section names the skill, its on-disk path, and the
    // *first line* of the body as a summary.
    expect(composed).toContain("=== Available Skills");
    expect(composed).toContain("api-conventions.md");
    expect(composed).toContain(agent.id);
    expect(composed).toContain("REST conventions overview");
    // Subsequent lines of the body do NOT leak into the prompt — those live
    // on disk and the agent reads them on demand.
    expect(composed).not.toContain("POST is not idempotent");
    expect(composed).not.toContain("Endpoints return JSON");
    // User prompt always lands at the bottom.
    expect(composed.endsWith("task")).toBe(true);
  });
});

describe("startRun with attached specs", () => {
  it("references skills in the manifest and writes their bodies to disk", async () => {
    const spec1 = createSpec({ name: "S1", content: "S1 summary\nfull-body-1" });
    const spec2 = createSpec({ name: "S2", content: "S2 summary\nfull-body-2" });
    const agent = createAgent({
      projectId: testProjectId,
      name: "cap",
      adapterKind: "capture-shell",
      skillIds: [spec1.id, spec2.id],
    });

    const result = await startRun({
      agentId: agent.id,
      prompt: "do thing",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Run record stores the user prompt (not composed) + the snapshot of
    // every skill that participated in this run.
    expect(result.run.prompt).toBe("do thing");
    expect(result.run.attachedSpecIds.sort()).toEqual([spec1.id, spec2.id].sort());

    await waitFor(() => !isRunActive(result.run.id));

    // The CLI prompt has a manifest pointing at disk paths. Skill BODIES
    // (lines after the summary) are NOT inlined — only the first-line
    // summary surfaces, plus the file path.
    const sent = captureAdapter.lastPrompt()!;
    expect(sent).not.toContain("=== Skill: S1 ===");
    expect(sent).not.toContain("full-body-1");
    expect(sent).not.toContain("full-body-2");
    expect(sent).toContain("=== Available Skills");
    expect(sent).toContain("s1.md");
    expect(sent).toContain("s2.md");
    expect(sent).toContain(agent.id);
    expect(sent.endsWith("do thing")).toBe(true);

    // The skill folder for this agent contains exactly two files with the
    // right contents — the agent reads these via its file-read tool.
    const skillsDir = join(testProjectPath, ".loom", "agents", agent.id, "skills");
    const files = readdirSync(skillsDir).sort();
    expect(files).toEqual(["s1.md", "s2.md"]);
    expect(readFileSync(join(skillsDir, "s1.md"), "utf8")).toBe("S1 summary\nfull-body-1");
    expect(readFileSync(join(skillsDir, "s2.md"), "utf8")).toBe("S2 summary\nfull-body-2");
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

  it("rejects per-run attached spec that the agent doesn't own", async () => {
    const agent = createAgent({
      projectId: testProjectId,
      name: "cap",
      adapterKind: "capture-shell",
    });
    const stranger = createSpec({ name: "stranger", content: "x" });
    const result = await startRun({
      agentId: agent.id,
      prompt: "x",
      attachedSpecIds: [stranger.id],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain("spec_not_assigned_to_agent");
    }
  });

  it("manifest lists per-run attached skills in the supplied order", async () => {
    const a = createSpec({ name: "Alpha", content: "first" });
    const b = createSpec({ name: "Bravo", content: "second" });
    const c = createSpec({ name: "Charlie", content: "third" });
    const agent = createAgent({
      projectId: testProjectId,
      name: "cap",
      adapterKind: "capture-shell",
      skillIds: [a.id, b.id, c.id],
    });

    const result = await startRun({
      agentId: agent.id,
      prompt: "go",
      attachedSpecIds: [c.id, a.id, b.id],
    });
    if (!result.ok) throw new Error("expected ok");
    await waitFor(() => !isRunActive(result.run.id));

    const sent = captureAdapter.lastPrompt()!;
    const idxAlpha = sent.indexOf("alpha.md");
    const idxBravo = sent.indexOf("bravo.md");
    const idxCharlie = sent.indexOf("charlie.md");
    expect(idxCharlie).toBeGreaterThan(0);
    expect(idxAlpha).toBeGreaterThan(idxCharlie);
    expect(idxBravo).toBeGreaterThan(idxAlpha);
  });

  it("works with no specs (no manifest, just user prompt)", async () => {
    const agent = createAgent({ projectId: testProjectId, name: "cap", adapterKind: "capture-shell" });
    const result = await startRun({ agentId: agent.id, prompt: "lonely" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.run.attachedSpecIds).toEqual([]);
    await waitFor(() => !isRunActive(result.run.id));
    expect(captureAdapter.lastPrompt()).toBe("lonely");
  });
});

describe("skill-sync (DB → disk mirroring)", () => {
  it("rewrites the agent's folder when its skillIds change", () => {
    const agent = createAgent({ projectId: testProjectId, name: "x", adapterKind: "capture-shell" });
    const a = createSpec({ name: "A", content: "alpha" });
    const b = createSpec({ name: "B", content: "beta" });

    const dir = join(testProjectPath, ".loom", "agents", agent.id, "skills");
    expect(readdirSync(dir).sort()).toEqual([]);

    updateAgent(agent.id, { skillIds: [a.id, b.id] });
    expect(readdirSync(dir).sort()).toEqual(["a.md", "b.md"]);

    updateAgent(agent.id, { skillIds: [a.id] });
    expect(readdirSync(dir).sort()).toEqual(["a.md"]);
  });

  it("propagates spec content edits to every agent that has it assigned", () => {
    const agent1 = createAgent({ projectId: testProjectId, name: "one", adapterKind: "capture-shell" });
    const agent2 = createAgent({ projectId: testProjectId, name: "two", adapterKind: "capture-shell" });
    const shared = createSpec({ name: "Shared", content: "v1" });
    updateAgent(agent1.id, { skillIds: [shared.id] });
    updateAgent(agent2.id, { skillIds: [shared.id] });

    const file1 = join(testProjectPath, ".loom", "agents", agent1.id, "skills", "shared.md");
    const file2 = join(testProjectPath, ".loom", "agents", agent2.id, "skills", "shared.md");
    expect(readFileSync(file1, "utf8")).toBe("v1");
    expect(readFileSync(file2, "utf8")).toBe("v1");

    updateSpec(shared.id, { content: "v2" });
    expect(readFileSync(file1, "utf8")).toBe("v2");
    expect(readFileSync(file2, "utf8")).toBe("v2");
  });

  it("removes the file from every agent folder when a spec is deleted", () => {
    const agent = createAgent({ projectId: testProjectId, name: "z", adapterKind: "capture-shell" });
    const s = createSpec({ name: "Doomed", content: "x" });
    updateAgent(agent.id, { skillIds: [s.id] });

    const filePath = join(testProjectPath, ".loom", "agents", agent.id, "skills", "doomed.md");
    expect(readFileSync(filePath, "utf8")).toBe("x");

    deleteSpec(s.id);
    const dir = join(testProjectPath, ".loom", "agents", agent.id, "skills");
    expect(readdirSync(dir)).toEqual([]);
  });

  it("removes the agent's whole folder when the agent is deleted", () => {
    const agent = createAgent({ projectId: testProjectId, name: "doomed-agent", adapterKind: "capture-shell" });
    const s = createSpec({ name: "S", content: "x" });
    updateAgent(agent.id, { skillIds: [s.id] });

    const agentDir = join(testProjectPath, ".loom", "agents", agent.id);
    expect(() => readdirSync(agentDir)).not.toThrow();

    deleteAgent(agent.id);
    expect(() => readdirSync(agentDir)).toThrow();
  });
});
