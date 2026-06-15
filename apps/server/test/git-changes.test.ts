import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gitFilesTouchedSince } from "../src/run/git-changes.js";

const tmps: string[] = [];
function tmpRepo(init: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-changes-"));
  tmps.push(dir);
  if (init) execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}
afterEach(() => {
  for (const d of tmps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("gitFilesTouchedSince", () => {
  it("returns null/empty for a non-git directory", () => {
    expect(gitFilesTouchedSince(tmpRepo(false), 0)).toEqual([]);
  });

  it("reports an untracked new file as a 'write'", () => {
    const dir = tmpRepo(true);
    fs.writeFileSync(path.join(dir, "a.txt"), "hello");
    const touched = gitFilesTouchedSince(dir, 0);
    expect(touched).toEqual([{ path: "a.txt", action: "write" }]);
  });

  it("excludes files whose mtime predates `since`", () => {
    const dir = tmpRepo(true);
    fs.writeFileSync(path.join(dir, "a.txt"), "hello");
    // since 를 한참 미래로 — 파일 mtime 이 그보다 과거라 이 run 소행 아님.
    expect(gitFilesTouchedSince(dir, Date.now() + 100_000)).toEqual([]);
  });

  it("reports a modified tracked file as an 'edit'", () => {
    const dir = tmpRepo(true);
    fs.writeFileSync(path.join(dir, "a.txt"), "v1");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: dir });
    fs.writeFileSync(path.join(dir, "a.txt"), "v2"); // 추적 파일 수정
    expect(gitFilesTouchedSince(dir, 0)).toEqual([{ path: "a.txt", action: "edit" }]);
  });
});
