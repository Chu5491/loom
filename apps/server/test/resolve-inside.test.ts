// resolveInside — prefix 탈출과 심볼릭 링크 탈출을 모두 막는지.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveInside } from "../src/routes/project-files.js";

let root: string;
let outside: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-proj-"));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "loom-outside-"));
  fs.writeFileSync(path.join(root, "ok.txt"), "fine");
  fs.writeFileSync(path.join(outside, "secret.txt"), "leak");
  fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "evil-link"));
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe("resolveInside", () => {
  it("allows normal files inside the project", () => {
    expect(resolveInside(root, "ok.txt")).toBe(path.join(root, "ok.txt"));
  });

  it("rejects ../ traversal", () => {
    expect(() => resolveInside(root, "../escape.txt")).toThrow(/escapes project/);
  });

  it("rejects symlinks pointing outside the project", () => {
    expect(() => resolveInside(root, "evil-link")).toThrow(/symlink escapes project/);
  });

  it("allows not-yet-existing paths (new file writes)", () => {
    expect(resolveInside(root, "new/dir/file.txt")).toBe(path.join(root, "new/dir/file.txt"));
  });
});
