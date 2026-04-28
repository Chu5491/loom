import { describe, it, expect } from "vitest";
import { buildOpencodeCommand, opencodeAdapter } from "./index.js";

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
