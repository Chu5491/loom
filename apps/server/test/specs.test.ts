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
  it("returns user prompt unchanged when no agent prompt / loadout", () => {
    expect(composePrompt({ userPrompt: "hi" })).toBe("hi");
  });

  it("includes a loadout pointer (path + skill list), not the skill content", () => {
    const composed = composePrompt({
      userPrompt: "user-task",
      loadout: {
        dir: "/tmp/loadout/abc",
        readmePath: "/tmp/loadout/abc/README.md",
        mcpConfigPath: null,
        skills: [
          { name: "First", relPath: "skills/first.md", blurb: "First rule" },
          { name: "Second", relPath: "skills/second.md", blurb: "" },
        ],
        mcpServerNames: [],
      },
    });
    // Loadout block is present with the path + filenames.
    expect(composed).toContain("=== Loadout ===");
    expect(composed).toContain("/tmp/loadout/abc");
    expect(composed).toContain("skills/first.md");
    expect(composed).toContain("skills/second.md");
    // Crucially: the spec *content* is NOT inlined — only the pointer.
    expect(composed).not.toContain("=== Skill: First ===");
    expect(composed.endsWith("user-task")).toBe(true);
  });

  it("prepends agent prompt before loadout and user task", () => {
    const composed = composePrompt({
      userPrompt: "task",
      agentPrompt: "be terse",
      loadout: {
        dir: "/x",
        readmePath: "/x/README.md",
        mcpConfigPath: null,
        skills: [{ name: "S", relPath: "skills/s.md", blurb: "" }],
        mcpServerNames: [],
      },
    });
    const idxAgent = composed.indexOf("Agent Instructions");
    const idxLoadout = composed.indexOf("=== Loadout ===");
    const idxTask = composed.indexOf("task");
    expect(idxAgent).toBeGreaterThanOrEqual(0);
    expect(idxLoadout).toBeGreaterThan(idxAgent);
    expect(idxTask).toBeGreaterThan(idxLoadout);
  });

  it("lists MCP server names in the loadout block", () => {
    const composed = composePrompt({
      userPrompt: "task",
      loadout: {
        dir: "/x",
        readmePath: "/x/README.md",
        mcpConfigPath: "/x/mcp.json",
        skills: [],
        mcpServerNames: ["github", "context7"],
      },
    });
    expect(composed).toContain("MCP servers available");
    expect(composed).toContain("github");
    expect(composed).toContain("context7");
  });

  it("prepends workspace rules above the agent prompt when set", () => {
    const composed = composePrompt({
      userPrompt: "task",
      globalRule: "Always reply in Korean.",
      agentPrompt: "be terse",
    });
    const idxRules = composed.indexOf("=== Workspace Rules ===");
    const idxAgent = composed.indexOf("=== Agent Instructions ===");
    const idxTask = composed.indexOf("task");
    expect(idxRules).toBe(0); // 가장 앞
    expect(idxAgent).toBeGreaterThan(idxRules);
    expect(idxTask).toBeGreaterThan(idxAgent);
    expect(composed).toContain("Always reply in Korean.");
  });

  it("omits the workspace rules block when global rule is empty / whitespace", () => {
    expect(
      composePrompt({ userPrompt: "task", globalRule: "" }),
    ).not.toContain("Workspace Rules");
    expect(
      composePrompt({ userPrompt: "task", globalRule: "   \n\t " }),
    ).not.toContain("Workspace Rules");
  });
});

describe("startRun with attached specs", () => {
  // 새 모델: 스킬 내용은 디스크의 loadout 폴더로 가고, 프롬프트엔 포인터만.
  // 따라서 captureAdapter.lastPrompt()는 "=== Loadout ===" 블록과 파일 경로를
  // 포함하지만 spec 본문(rules-1 등)은 포함하지 않음.
  it("attaches specs to run record AND adds a loadout pointer to the prompt", async () => {
    const agent = createAgent({ projectId: testProjectId, name: "cap", adapterKind: "capture-shell" });
    // Multi-line content so the blurb (first heading) is distinct from the
    // body marker — that's how we verify body content stays *off* the prompt.
    const spec1 = createSpec({
      name: "S1",
      content: "# Headline 1\n\nBODY_MARKER_ALPHA in deeper paragraph.",
    });
    const spec2 = createSpec({
      name: "S2",
      content: "# Headline 2\n\nBODY_MARKER_BETA stuff.",
    });

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

    const sent = captureAdapter.lastPrompt()!;
    // Loadout pointer present, with the spec names + headline blurbs.
    expect(sent).toContain("=== Loadout ===");
    expect(sent).toContain("S1");
    expect(sent).toContain("S2");
    expect(sent).toContain("Headline 1");
    // Crucially: deeper-body markers do NOT leak into the prompt.
    expect(sent).not.toContain("BODY_MARKER_ALPHA");
    expect(sent).not.toContain("BODY_MARKER_BETA");
    expect(sent.endsWith("do thing")).toBe(true);

    // But the full body IS materialized to disk, so the agent can Read it.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { paths } = await import("../src/config.js");
    const dir = path.join(paths.agents, agent.id);
    expect(fs.existsSync(path.join(dir, "README.md"))).toBe(true);
    const skillFiles = fs.readdirSync(path.join(dir, "skills"));
    expect(skillFiles.length).toBe(2);
    const allContent = skillFiles
      .map((f) => fs.readFileSync(path.join(dir, "skills", f), "utf8"))
      .join("\n");
    expect(allContent).toContain("BODY_MARKER_ALPHA");
    expect(allContent).toContain("BODY_MARKER_BETA");
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

  it("preserves spec order in the loadout pointer", async () => {
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
    // 입력 순서대로(C, A, B) loadout 인덱스에 등장.
    const idxA = sent.indexOf(" A");
    const idxB = sent.indexOf(" B");
    const idxC = sent.indexOf(" C");
    expect(idxC).toBeGreaterThan(0);
    expect(idxA).toBeGreaterThan(idxC);
    expect(idxB).toBeGreaterThan(idxA);
  });

  it("emits no loadout block when there are no specs / mcp servers", async () => {
    const agent = createAgent({ projectId: testProjectId, name: "cap", adapterKind: "capture-shell" });
    const result = await startRun({ agentId: agent.id, prompt: "lonely" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.run.attachedSpecIds).toEqual([]);
    await waitFor(() => !isRunActive(result.run.id));
    // 빈 loadout이면 블록 자체가 없고 user prompt만.
    expect(captureAdapter.lastPrompt()).toBe("lonely");
  });
});
