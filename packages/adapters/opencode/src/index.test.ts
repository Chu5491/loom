import { describe, it, expect } from "vitest";
import type { McpServer } from "@loom/core";
import {
  buildOpencodeCommand,
  opencodeAdapter,
  toOpencodeMcpEntry,
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

describe("buildOpencodeCommand", () => {
  it("defaults: opencode run", () => {
    const { command, args } = buildOpencodeCommand();
    expect(command).toBe("opencode");
    expect(args).toEqual(["run"]);
  });

  it("appends --model when configured", () => {
    const { args } = buildOpencodeCommand({ model: "anthropic/claude-sonnet-4-5" });
    expect(args[args.indexOf("--model") + 1]).toBe("anthropic/claude-sonnet-4-5");
  });

  it("--continue precedes other flags when continueSession=true", () => {
    const { args } = buildOpencodeCommand({ continueSession: true, model: "x" });
    expect(args).toEqual(["run", "--continue", "--model", "x"]);
  });

  it("appends --session when sessionId is given", () => {
    const { args } = buildOpencodeCommand({ sessionId: "sess-123" });
    expect(args[args.indexOf("--session") + 1]).toBe("sess-123");
  });

  it("appends --agent when configured", () => {
    const { args } = buildOpencodeCommand({ agent: "build" });
    expect(args[args.indexOf("--agent") + 1]).toBe("build");
  });

  it("respects command override", () => {
    expect(buildOpencodeCommand({ command: "/opt/opencode" }).command).toBe(
      "/opt/opencode",
    );
  });

  it("appends extraArgs", () => {
    const { args } = buildOpencodeCommand({ extraArgs: ["--foo"] });
    expect(args.slice(-1)).toEqual(["--foo"]);
  });
});

describe("opencodeAdapter", () => {
  it("identifies as opencode", () => {
    expect(opencodeAdapter.kind).toBe("opencode");
  });
});

describe("toOpencodeMcpEntry", () => {
  it("stdio: type=local, command is [bin, ...args] array, environment", () => {
    const entry = toOpencodeMcpEntry(
      makeServer({
        name: "github",
        kind: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_TOKEN: "ghp_xxx" },
      }),
    );
    expect(entry).toEqual({
      type: "local",
      // opencode requires command as a single array combining bin + args.
      command: ["npx", "-y", "@modelcontextprotocol/server-github"],
      environment: { GITHUB_TOKEN: "ghp_xxx" },
      enabled: true,
    });
  });

  it("stdio with no command falls back to args-only array (degraded but valid)", () => {
    const entry = toOpencodeMcpEntry(
      makeServer({
        name: "x",
        kind: "stdio",
        args: ["echo", "hi"],
      }),
    );
    expect(entry).toEqual({
      type: "local",
      command: ["echo", "hi"],
      enabled: true,
    });
  });

  it("HTTP: type=remote, url + headers", () => {
    const entry = toOpencodeMcpEntry(
      makeServer({
        name: "remote",
        kind: "http",
        url: "https://api.example.com/mcp",
        headers: { Authorization: "Bearer abc" },
      }),
    );
    expect(entry).toEqual({
      type: "remote",
      url: "https://api.example.com/mcp",
      headers: { Authorization: "Bearer abc" },
      enabled: true,
    });
  });

  it("SSE shares the remote shape (opencode has no separate SSE type)", () => {
    const entry = toOpencodeMcpEntry(
      makeServer({
        name: "stream",
        kind: "sse",
        url: "https://example.com/sse",
      }),
    );
    expect(entry).toEqual({
      type: "remote",
      url: "https://example.com/sse",
      enabled: true,
    });
  });

  it("empty env / headers are omitted (no `environment: {}` noise)", () => {
    const stdio = toOpencodeMcpEntry(
      makeServer({ name: "x", kind: "stdio", command: "x" }),
    );
    expect(stdio).not.toHaveProperty("environment");
    const remote = toOpencodeMcpEntry(
      makeServer({ name: "y", kind: "http", url: "https://y.com" }),
    );
    expect(remote).not.toHaveProperty("headers");
  });
});
