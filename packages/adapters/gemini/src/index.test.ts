import { describe, it, expect } from "vitest";
import { buildGeminiCommand, geminiAdapter } from "./index.js";

describe("buildGeminiCommand", () => {
  it("defaults: gemini --output-format stream-json", () => {
    const { command, args } = buildGeminiCommand();
    expect(command).toBe("gemini");
    expect(args).toEqual(["--output-format", "stream-json"]);
  });

  it("appends --model when configured", () => {
    const { args } = buildGeminiCommand({ model: "gemini-2.5-pro" });
    expect(args[args.indexOf("--model") + 1]).toBe("gemini-2.5-pro");
  });

  it("appends --approval-mode yolo only when yolo=true", () => {
    expect(buildGeminiCommand().args).not.toContain("--approval-mode");
    expect(buildGeminiCommand({ yolo: true }).args).toEqual([
      "--output-format",
      "stream-json",
      "--approval-mode",
      "yolo",
    ]);
  });

  it("respects sandbox toggle", () => {
    expect(buildGeminiCommand({ sandbox: true }).args).toContain("--sandbox");
    expect(buildGeminiCommand({ sandbox: false }).args).toContain("--sandbox=none");
    expect(buildGeminiCommand().args).not.toContain("--sandbox");
    expect(buildGeminiCommand().args).not.toContain("--sandbox=none");
  });

  it("appends extraArgs at the end", () => {
    const { args } = buildGeminiCommand({ extraArgs: ["--debug"] });
    expect(args.slice(-1)).toEqual(["--debug"]);
  });

  it("respects command override", () => {
    expect(buildGeminiCommand({ command: "gemini-cli" }).command).toBe("gemini-cli");
  });
});

describe("geminiAdapter", () => {
  it("identifies as gemini", () => {
    expect(geminiAdapter.kind).toBe("gemini");
  });
});
