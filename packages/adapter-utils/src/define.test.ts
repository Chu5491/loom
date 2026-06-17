import { describe, it, expect } from "vitest";
import type { AdapterConfig } from "@loom/core";
import { applyPrompt, defineCliAdapter } from "./define.js";

describe("applyPrompt", () => {
  it("stdin mode: args untouched, stdin = prompt", () => {
    const { args, stdin } = applyPrompt(["--print", "-"], "hello", { via: "stdin" });
    expect(args).toEqual(["--print", "-"]);
    expect(stdin).toBe("hello");
  });

  it("arg mode: prompt appended as last positional arg, stdin empty", () => {
    const { args, stdin } = applyPrompt(["run"], "do thing", { via: "arg" });
    expect(args).toEqual(["run", "do thing"]);
    expect(stdin).toBe("");
  });

  it("arg-flag mode: prompt appended as flag pair, stdin empty", () => {
    const { args, stdin } = applyPrompt(["--model", "x"], "hi", {
      via: "arg",
      flag: "--prompt",
    });
    expect(args).toEqual(["--model", "x", "--prompt", "hi"]);
    expect(stdin).toBe("");
  });

  it("does not mutate the input args array", () => {
    const base = ["--model", "x"];
    applyPrompt(base, "p", { via: "arg" });
    applyPrompt(base, "p", { via: "arg", flag: "--prompt" });
    expect(base).toEqual(["--model", "x"]);
  });
});

// 시스템 프롬프트 채널 — /bin/echo 로 실제 argv 를 stdout 으로 받아 조립 순서를 검증.
// echo 가 prompt 도 같이 찍게 prompt:{via:"arg"} 로 둔다.
describe("defineCliAdapter system-prompt arg assembly", () => {
  const echoSys = defineCliAdapter({
    kind: "claude-code",
    buildCommand: () => ({ command: "/bin/echo", args: ["BASE"] }),
    prompt: { via: "arg" },
    supportsSystemPrompt: true,
    applySystemPrompt: (args, sys) => [...args, "--sys", sys],
  });

  async function runEcho(spawnArgs: { prompt: string; systemPrompt?: string }) {
    const out: string[] = [];
    const handle = await echoSys.spawn(
      {
        ...spawnArgs,
        cwd: process.cwd(),
        env: {},
        onStdout: (c) => out.push(c),
        onStderr: () => {},
      },
      {} as AdapterConfig,
    );
    await handle.promise;
    return out.join("").trim();
  }

  it("inserts the system flag before the prompt when systemPrompt is set", async () => {
    expect(await runEcho({ prompt: "USERP", systemPrompt: "SYSTEXT" })).toBe("BASE --sys SYSTEXT USERP");
  });

  it("omits the system flag entirely when systemPrompt is absent", async () => {
    expect(await runEcho({ prompt: "USERP" })).toBe("BASE USERP");
  });

  it("omits the system flag when systemPrompt is an empty string", async () => {
    expect(await runEcho({ prompt: "USERP", systemPrompt: "" })).toBe("BASE USERP");
  });

  it("defaults supportsSystemPrompt to false for adapters that don't opt in", () => {
    const plain = defineCliAdapter({
      kind: "codex",
      buildCommand: () => ({ command: "/bin/echo", args: [] }),
    });
    expect(plain.supportsSystemPrompt).toBe(false);
  });
});

// config.ephemeral(비-스레드 run)을 applyMcpServers 로 전달 — opencode 세션 격리용.
describe("defineCliAdapter ephemeral passthrough", () => {
  async function spawnCapturingEphemeral(config: AdapterConfig) {
    let received: boolean | undefined;
    const ad = defineCliAdapter({
      kind: "opencode",
      buildCommand: () => ({ command: "/bin/echo", args: ["x"] }),
      applyMcpServers: (input) => {
        received = input.ephemeral;
        return { args: input.args };
      },
    });
    const h = await ad.spawn(
      { prompt: "p", cwd: process.cwd(), env: {}, loadoutDir: "/tmp/loom-eph-test", onStdout() {}, onStderr() {} },
      config,
    );
    await h.promise;
    return received;
  }

  it("passes ephemeral=true when config.ephemeral is set", async () => {
    expect(await spawnCapturingEphemeral({ ephemeral: true } as AdapterConfig)).toBe(true);
  });

  it("passes ephemeral=false when config omits it", async () => {
    expect(await spawnCapturingEphemeral({} as AdapterConfig)).toBe(false);
  });
});
