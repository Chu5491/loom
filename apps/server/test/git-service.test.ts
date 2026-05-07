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
  applyPatch,
  applyStash,
  createBranch,
  deleteBranch,
  dropStash,
  getCommitInfo,
  getCommitFileDiff,
  getStatus,
  listBranches,
  listStash,
  popStash,
  probeGh,
  pull as gitPullOp,
  push as gitPushOp,
  renameBranch,
  saveStash,
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

  it("createBranch + renameBranch + deleteBranch: round trip", async () => {
    await createBranch(repoDir, "feature/foo");
    let branches = await listBranches(repoDir);
    expect(branches.find((b) => b.name === "feature/foo")).toBeDefined();

    await renameBranch(repoDir, "feature/foo", "feature/bar");
    branches = await listBranches(repoDir);
    expect(branches.find((b) => b.name === "feature/foo")).toBeUndefined();
    expect(branches.find((b) => b.name === "feature/bar")).toBeDefined();

    await deleteBranch(repoDir, "feature/bar");
    branches = await listBranches(repoDir);
    expect(branches.find((b) => b.name === "feature/bar")).toBeUndefined();
  });

  it("createBranch with checkout=true switches HEAD", async () => {
    await createBranch(repoDir, "tmp-checkout-test", { checkout: true });
    const branches = await listBranches(repoDir);
    const created = branches.find((b) => b.name === "tmp-checkout-test");
    expect(created?.current).toBe(true);
    // cleanup — 다른 테스트에 영향 안 가게 main 으로 돌려놓고 삭제.
    await execFile("git", ["checkout", "main"], { cwd: repoDir });
    await deleteBranch(repoDir, "tmp-checkout-test");
  });

  it("stash save + list + drop", async () => {
    // 워킹트리에 변경을 만들어야 stash 가 의미 있음.
    fs.writeFileSync(path.join(repoDir, "stash-target.txt"), "dirty\n");
    await execFile("git", ["add", "stash-target.txt"], { cwd: repoDir });
    await saveStash(repoDir, { message: "test stash" });
    const list = await listStash(repoDir);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]!.index).toBe(0);
    expect(list[0]!.message).toContain("test stash");

    // pop 으로 워킹트리 복원되는지 확인.
    await popStash(repoDir, 0);
    const after = await listStash(repoDir);
    expect(after.length).toBe(0);
    // 파일이 다시 워킹트리에 있어야 함.
    expect(fs.existsSync(path.join(repoDir, "stash-target.txt"))).toBe(true);

    // cleanup — staged 인 파일 unstage + 삭제.
    await execFile("git", ["reset", "HEAD", "stash-target.txt"], {
      cwd: repoDir,
    });
    fs.rmSync(path.join(repoDir, "stash-target.txt"));
  });

  it("stash apply + drop: keeps stash until drop", async () => {
    fs.writeFileSync(path.join(repoDir, "stash-apply.txt"), "x\n");
    await execFile("git", ["add", "stash-apply.txt"], { cwd: repoDir });
    await saveStash(repoDir, { message: "apply test" });
    await applyStash(repoDir, 0);
    let list = await listStash(repoDir);
    expect(list.length).toBe(1); // apply 는 stash 를 남김
    await dropStash(repoDir, 0);
    list = await listStash(repoDir);
    expect(list.length).toBe(0);
    // cleanup
    await execFile("git", ["reset", "HEAD", "stash-apply.txt"], {
      cwd: repoDir,
    });
    fs.rmSync(path.join(repoDir, "stash-apply.txt"));
  });

  it("applyPatch: stages a hunk via git apply --cached", async () => {
    // 새 파일 만들어 변경 → diff → 그 diff 의 첫 hunk 만 stage.
    fs.writeFileSync(path.join(repoDir, "hunk.txt"), "first\nsecond\nthird\n");
    await execFile("git", ["add", "hunk.txt"], { cwd: repoDir });
    await execFile("git", ["commit", "-q", "-m", "seed"], { cwd: repoDir });
    fs.writeFileSync(
      path.join(repoDir, "hunk.txt"),
      "first changed\nsecond\nthird changed\n",
    );

    // diff 를 그대로 patch 로 사용 — git apply 가 정확히 받아야 함.
    const { stdout } = await execFile("git", ["diff", "hunk.txt"], {
      cwd: repoDir,
    });
    await applyPatch(repoDir, stdout, { cached: true });
    const status = await getStatus(repoDir);
    expect(status.staged.find((c) => c.path === "hunk.txt")).toBeDefined();

    // cleanup — 다 reset.
    await execFile("git", ["reset", "--hard", "HEAD"], { cwd: repoDir });
    fs.rmSync(path.join(repoDir, "hunk.txt"));
  });

  it("probeGh: returns installed=false gracefully when gh missing", async () => {
    // 이 머신에 gh 가 없는 환경에서 돌면 false 를, 있으면 true + version 을
    // 받음. 어느 쪽이든 throw 안 하고 안전하게 반환.
    const r = await probeGh();
    expect(typeof r.installed).toBe("boolean");
    if (r.installed) {
      expect(r.version.length).toBeGreaterThan(0);
    } else {
      expect(r.version).toBe("");
    }
  });

  it("project-clone: cloneRepo + removeClonedRepo round-trip", async () => {
    const { cloneRepo, removeClonedRepo } = await import(
      "../src/services/project-clone.js"
    );
    const { paths } = await import("../src/config.js");

    // 다른 임시 dir 을 'origin' 으로 — bare repo 만들어 clone 가능하게.
    const origin = fs.mkdtempSync(path.join(os.tmpdir(), "loom-origin-"));
    await execFile("git", ["init", "-q", "--bare"], { cwd: origin });

    // origin 에 한 커밋 시드 — 빈 bare 는 clone 시 'warning: empty repo' 만
    // 뜨고 진행되지만, 진짜 시나리오 가깝게 한 줄 박음.
    const seed = fs.mkdtempSync(path.join(os.tmpdir(), "loom-seed-"));
    await execFile("git", ["init", "-q", "-b", "main"], { cwd: seed });
    await execFile("git", ["config", "user.email", "t@t"], { cwd: seed });
    await execFile("git", ["config", "user.name", "t"], { cwd: seed });
    fs.writeFileSync(path.join(seed, "README.md"), "hello\n");
    await execFile("git", ["add", "."], { cwd: seed });
    await execFile("git", ["commit", "-q", "-m", "init"], { cwd: seed });
    await execFile("git", ["push", "-q", origin, "main"], { cwd: seed });

    const projectId = "test-clone-" + Date.now();
    const r = await cloneRepo(projectId, origin);
    expect(r.path).toBe(path.join(paths.repos, projectId));
    expect(fs.existsSync(path.join(r.path, ".git"))).toBe(true);
    expect(fs.existsSync(path.join(r.path, "README.md"))).toBe(true);

    // remove 가 그 폴더만 정확히 정리.
    removeClonedRepo(projectId);
    expect(fs.existsSync(r.path)).toBe(false);

    // cleanup
    fs.rmSync(origin, { recursive: true, force: true });
    fs.rmSync(seed, { recursive: true, force: true });
  });

  it("restoreWorkTree: rolls workspace back to a snapshot ref", async () => {
    const { snapshotWorkTree, restoreWorkTree } = await import(
      "../src/services/git-snapshot.js"
    );

    // before 스냅샷.
    const before = await snapshotWorkTree(repoDir);
    expect(before).toBeTruthy();

    // 변경: 새 파일 추가, 기존 파일 수정.
    fs.writeFileSync(path.join(repoDir, "rollback-new.txt"), "new\n");
    fs.writeFileSync(path.join(repoDir, "a.txt"), "alpha\nrollback-modified\n");

    // 되돌리기 — before 시점으로.
    const r = await restoreWorkTree(repoDir, before!);
    expect(r.safetyRef).toBeTruthy();
    // 그 사이에 만든 파일은 사라지고…
    expect(fs.existsSync(path.join(repoDir, "rollback-new.txt"))).toBe(false);
    // 수정한 파일은 원상복귀.
    expect(fs.readFileSync(path.join(repoDir, "a.txt"), "utf8")).toBe(
      "alpha\nbeta\n",
    );
  });
});
