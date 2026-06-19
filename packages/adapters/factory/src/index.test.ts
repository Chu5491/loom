import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import type { McpServer } from "@loom/core";
import {
  buildDroidCommand,
  extractDroidSessionId,
  factoryAdapter,
  toDroidMcpEntry,
  syncFactoryMcpConfig,
  DROID_PRESET_MODELS,
} from "./index.js";

function makeServer(over: Partial<McpServer> & Pick<McpServer, "kind" | "name">): McpServer {
  return { description: null, command: null, args: [], env: {}, url: null, headers: {}, ...over };
}

describe("buildDroidCommand", () => {
  it("defaults: droid exec --output-format stream-json --auto low", () => {
    const { command, args } = buildDroidCommand();
    expect(command).toBe("droid");
    // stream-json = 단방향 JSONL(실측) → text/reasoning/tool/file/completion 풀 활동.
    // 기본 --auto low — droid 기본 read-only 면 파일 편집이 막혀 코딩이 실패하므로.
    expect(args).toEqual(["exec", "--output-format", "stream-json", "--auto", "low"]);
  });

  it("bypass uses --skip-permissions-unsafe instead of --auto", () => {
    const { args } = buildDroidCommand({ dangerouslySkipPermissions: true });
    expect(args).toContain("--skip-permissions-unsafe");
    expect(args).not.toContain("--auto");
  });

  it("respects an explicit autonomy level", () => {
    const { args } = buildDroidCommand({ auto: "medium" });
    expect(args[args.indexOf("--auto") + 1]).toBe("medium");
  });

  it("appends --model when set", () => {
    const { args } = buildDroidCommand({ model: "claude-opus-4-8" });
    expect(args[args.indexOf("--model") + 1]).toBe("claude-opus-4-8");
  });

  it("appends --reasoning-effort when set", () => {
    const { args } = buildDroidCommand({ reasoningEffort: "high" });
    expect(args[args.indexOf("--reasoning-effort") + 1]).toBe("high");
  });

  it("appends --cwd when set", () => {
    const { args } = buildDroidCommand({ cwd: "/repo" });
    expect(args[args.indexOf("--cwd") + 1]).toBe("/repo");
  });

  it("appends extraArgs verbatim", () => {
    const { args } = buildDroidCommand({ extraArgs: ["--tag", "ci"] });
    expect(args.slice(-2)).toEqual(["--tag", "ci"]);
  });

  it("respects command override", () => {
    expect(buildDroidCommand({ command: "/opt/droid" }).command).toBe("/opt/droid");
  });

  it("does not put the prompt in args (prompt is via stdin)", () => {
    const { args } = buildDroidCommand({ model: "x" });
    expect(args).not.toContain("-");
    expect(args.join(" ")).not.toContain("prompt");
  });
});

describe("extractDroidSessionId", () => {
  it("pulls session_id from the final result object", () => {
    const line = JSON.stringify({ type: "result", subtype: "success", result: "ok", session_id: "sess-abc" });
    expect(extractDroidSessionId(line)).toBe("sess-abc");
  });

  it("returns null when no result/session_id is present", () => {
    expect(extractDroidSessionId('{"type":"text","part":{"text":"hi"}}')).toBeNull();
    expect(extractDroidSessionId("plain text, not json")).toBeNull();
  });

  it("captures session_id from the stream-json init event (every event carries it)", () => {
    const line = JSON.stringify({ type: "system", subtype: "init", session_id: "5c19-init", model: "custom:glm-4.7-0" });
    expect(extractDroidSessionId(line)).toBe("5c19-init");
  });
});

describe("factoryAdapter", () => {
  it("identifies as factory and supports the system-prompt channel", () => {
    expect(factoryAdapter.kind).toBe("factory");
    expect(factoryAdapter.supportsSystemPrompt).toBe(true);
  });

  it("ships preset models across managed providers", () => {
    const cats = new Set(DROID_PRESET_MODELS.map((m) => m.category));
    expect(cats.has("Anthropic")).toBe(true);
    expect(cats.has("OpenAI")).toBe(true);
    expect(cats.has("Google")).toBe(true);
  });

  it("supports per-run MCP injection (applyMcpServers defined)", () => {
    expect(factoryAdapter.supportsMcpServers).toBe(true);
  });
});

describe("syncFactoryMcpConfig / toDroidMcpEntry", () => {
  it("encodes a stdio server as { type:'stdio', command, args, env }", () => {
    const e = toDroidMcpEntry(makeServer({ kind: "stdio", name: "x", command: "node", args: ["s.js"], env: { K: "v" } }));
    expect(e).toEqual({ type: "stdio", command: "node", args: ["s.js"], env: { K: "v" } });
  });

  it("encodes an http server as { type:'http', url, headers }", () => {
    const e = toDroidMcpEntry(makeServer({ kind: "http", name: "remote", url: "https://mcp.example/mcp", headers: { Authorization: "Bearer t" } }));
    expect(e).toEqual({ type: "http", url: "https://mcp.example/mcp", headers: { Authorization: "Bearer t" } });
  });

  it("writes <cwd>/.factory/mcp.json with the run's servers (project-local, not ~/.factory)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "factory-mcp-"));
    const file = syncFactoryMcpConfig(tmp, [makeServer({ kind: "stdio", name: "fs", command: "fs-mcp", args: [] })]);
    expect(file).toBe(path.join(tmp, ".factory", "mcp.json"));
    const out = JSON.parse(fs.readFileSync(file!, "utf8"));
    expect(out.mcpServers.fs).toEqual({ type: "stdio", command: "fs-mcp", args: [] });
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("preserves the user's existing servers and strips the stale loom delegate entry", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "factory-mcp-"));
    const file = path.join(tmp, ".factory", "mcp.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { mine: { type: "stdio", command: "mine" }, loom: { type: "http", url: "http://x/runOLD" } } }));
    syncFactoryMcpConfig(tmp, [makeServer({ kind: "stdio", name: "fs", command: "fs-mcp", args: [] })]);
    const out = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(Object.keys(out.mcpServers).sort()).toEqual(["fs", "mine"]);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("does not create an empty file when there are no servers and no existing config", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "factory-mcp-"));
    expect(syncFactoryMcpConfig(tmp, [])).toBeNull();
    expect(fs.existsSync(path.join(tmp, ".factory", "mcp.json"))).toBe(false);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
