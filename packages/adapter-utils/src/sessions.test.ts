import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findSessionPaths } from "./sessions.js";

describe("findSessionPaths", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-sess-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("finds a file whose name contains the session id, ignoring others", () => {
    const id = "019a7117-4922-71c1";
    fs.writeFileSync(path.join(root, `rollout-2025-${id}.jsonl`), "x");
    fs.writeFileSync(path.join(root, "unrelated.jsonl"), "x");
    expect(findSessionPaths(root, id)).toEqual([path.join(root, `rollout-2025-${id}.jsonl`)]);
  });

  it("finds nested files across date dirs (codex Y/M/D layout)", () => {
    const id = "ses_abc";
    const deep = path.join(root, "2025", "11", "11");
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(deep, `rollout-${id}.jsonl`), "x");
    expect(findSessionPaths(root, id)).toEqual([path.join(deep, `rollout-${id}.jsonl`)]);
  });

  it("returns a matched directory whole without descending (opencode message/<id>/)", () => {
    const id = "ses_xyz";
    const msgDir = path.join(root, "message", id);
    fs.mkdirSync(msgDir, { recursive: true });
    fs.writeFileSync(path.join(msgDir, "msg_1.json"), "x");
    fs.mkdirSync(path.join(root, "todo"), { recursive: true });
    fs.writeFileSync(path.join(root, "todo", `${id}.json`), "x");
    const out = findSessionPaths(root, id);
    expect(out).toContain(msgDir); // 디렉토리 통째
    expect(out).toContain(path.join(root, "todo", `${id}.json`));
    expect(out).not.toContain(path.join(msgDir, "msg_1.json")); // 매치 디렉토리 안으론 안 내려감
  });

  it("returns [] for empty id or missing root", () => {
    expect(findSessionPaths(root, "")).toEqual([]);
    expect(findSessionPaths(path.join(root, "nope"), "x")).toEqual([]);
  });
});
