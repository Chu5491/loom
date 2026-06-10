// 파일 검색 — @file 멘션의 백엔드. substring 매칭·스킵 디렉토리·limit.

import { afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { searchFiles } from "../src/files.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-files-test-"));
fs.mkdirSync(path.join(root, "src", "pages"), { recursive: true });
fs.mkdirSync(path.join(root, "node_modules", "lib"), { recursive: true });
fs.writeFileSync(path.join(root, "README.md"), "");
fs.writeFileSync(path.join(root, "src", "index.ts"), "");
fs.writeFileSync(path.join(root, "src", "pages", "TalkPage.tsx"), "");
fs.writeFileSync(path.join(root, "node_modules", "lib", "index.ts"), "");

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("searchFiles", () => {
  it("matches by case-insensitive substring of the relative path", () => {
    expect(searchFiles(root, "talkpage")).toEqual(["src/pages/TalkPage.tsx"]);
  });

  it("skips node_modules and friends", () => {
    const hits = searchFiles(root, "index");
    expect(hits).toContain("src/index.ts");
    expect(hits.every((h) => !h.includes("node_modules"))).toBe(true);
  });

  it("empty query lists files up to the limit", () => {
    expect(searchFiles(root, "", 2)).toHaveLength(2);
  });
});
