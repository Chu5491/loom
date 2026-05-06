// services/git.ts 의 명령어가 실제 `git` CLI 와 호환되는지 확인. unit 이라기보단
// 통합 테스트 — 임시 저장소를 만들고 실제 git binary 와 대화해서 인자 조합이
// 깨지지 않았는지 (예: --no-patch + --name-status 충돌) 검출.

import { execFile as execFileCb } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, beforeAll, afterAll, it, expect } from "vitest";
import {
  getCommitInfo,
  getCommitFileDiff,
  listBranches,
  pull as gitPullOp,
  push as gitPushOp,
  GitCommandError,
} from "../src/services/git.js";

const execFile = promisify(execFileCb);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFile("git", args, {
    cwd,
    env: {
      ...process.env,
      // 안정된 author — sha 가 결정적으로 나오진 않더라도 출력은 일관.
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
    },
  });
}

let repoDir = "";
let firstSha = "";
let secondSha = "";

describe("git service — real-binary integration", () => {
  beforeAll(async () => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-git-test-"));
    await git(repoDir, ["init", "-q", "-b", "main"]);
    await git(repoDir, ["config", "user.name", "Test"]);
    await git(repoDir, ["config", "user.email", "test@example.com"]);

    fs.writeFileSync(path.join(repoDir, "a.txt"), "alpha\n");
    await git(repoDir, ["add", "a.txt"]);
    await git(repoDir, ["commit", "-q", "-m", "first"]);
    firstSha = (
      await execFile("git", ["rev-parse", "HEAD"], { cwd: repoDir })
    ).stdout.trim();

    fs.writeFileSync(path.join(repoDir, "a.txt"), "alpha\nbeta\n");
    fs.writeFileSync(path.join(repoDir, "b.txt"), "new\n");
    await git(repoDir, ["add", "."]);
    await git(repoDir, [
      "commit",
      "-q",
      "-m",
      "second\n\nbody line one\nbody line two",
    ]);
    secondSha = (
      await execFile("git", ["rev-parse", "HEAD"], { cwd: repoDir })
    ).stdout.trim();
  });

  afterAll(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it("getCommitInfo: parses header + name-status (no flag conflict)", async () => {
    // git 2.45+ 는 `--no-patch` + `--name-status` 동시 사용을 거부 — 이전엔 그
    // 조합으로 명령어를 만들어 prod 에서 500 났음. `--name-status` 만으로 patch
    // 없이 잘 동작해야 함.
    const info = await getCommitInfo(repoDir, secondSha);
    expect(info.subject).toBe("second");
    expect(info.body.trim()).toBe("body line one\nbody line two");
    expect(info.parents).toEqual([firstSha]);
    expect(info.authorName).toBe("Test");
    // a.txt 는 modify, b.txt 는 add.
    const byPath = new Map(info.files.map((f) => [f.path, f.status]));
    expect(byPath.get("a.txt")).toBe("M");
    expect(byPath.get("b.txt")).toBe("A");
  });

  it("getCommitInfo: root commit has no parents", async () => {
    const info = await getCommitInfo(repoDir, firstSha);
    expect(info.parents).toEqual([]);
    expect(info.subject).toBe("first");
    expect(info.body).toBe("");
    expect(info.files.map((f) => f.path)).toEqual(["a.txt"]);
  });

  it("getCommitFileDiff: shows the file's unified diff", async () => {
    const diff = await getCommitFileDiff(repoDir, secondSha, "a.txt");
    expect(diff).toContain("+beta");
    expect(diff).toContain("a.txt");
  });

  it("listBranches: returns kind=local for refs/heads", async () => {
    const branches = await listBranches(repoDir);
    expect(branches.length).toBeGreaterThan(0);
    const main = branches.find((b) => b.name === "main");
    expect(main).toBeDefined();
    expect(main!.kind).toBe("local");
    expect(main!.current).toBe(true);
  });

  it("push / pull without remote: real git error surfaced as GitCommandError", async () => {
    // `git fetch --all` 은 remote 가 없으면 그냥 no-op 로 성공 — 그래서 fetch
    // 만으론 invariant 가 안 됨. push 와 pull 은 upstream/remote 가 명시 필요해
    // 실패하므로 그쪽으로 검증.
    await expect(gitPushOp(repoDir)).rejects.toBeInstanceOf(GitCommandError);
    await expect(gitPullOp(repoDir)).rejects.toBeInstanceOf(GitCommandError);
  });
});
