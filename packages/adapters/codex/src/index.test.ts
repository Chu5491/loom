import { describe, it, expect } from "vitest";
import type { McpServer } from "@loom/core";
import {
  buildCodexCommand,
  codexAdapter,
  toCodexMcpOverrides,
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
