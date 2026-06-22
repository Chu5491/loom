import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { applyPrompt } from "@loom/adapter-utils";
import {
  buildDevinCommand,
  captureDevinSession,
  captureDevinActivity,
  parseDevinActivity,
  devinAdapter,
  toDevinMcpEntry,
  syncDevinMcpConfig,
  DEVIN_EXPORT_REL,
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

  it("writes isolation (read_config_from:false) even with no servers — 헌법2 자동흡수 차단", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devin-mcp-"));
    const file = syncDevinMcpConfig(tmp, []);
    expect(file).toBe(path.join(tmp, ".devin", "config.local.json"));
    const out = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(out.mcpServers).toEqual({});
    expect(out.read_config_from).toEqual({ cursor: false, windsurf: false, claude: false, opencode: false, vscode: false, zed: false });
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("respects a user-supplied read_config_from instead of overwriting it", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devin-mcp-"));
    const file = path.join(tmp, ".devin", "config.local.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ read_config_from: { cursor: true, windsurf: true, claude: true } }));
    syncDevinMcpConfig(tmp, [CANARY]);
    const out = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(out.read_config_from).toEqual({ cursor: true, windsurf: true, claude: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe("buildDevinCommand", () => {
  it("defaults: devin with just --export (for token capture)", () => {
    const { command, args } = buildDevinCommand();
    expect(command).toBe("devin");
    expect(args).toEqual(["--export", DEVIN_EXPORT_REL]);
  });

  it("adds --model when set", () => {
    expect(buildDevinCommand({ model: "claude-opus-4.6" }).args).toEqual([
      "--model",
      "claude-opus-4.6",
      "--export",
      DEVIN_EXPORT_REL,
    ]);
  });

  it("maps dangerouslySkipPermissions to --permission-mode dangerous", () => {
    expect(buildDevinCommand({ dangerouslySkipPermissions: true }).args).toEqual([
      "--permission-mode",
      "dangerous",
      "--export",
      DEVIN_EXPORT_REL,
    ]);
    expect(buildDevinCommand().args).not.toContain("--permission-mode");
  });

  it("appends extraArgs after --export", () => {
    expect(buildDevinCommand({ extraArgs: ["--sandbox"] }).args).toEqual([
      "--export",
      DEVIN_EXPORT_REL,
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
    expect(args).toEqual(["--model", "opus", "--export", DEVIN_EXPORT_REL, "--print", "fix the login bug"]);
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

describe("buildDevinCommand --export (token capture)", () => {
  it("always appends --export to a cwd-local file", () => {
    const { args } = buildDevinCommand();
    const i = args.indexOf("--export");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe(DEVIN_EXPORT_REL);
  });
});

describe("parseDevinActivity", () => {
  it("sums tokens and collects tool calls from steps", () => {
    const data = { steps: [
      { metadata: { num_tokens: null } },
      { tool_calls: [{ function_name: "find_file_by_name", arguments: { pattern: "math.js" } }] },
      { tool_calls: [{ function_name: "read", arguments: { file_path: "/p/math.js" } }] },
      { metadata: { metrics: { input_tokens: 2555, output_tokens: 103, cache_read_tokens: 11968 } } },
    ] };
    expect(parseDevinActivity(data)).toEqual({
      inputTokens: 2555,
      outputTokens: 103,
      cachedInputTokens: 11968,
      tools: [
        { name: "find_file_by_name", target: "math.js" },
        { name: "read", target: "/p/math.js" },
      ],
    });
  });

  it("returns tools even when no token metrics are present", () => {
    expect(parseDevinActivity({ steps: [{ tool_calls: [{ function_name: "bash", arguments: { command: "ls" } }] }] }))
      .toEqual({ tools: [{ name: "bash", target: "ls" }] });
  });

  it("reads tokens from final_metrics (ATIF v1.7) where steps carry no metadata", () => {
    const data = {
      final_metrics: { total_prompt_tokens: 14341, total_completion_tokens: 28, total_cached_tokens: 2560 },
      steps: [{ step_id: "s1", source: "agent", message: "OK" }],
    };
    expect(parseDevinActivity(data)).toEqual({ inputTokens: 14341, outputTokens: 28, cachedInputTokens: 2560 });
  });

  it("final_metrics (v1.7) wins over per-step metrics — no double count", () => {
    const data = {
      final_metrics: { total_prompt_tokens: 100, total_completion_tokens: 10 },
      steps: [{ metadata: { metrics: { input_tokens: 999, output_tokens: 999 } } }],
    };
    expect(parseDevinActivity(data)).toEqual({ inputTokens: 100, outputTokens: 10 });
  });

  it("returns null when nothing usable is present", () => {
    expect(parseDevinActivity({ steps: [{ metadata: {} }] })).toBeNull();
    expect(parseDevinActivity({})).toBeNull();
  });

  // changelog 가 적은 신 필드명(total_input_tokens/output_tokens/cache_read_tokens) — 설치본
  // 실 export 엔 안 나오지만 방어적 별칭이 잡는지 확인(미래/다른 빌드 대비).
  it("reads the changelog field-name aliases (total_input_tokens/output_tokens/cache_read_tokens)", () => {
    const data = { final_metrics: { total_input_tokens: 500, output_tokens: 50, cache_read_tokens: 200 } };
    expect(parseDevinActivity(data)).toEqual({ inputTokens: 500, outputTokens: 50, cachedInputTokens: 200 });
  });

  // 설치본 실측 스키마(2026.7.23): final_metrics 집계(total_prompt/completion/cached_tokens).
  // cost 필드는 없음 — 토큰·캐시만.
  it("reads the real installed-build schema (final_metrics total_*_tokens, no cost)", () => {
    const data = {
      final_metrics: { total_prompt_tokens: 14731, total_completion_tokens: 44, total_cached_tokens: 2432 },
      steps: [{ step_id: "s1", source: "agent", message: "PONG", metrics: { prompt_tokens: 14731, completion_tokens: 44, cached_tokens: 2432 } }],
    };
    expect(parseDevinActivity(data)).toEqual({ inputTokens: 14731, outputTokens: 44, cachedInputTokens: 2432 });
  });

  // 집계가 없으면 steps[].metrics(prompt/completion/cached_tokens)를 합산.
  it("sums step-level prompt/completion/cached_tokens when no final_metrics", () => {
    const data = { steps: [
      { metrics: { prompt_tokens: 30, completion_tokens: 3, cached_tokens: 5 } },
      { metrics: { prompt_tokens: 40, completion_tokens: 4, cached_tokens: 6 } },
    ] };
    expect(parseDevinActivity(data)).toEqual({ inputTokens: 70, outputTokens: 7, cachedInputTokens: 11 });
  });
});

describe("captureDevinActivity", () => {
  it("reads activity from a fresh export, then cleans the file up", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "devin-exp-"));
    const file = path.join(cwd, DEVIN_EXPORT_REL);
    fs.writeFileSync(file, JSON.stringify({ steps: [
      { tool_calls: [{ function_name: "read", arguments: { file_path: "/p/x.js" } }] },
      { metadata: { metrics: { input_tokens: 10, output_tokens: 4 } } },
    ] }));
    const mtime = fs.statSync(file).mtimeMs;
    expect(await captureDevinActivity({ cwd, since: mtime - 1000 })).toEqual({
      inputTokens: 10, outputTokens: 4, tools: [{ name: "read", target: "/p/x.js" }],
    });
    expect(fs.existsSync(file)).toBe(false); // 읽었으면 정리
  });

  it("ignores a stale export (older than this run) without deleting it", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "devin-stale-"));
    const file = path.join(cwd, DEVIN_EXPORT_REL);
    fs.writeFileSync(file, JSON.stringify({ steps: [{ metadata: { metrics: { input_tokens: 10 } } }] }));
    const mtime = fs.statSync(file).mtimeMs;
    expect(await captureDevinActivity({ cwd, since: mtime + 60_000 })).toBeNull();
    expect(fs.existsSync(file)).toBe(true); // 잔재(우리 것 아님)는 안 지운다
  });

  it("returns null when the export is absent", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "devin-noexp-"));
    expect(await captureDevinActivity({ cwd, since: 0 })).toBeNull();
  });

  it("keeps a corrupt/partial export instead of deleting it (no silent data loss)", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "devin-corrupt-"));
    const file = path.join(cwd, DEVIN_EXPORT_REL);
    fs.writeFileSync(file, "{ partial json — interrupted mid-write");
    const mtime = fs.statSync(file).mtimeMs;
    expect(await captureDevinActivity({ cwd, since: mtime - 1000 })).toBeNull();
    expect(fs.existsSync(file)).toBe(true); // 다음 run 이 덮어쓴다 — 검사 여지 보존
  });
});

describe("devinAdapter wiring", () => {
  it("exposes captureActivityFromDisk", () => {
    expect(typeof devinAdapter.captureActivityFromDisk).toBe("function");
  });
});
