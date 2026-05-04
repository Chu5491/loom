// Each CLI's MCP JSON dialect verified against its own docs:
//   - claude-code  ~/.claude/.mcp.json   (type: "stdio" | "http" | "sse")
//   - gemini       ~/.gemini/settings.json
//                  (no `type`; httpUrl for HTTP, url for SSE — DIFFERENT keys)
//   - codex        ~/.codex/config.toml  (covered in adapter test)
//   - opencode     opencode.json         (covered in adapter test)
//
// Every converter has its own "stdio + http + sse + empty" suite so a future
// CLI doc revision that flips a key (e.g. httpUrl → url) breaks here loudly.

import { describe, it, expect } from "vitest";
import type { McpServer } from "@loom/core";
import { toGeminiMcpEntry } from "../src/services/gemini-sync.js";
import { toClaudeMcpEntry } from "../src/services/run/agent-loadout.js";

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

describe("toClaudeMcpEntry — claude-code .mcp.json shape", () => {
  it("stdio: type=stdio + command/args/env", () => {
    expect(
      toClaudeMcpEntry(
        makeServer({
          name: "github",
          kind: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_TOKEN: "ghp_xxx" },
        }),
      ),
    ).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: "ghp_xxx" },
    });
  });

  it("HTTP: type=http + url + headers", () => {
    expect(
      toClaudeMcpEntry(
        makeServer({
          name: "remote",
          kind: "http",
          url: "https://api.example.com/mcp",
          headers: { Authorization: "Bearer abc" },
        }),
      ),
    ).toEqual({
      type: "http",
      url: "https://api.example.com/mcp",
      headers: { Authorization: "Bearer abc" },
    });
  });

  it("SSE: type=sse + url + headers (same shape as HTTP, different `type`)", () => {
    expect(
      toClaudeMcpEntry(
        makeServer({
          name: "stream",
          kind: "sse",
          url: "https://example.com/sse",
          headers: {},
        }),
      ),
    ).toEqual({
      type: "sse",
      url: "https://example.com/sse",
    });
  });

  it("empty args still serialized (claude expects a list); empty env omitted", () => {
    const e = toClaudeMcpEntry(
      makeServer({ name: "x", kind: "stdio", command: "x" }),
    );
    expect(e.args).toEqual([]);
    expect(e).not.toHaveProperty("env");
  });
});

describe("toGeminiMcpEntry — gemini settings.json shape", () => {
  it("stdio: bare command/args/env, no `type` field", () => {
    const e = toGeminiMcpEntry(
      makeServer({
        name: "github",
        kind: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_TOKEN: "ghp_xxx" },
      }),
    );
    expect(e).toEqual({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: "ghp_xxx" },
    });
    // gemini는 `type`을 보지 않음 — transport는 어떤 키가 있느냐로 추론.
    expect(e).not.toHaveProperty("type");
  });

  it("HTTP: uses `httpUrl` (NOT `url`) and `headers`", () => {
    const e = toGeminiMcpEntry(
      makeServer({
        name: "remote",
        kind: "http",
        url: "https://api.example.com/mcp",
        headers: { Authorization: "Bearer abc" },
      }),
    );
    expect(e).toEqual({
      httpUrl: "https://api.example.com/mcp",
      headers: { Authorization: "Bearer abc" },
    });
    expect(e).not.toHaveProperty("url"); // HTTP는 url이 아님
  });

  it("SSE: uses `url` (NOT `httpUrl`) — different from HTTP transport", () => {
    const e = toGeminiMcpEntry(
      makeServer({
        name: "stream",
        kind: "sse",
        url: "https://example.com/sse",
        headers: { Authorization: "Bearer t" },
      }),
    );
    // SSE는 httpUrl이 아니라 url. gemini docs 명시.
    expect(e).toEqual({
      url: "https://example.com/sse",
      headers: { Authorization: "Bearer t" },
    });
    expect(e).not.toHaveProperty("httpUrl");
  });

  it("empty args / env / headers are omitted (no `args: []` noise)", () => {
    const stdio = toGeminiMcpEntry(
      makeServer({ name: "x", kind: "stdio", command: "x" }),
    );
    expect(stdio).not.toHaveProperty("args");
    expect(stdio).not.toHaveProperty("env");
    const http = toGeminiMcpEntry(
      makeServer({ name: "y", kind: "http", url: "https://y.com" }),
    );
    expect(http).not.toHaveProperty("headers");
  });
});
