import { describe, it, expect } from "vitest";
import type { McpServer } from "@loom/core";
import {
  buildOpencodeCommand,
  opencodeAdapter,
  toOpencodeMcpEntry,
  mergeOpencodeMcp,
  extractOpencodeSessionId,
  extractOpencodeTouchedEdits,
  extractOpencodeTouchedPaths,
  extractOpencodeToolUses,
} from "./index.js";

function makeServer(
  over: Partial<McpServer> & Pick<McpServer, "kind" | "name">,
): McpServer {
  return {
    description: null,
    command: null,
    args: [],
    env: {},
    url: null,
    headers: {},
    ...over,
  };
}

describe("buildOpencodeCommand", () => {
  it("defaults: opencode run --format json", () => {
    const { command, args } = buildOpencodeCommand();
    expect(command).toBe("opencode");
    expect(args).toEqual(["run", "--format", "json"]);
  });

  it("appends --model when configured", () => {
    const { args } = buildOpencodeCommand({ model: "anthropic/claude-sonnet-4-5" });
    expect(args[args.indexOf("--model") + 1]).toBe("anthropic/claude-sonnet-4-5");
  });

  it("--continue precedes other flags when continueSession=true", () => {
    const { args } = buildOpencodeCommand({ continueSession: true, model: "x" });
    expect(args).toEqual(["run", "--format", "json", "--continue", "--model", "x"]);
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

describe("mergeOpencodeMcp", () => {
  const loom = makeServer({ name: "loom", kind: "http", url: "https://loom.local/mcp" });

  it("preserves the user's existing mcp servers and other config while adding loom's", () => {
    const user = {
      model: "anthropic/claude",
      mcp: { mine: { type: "local", command: ["my-mcp"] } },
    };
    const merged = mergeOpencodeMcp(user, [loom]) as {
      model: string;
      mcp: Record<string, unknown>;
    };
    expect(merged.mcp.mine).toBeDefined(); // 사용자 서버 보존
    expect(merged.mcp.loom).toBeDefined(); // loom 서버 추가
    expect(merged.model).toBe("anthropic/claude"); // 다른 설정 보존
  });

  it("starts from empty when the user has no mcp field", () => {
    const merged = mergeOpencodeMcp({ model: "x" }, [loom]) as { mcp: Record<string, unknown> };
    expect(Object.keys(merged.mcp)).toEqual(["loom"]);
  });

  it("loom wins on name conflict and does not mutate the input", () => {
    const user = { mcp: { loom: { type: "local", command: ["stale"] } } };
    const merged = mergeOpencodeMcp(user, [loom]) as { mcp: Record<string, { type: string }> };
    expect(merged.mcp.loom?.type).toBe("remote"); // 우리 항목으로 교체
    expect((user.mcp.loom as { command: string[] }).command).toEqual(["stale"]); // 입력 불변
  });
});

describe("extractOpencodeSessionId", () => {
  it("extracts sessionID from any event", () => {
    const chunk = '{"type":"text","timestamp":1700000000,"sessionID":"ses_abc123","part":{"text":"hi"}}\n';
    expect(extractOpencodeSessionId(chunk)).toBe("ses_abc123");
  });

  it("returns null for empty chunk", () => {
    expect(extractOpencodeSessionId("")).toBeNull();
  });

  it("returns null for event without sessionID", () => {
    expect(extractOpencodeSessionId('{"type":"error"}\n')).toBeNull();
  });
});

describe("extractOpencodeTouchedEdits", () => {
  it("extracts edit tool with oldString target", () => {
    const chunk = JSON.stringify({
      type: "tool_use",
      timestamp: 1700000000,
      sessionID: "ses_1",
      part: {
        tool: "edit",
        state: {
          status: "completed",
          input: { filePath: "src/index.ts", oldString: "foo", newString: "bar" },
        },
      },
    }) + "\n";
    expect(extractOpencodeTouchedEdits(chunk)).toEqual([
      { path: "src/index.ts", target: "foo" },
    ]);
  });

  it("extracts write tool without target", () => {
    const chunk = JSON.stringify({
      type: "tool_use",
      sessionID: "ses_1",
      part: {
        tool: "write",
        state: { status: "completed", input: { filePath: "new.ts", content: "x" } },
      },
    }) + "\n";
    expect(extractOpencodeTouchedEdits(chunk)).toEqual([
      { path: "new.ts", target: undefined },
    ]);
  });

  it("ignores read and bash tools", () => {
    const chunk = [
      JSON.stringify({ type: "tool_use", sessionID: "s", part: { tool: "read", state: { input: { filePath: "a.ts" } } } }),
      JSON.stringify({ type: "tool_use", sessionID: "s", part: { tool: "bash", state: { input: { command: "ls" } } } }),
    ].join("\n") + "\n";
    expect(extractOpencodeTouchedEdits(chunk)).toEqual([]);
  });
});

describe("extractOpencodeTouchedPaths", () => {
  it("returns just paths", () => {
    const chunk = JSON.stringify({
      type: "tool_use",
      sessionID: "s",
      part: { tool: "edit", state: { input: { filePath: "x.ts", oldString: "a" } } },
    }) + "\n";
    expect(extractOpencodeTouchedPaths(chunk)).toEqual(["x.ts"]);
  });
});

describe("extractOpencodeToolUses", () => {
  it("extracts tool uses with summarised target", () => {
    const chunk = [
      JSON.stringify({ type: "tool_use", sessionID: "s", part: { tool: "read", state: { input: { filePath: "a.ts" } } } }),
      JSON.stringify({ type: "tool_use", sessionID: "s", part: { tool: "bash", state: { input: { command: "npm test" } } } }),
      JSON.stringify({ type: "tool_use", sessionID: "s", part: { tool: "grep", state: { input: { pattern: "TODO" } } } }),
      JSON.stringify({ type: "tool_use", sessionID: "s", part: { tool: "websearch", state: { input: { query: "vitest docs" } } } }),
    ].join("\n") + "\n";
    expect(extractOpencodeToolUses(chunk)).toEqual([
      { name: "read", target: "a.ts" },
      { name: "bash", target: "npm test" },
      { name: "grep", target: "TODO" },
      { name: "websearch", target: "vitest docs" },
    ]);
  });

  it("skips non tool_use events", () => {
    const chunk = [
      JSON.stringify({ type: "text", sessionID: "s", part: { text: "hello" } }),
      JSON.stringify({ type: "step_start", sessionID: "s", part: {} }),
    ].join("\n") + "\n";
    expect(extractOpencodeToolUses(chunk)).toEqual([]);
  });
});
