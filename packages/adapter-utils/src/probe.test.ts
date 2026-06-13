import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { jsonObjectHasKeys } from "./probe.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "probe-test-"));
const write = (name: string, body: string) => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, body);
  return p;
};

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("jsonObjectHasKeys", () => {
  it("is false for an empty object — opencode logged-out auth.json is `{}`", () => {
    expect(jsonObjectHasKeys(write("empty.json", "{}"))).toBe(false);
  });

  it("is true when the object has at least one provider key", () => {
    expect(jsonObjectHasKeys(write("auth.json", '{"anthropic":{"type":"oauth"}}'))).toBe(true);
  });

  it("is false for a missing file", () => {
    expect(jsonObjectHasKeys(path.join(tmp, "nope.json"))).toBe(false);
  });

  it("is false for malformed/half-written JSON", () => {
    expect(jsonObjectHasKeys(write("bad.json", '{"anthropic":'))).toBe(false);
  });

  it("is false for non-object JSON (array, string)", () => {
    expect(jsonObjectHasKeys(write("arr.json", "[1,2]"))).toBe(false);
    expect(jsonObjectHasKeys(write("str.json", '"hi"'))).toBe(false);
  });
});
