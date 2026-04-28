import { describe, it, expect } from "vitest";
import { applyPrompt } from "./define.js";

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
