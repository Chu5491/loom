import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { applyPrompt } from "@loom/adapter-utils";
import {
  buildDevinCommand,
  captureDevinSession,
  devinAdapter,
  toDevinMcpEntry,
  syncDevinMcpConfig,
  DEVIN_PRESET_MODELS,
} from "./index.js";

// `devin list --format json` 을 흉내내는 가짜 바이너리 — args 무시하고 고정 JSON 출력.
function fakeDevin(stdout: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devin-bin-"));
  const script = path.join(dir, "devin");
  fs.writeFileSync(script, `#!/bin/sh\ncat <<'JSON_EOF'\n${stdout}\nJSON_EOF\n`);
  fs.chmodSync(script, 0o755);
  return script;
}

describe("captureDevinSession", () => {
  it("picks the newest session whose last_activity ≥ since", async () => {
    const since = Date.now();
    const sec = Math.floor(since / 1000);
    const command = fakeDevin(
      JSON.stringify([
        { id: "stale-one", last_activity_at: sec - 100 },
        { id: "fresh-one", last_activity_at: sec + 1 },
      ]),
    );
    expect(await captureDevinSession({ cwd: process.cwd(), since }, { command })).toBe("fresh-one");
  });

  it("returns null when no session is new enough", async () => {
    const since = Date.now();
    const sec = Math.floor(since / 1000);
    const command = fakeDevin(JSON.stringify([{ id: "old", last_activity_at: sec - 100 }]));
    expect(await captureDevinSession({ cwd: process.cwd(), since }, { command })).toBeNull();
  });

  it("returns null on non-JSON output (empty picker)", async () => {
    const command = fakeDevin("No session selected.");
    expect(
      await captureDevinSession({ cwd: process.cwd(), since: Date.now() }, { command }),
    ).toBeNull();
  });
});

const CANARY = {
  name: "canary",
  description: null,
  kind: "stdio" as const,
  command: "node",
  args: ["c.mjs"],
  env: {},
  url: null,
  headers: {},
};

describe("devin MCP injection (.devin/config.local.json)", () => {
  it("encodes stdio server with transport", () => {
    expect(toDevinMcpEntry(CANARY)).toEqual({
      command: "node",
      args: ["c.mjs"],
      transport: "stdio",
    });
  });

  it("merge-writes preserving user entries and other keys", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devin-mcp-"));
    const file = path.join(tmp, ".devin", "config.local.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ other: 1, mcpServers: { user: { url: "http://u", transport: "http" } } }),
    );

    expect(syncDevinMcpConfig(tmp, [CANARY])).toBe(file);
    const out = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(out.other).toBe(1);
    expect(Object.keys(out.mcpServers).sort()).toEqual(["canary", "user"]);
    expect(out.mcpServers.canary.transport).toBe("stdio");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("creates the file from scratch when absent", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devin-mcp-"));
    syncDevinMcpConfig(tmp, [CANARY]);
    const out = JSON.parse(
      fs.readFileSync(path.join(tmp, ".devin", "config.local.json"), "utf8"),
    );
    expect(Object.keys(out.mcpServers)).toEqual(["canary"]);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("strips the transient loom delegate entry left by a prior run", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devin-mcp-"));
    const file = path.join(tmp, ".devin", "config.local.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // 직전 delegate run 이 남긴 죽은 loom + 사용자 서버
    fs.writeFileSync(
      file,
      JSON.stringify({ mcpServers: { loom: { url: "http://x/api/mcp?runId=dead", transport: "http" }, user: { url: "http://u", transport: "http" } } }),
    );
    // delegate=false run — servers 없이 호출돼도 loom 은 사라지고 user 는 남는다
    syncDevinMcpConfig(tmp, []);
    const out = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(Object.keys(out.mcpServers)).toEqual(["user"]);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("does not create an empty config when there is nothing to write", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devin-mcp-"));
    expect(syncDevinMcpConfig(tmp, [])).toBeNull();
    expect(fs.existsSync(path.join(tmp, ".devin"))).toBe(false);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe("buildDevinCommand", () => {
  it("defaults: devin with no flags", () => {
    const { command, args } = buildDevinCommand();
    expect(command).toBe("devin");
    expect(args).toEqual([]);
  });

  it("adds --model when set", () => {
    expect(buildDevinCommand({ model: "claude-opus-4.6" }).args).toEqual([
      "--model",
      "claude-opus-4.6",
    ]);
  });

  it("maps dangerouslySkipPermissions to --permission-mode dangerous", () => {
    expect(buildDevinCommand({ dangerouslySkipPermissions: true }).args).toEqual([
      "--permission-mode",
      "dangerous",
    ]);
    expect(buildDevinCommand().args).not.toContain("--permission-mode");
  });

  it("appends extraArgs at the end", () => {
    expect(buildDevinCommand({ extraArgs: ["--sandbox"] }).args).toEqual([
      "--sandbox",
    ]);
  });

  it("respects command override", () => {
    expect(buildDevinCommand({ command: "/usr/local/bin/devin" }).command).toBe(
      "/usr/local/bin/devin",
    );
  });
});

describe("devin prompt delivery", () => {
  it("passes the prompt via --print (non-interactive), not stdin", () => {
    const { args, stdin } = applyPrompt(
      buildDevinCommand({ model: "opus" }).args,
      "fix the login bug",
      { via: "arg", flag: "--print" },
    );
    expect(args).toEqual(["--model", "opus", "--print", "fix the login bug"]);
    expect(stdin).toBe("");
  });
});

describe("devinAdapter", () => {
  it("identifies as devin", () => {
    expect(devinAdapter.kind).toBe("devin");
  });
});

describe("DEVIN_PRESET_MODELS", () => {
  it("every entry has value, label, and category", () => {
    expect(DEVIN_PRESET_MODELS.length).toBeGreaterThan(0);
    for (const m of DEVIN_PRESET_MODELS) {
      expect(m.value).toBeTruthy();
      expect(m.label).toBeTruthy();
      expect(m.category).toBeTruthy();
    }
  });
});
