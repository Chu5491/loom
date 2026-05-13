import { describe, it, expect } from "vitest";
import type { McpServer } from "@loom/core";
import {
  buildCodexCommand,
  codexAdapter,
  toCodexMcpOverrides,
  extractCodexSessionId,
  extractCodexTouchedEdits,
  extractCodexTouchedPaths,
  extractCodexToolUses,
} from "./index.js";

function makeServer(
  over: Partial<McpServer> & Pick<McpServer, "kind" | "name">,
): McpServer {
  return {
    id: "id-" + over.name,
    description: null,
    command: null,
    args: [],
    env: {},
    url: null,
    headers: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("buildCodexCommand", () => {
  it("defaults: codex exec --json -", () => {
    const { command, args } = buildCodexCommand();
    expect(command).toBe("codex");
    expect(args).toEqual(["exec", "--json", "-"]);
  });

  it("appends --model when configured", () => {
    const { args } = buildCodexCommand({ model: "o4-mini" });
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("o4-mini");
  });

  it("encodes reasoningEffort as -c override", () => {
    const { args } = buildCodexCommand({ reasoningEffort: "high" });
    const i = args.indexOf("-c");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe('model_reasoning_effort="high"');
  });

  it("inserts --search when enabled", () => {
    expect(buildCodexCommand({ search: true }).args).toContain("--search");
  });

  it("inserts bypass flag only when enabled", () => {
    expect(buildCodexCommand().args).not.toContain(
      "--dangerously-bypass-approvals-and-sandbox",
    );
    expect(
      buildCodexCommand({ dangerouslyBypassApprovalsAndSandbox: true }).args,
    ).toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("appends --cd when configured", () => {
    const { args } = buildCodexCommand({ cd: "/repo" });
    expect(args[args.indexOf("--cd") + 1]).toBe("/repo");
  });

  it("trailing `-` always remains last so stdin is honored", () => {
    const cases = [
      buildCodexCommand({ model: "x" }).args,
      buildCodexCommand({ extraArgs: ["--foo", "bar"] }).args,
      buildCodexCommand({ search: true, model: "x" }).args,
    ];
    for (const args of cases) expect(args[args.length - 1]).toBe("-");
  });
});

describe("codexAdapter", () => {
  it("identifies as codex", () => {
    expect(codexAdapter.kind).toBe("codex");
  });
});

describe("toCodexMcpOverrides", () => {
  it("encodes a stdio server as -c command/args/env", () => {
    const flags = toCodexMcpOverrides(
      makeServer({
        name: "github",
        kind: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_TOKEN: "ghp_xxx" },
      }),
    );
    // -c key=value 쌍으로 떨어진 게 짝수 개여야 함.
    expect(flags.length % 2).toBe(0);
    // command
    expect(flags).toContain('mcp_servers.github.command="npx"');
    // args (JSON 배열)
    expect(flags).toContain(
      'mcp_servers.github.args=["-y","@modelcontextprotocol/server-github"]',
    );
    // env (dot-path)
    expect(flags).toContain('mcp_servers.github.env.GITHUB_TOKEN="ghp_xxx"');
    // enabled = true
    expect(flags).toContain("mcp_servers.github.enabled=true");
  });

  it("HTTP server uses url + http_headers (codex's TOML key)", () => {
    const flags = toCodexMcpOverrides(
      makeServer({
        name: "remote",
        kind: "http",
        url: "https://api.example.com/mcp",
        headers: { Authorization: "Bearer abc" },
      }),
    );
    expect(flags).toContain('mcp_servers.remote.url="https://api.example.com/mcp"');
    // codex는 `headers`가 아니라 `http_headers` 키를 받음.
    expect(flags).toContain(
      'mcp_servers.remote.http_headers.Authorization="Bearer abc"',
    );
    // 일반 `headers` 키는 사용하지 않음.
    expect(flags.some((f) => f.includes(".headers."))).toBe(false);
  });

  it("SSE server falls back to url + http_headers (codex doesn't support SSE)", () => {
    const flags = toCodexMcpOverrides(
      makeServer({
        name: "stream",
        kind: "sse",
        url: "https://example.com/sse",
        headers: { "X-Token": "t" },
      }),
    );
    // SSE는 codex가 모름 — 우리가 url+http_headers로 폴백.
    expect(flags).toContain('mcp_servers.stream.url="https://example.com/sse"');
    expect(flags).toContain('mcp_servers.stream.http_headers.X-Token="t"');
  });

  it("empty fields are omitted (no null/undefined leakage in TOML keys)", () => {
    const flags = toCodexMcpOverrides(
      makeServer({ name: "minimal", kind: "stdio" }),
    );
    // command 없음 → command 키 안 나와야 함
    expect(flags.some((f) => f.startsWith("mcp_servers.minimal.command="))).toBe(
      false,
    );
    // args 빈 배열 → args 키 안 나와야 함
    expect(flags.some((f) => f.startsWith("mcp_servers.minimal.args="))).toBe(
      false,
    );
    // 그래도 enabled는 항상 있음
    expect(flags).toContain("mcp_servers.minimal.enabled=true");
  });
});

describe("extractCodexSessionId", () => {
  it("extracts thread_id from thread.started event", () => {
    const chunk = '{"type":"thread.started","thread_id":"thread_abc123"}\n';
    expect(extractCodexSessionId(chunk)).toBe("thread_abc123");
  });

  it("returns null for other events", () => {
    const chunk = '{"type":"turn.started"}\n';
    expect(extractCodexSessionId(chunk)).toBeNull();
  });

  it("returns null for empty chunk", () => {
    expect(extractCodexSessionId("")).toBeNull();
  });
});

describe("extractCodexTouchedEdits", () => {
  it("extracts paths from file_change items", () => {
    const chunk = JSON.stringify({
      type: "item.started",
      item: {
        id: "item_001",
        type: "file_change",
        changes: [
          { path: "src/main.rs", kind: "update" },
          { path: "src/new.rs", kind: "add" },
        ],
        status: "in_progress",
      },
    }) + "\n";
    expect(extractCodexTouchedEdits(chunk)).toEqual([
      { path: "src/main.rs" },
      { path: "src/new.rs" },
    ]);
  });

  it("ignores command_execution items", () => {
    const chunk = JSON.stringify({
      type: "item.started",
      item: { id: "i2", type: "command_execution", command: "ls" },
    }) + "\n";
    expect(extractCodexTouchedEdits(chunk)).toEqual([]);
  });

  it("handles item.completed with same structure", () => {
    const chunk = JSON.stringify({
      type: "item.completed",
      item: {
        id: "i3",
        type: "file_change",
        changes: [{ path: "a.ts", kind: "delete" }],
        status: "completed",
      },
    }) + "\n";
    expect(extractCodexTouchedEdits(chunk)).toEqual([{ path: "a.ts" }]);
  });
});

describe("extractCodexTouchedPaths", () => {
  it("returns just paths", () => {
    const chunk = JSON.stringify({
      type: "item.started",
      item: {
        type: "file_change",
        changes: [{ path: "x.py", kind: "update" }],
      },
    }) + "\n";
    expect(extractCodexTouchedPaths(chunk)).toEqual(["x.py"]);
  });
});

describe("extractCodexToolUses", () => {
  it("extracts command_execution as bash", () => {
    const chunk = JSON.stringify({
      type: "item.started",
      item: { type: "command_execution", command: "npm test" },
    }) + "\n";
    expect(extractCodexToolUses(chunk)).toEqual([
      { name: "bash", target: "npm test" },
    ]);
  });

  it("extracts file_change as apply_patch per path", () => {
    const chunk = JSON.stringify({
      type: "item.started",
      item: {
        type: "file_change",
        changes: [
          { path: "a.ts", kind: "update" },
          { path: "b.ts", kind: "add" },
        ],
      },
    }) + "\n";
    expect(extractCodexToolUses(chunk)).toEqual([
      { name: "apply_patch", target: "a.ts" },
      { name: "apply_patch", target: "b.ts" },
    ]);
  });

  it("extracts mcp_tool_call and web_search", () => {
    const chunk = [
      JSON.stringify({ type: "item.started", item: { type: "mcp_tool_call" } }),
      JSON.stringify({ type: "item.started", item: { type: "web_search" } }),
    ].join("\n") + "\n";
    expect(extractCodexToolUses(chunk)).toEqual([
      { name: "mcp_tool_call", target: undefined },
      { name: "web_search", target: undefined },
    ]);
  });

  it("skips agent_message and reasoning items", () => {
    const chunk = [
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "hello" } }),
      JSON.stringify({ type: "item.started", item: { type: "reasoning" } }),
    ].join("\n") + "\n";
    expect(extractCodexToolUses(chunk)).toEqual([]);
  });
});
