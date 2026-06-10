import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { applyPrompt } from "@loom/adapter-utils";
import {
  buildDevinCommand,
  devinAdapter,
  toDevinMcpEntry,
  writeDevinMcpConfig,
  DEVIN_PRESET_MODELS,
} from "./index.js";

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

    expect(writeDevinMcpConfig(tmp, [CANARY])).toBe(file);
    const out = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(out.other).toBe(1);
    expect(Object.keys(out.mcpServers).sort()).toEqual(["canary", "user"]);
    expect(out.mcpServers.canary.transport).toBe("stdio");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("creates the file from scratch when absent", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devin-mcp-"));
    writeDevinMcpConfig(tmp, [CANARY]);
    const out = JSON.parse(
      fs.readFileSync(path.join(tmp, ".devin", "config.local.json"), "utf8"),
    );
    expect(Object.keys(out.mcpServers)).toEqual(["canary"]);
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
