import { describe, it, expect } from "vitest";
import type { McpServer } from "@loom/core";
import {
  buildCodexCommand,
  codexAdapter,
  resumeCodexArgs,
  toCodexMcpOverrides,
  extractCodexSessionId,
  extractCodexTouchedEdits,
  extractCodexTouchedPaths,
  extractCodexToolUses,
  filterOpenAiModels,
} from "./index.js";

describe("filterOpenAiModels (OpenAI /v1/models → coding models)", () => {
  it("keeps gpt / o-series / codex and drops media + embedding models", () => {
    const out = filterOpenAiModels([
      { id: "gpt-5.1" },
      { id: "o3" },
      { id: "codex-mini-latest" },
      { id: "text-embedding-3-large" },
      { id: "gpt-4o-audio-preview" },
      { id: "dall-e-3" },
      { id: "whisper-1" },
      { id: "tts-1" },
    ]);
    const values = out.map((m) => m.value);
    expect(values).toContain("gpt-5.1");
    expect(values).toContain("o3");
    expect(values).toContain("codex-mini-latest");
    expect(values).not.toContain("text-embedding-3-large");
    expect(values).not.toContain("gpt-4o-audio-preview");
    expect(values).not.toContain("dall-e-3");
    expect(values).not.toContain("whisper-1");
    expect(values).not.toContain("tts-1");
  });

  it("tags o-series as Reasoning and codex as Codex", () => {
    const out = filterOpenAiModels([{ id: "o4-mini" }, { id: "codex-mini-latest" }]);
    const byId = new Map(out.map((m) => [m.value, m.category]));
    expect(byId.get("o4-mini")).toBe("Reasoning (o-series)");
    expect(byId.get("codex-mini-latest")).toBe("Codex");
  });
});

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

describe("buildCodexCommand", () => {
  it("defaults: codex exec --json + 격리 + --sandbox workspace-write -", () => {
    const { command, args } = buildCodexCommand();
    expect(command).toBe("codex");
    // 기본: 사용자 전역 config·rules 격리(--ignore-user-config --ignore-rules) +
    // 비-bypass 샌드박스 등급(read-only 면 편집이 막혀 코딩이 조용히 실패).
    expect(args).toEqual([
      "exec", "--json", "--ignore-user-config", "--ignore-rules",
      "--sandbox", "workspace-write", "-",
    ]);
  });

  it("isolateUserConfig=false 면 격리 플래그를 빼고 사용자 전역 설정을 쓴다", () => {
    const { args } = buildCodexCommand({ isolateUserConfig: false });
    expect(args).not.toContain("--ignore-user-config");
    expect(args).not.toContain("--ignore-rules");
  });

  it("non-bypass uses --sandbox; bypass uses the bypass flag instead (no --sandbox)", () => {
    expect(buildCodexCommand({ sandboxMode: "read-only" }).args).toContain("read-only");
    const bypass = buildCodexCommand({ dangerouslySkipPermissions: true }).args;
    expect(bypass).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(bypass).not.toContain("--sandbox");
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

  it("puts --search before exec — root-level flag, exec rejects it", () => {
    const { args } = buildCodexCommand({ search: true });
    expect(args.indexOf("--search")).toBeLessThan(args.indexOf("exec"));
  });

  it("inserts bypass flag only when enabled", () => {
    expect(buildCodexCommand().args).not.toContain(
      "--dangerously-bypass-approvals-and-sandbox",
    );
    expect(
      buildCodexCommand({ dangerouslyBypassApprovalsAndSandbox: true }).args,
    ).toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("honours the engine-wide dangerouslySkipPermissions toggle", () => {
    expect(
      buildCodexCommand({ dangerouslySkipPermissions: true }).args,
    ).toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("appends --cd when configured", () => {
    const { args } = buildCodexCommand({ cd: "/repo" });
    expect(args[args.indexOf("--cd") + 1]).toBe("/repo");
  });

  it("adds --ephemeral only when set (non-resume runs)", () => {
    expect(buildCodexCommand().args).not.toContain("--ephemeral");
    expect(buildCodexCommand({ ephemeral: true }).args).toContain("--ephemeral");
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

  it("resumes via `exec resume <id>` subcommand, keeping --json and trailing stdin", () => {
    const base = buildCodexCommand({ model: "gpt-5.4-mini" }).args;
    const resumed = resumeCodexArgs(base, "sess-123");
    const i = resumed.indexOf("exec");
    expect(resumed[i + 1]).toBe("resume");
    expect(resumed[i + 2]).toBe("sess-123");
    expect(resumed).toContain("--json");
    expect(resumed[resumed.length - 1]).toBe("-"); // stdin 마커 유지
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
    // 일반 서버엔 타임아웃 미부여 — 행 시 codex 기본으로 fail-fast
    expect(flags).not.toContain("mcp_servers.github.tool_timeout_sec=900");
  });

  it("gives the loom delegate server a long tool timeout (10min+ delegations)", () => {
    const flags = toCodexMcpOverrides(makeServer({ name: "loom", kind: "http", url: "http://x/api/mcp" }));
    expect(flags).toContain("mcp_servers.loom.tool_timeout_sec=900");
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
