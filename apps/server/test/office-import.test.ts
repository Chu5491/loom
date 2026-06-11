// zip/.md 가져오기 — 폴더 스킬 추출, root 폴더 strip, zip-slip 거부, 규약 일괄.

import { afterAll, describe, it, expect } from "vitest";
import AdmZip from "adm-zip";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "loom-import-test-"));
process.env.LOOM_HOME = home;

const imp = await import("../src/office-import.js");
const office = await import("../src/office.js");

afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

function zipOf(files: Record<string, string>): Buffer {
  const z = new AdmZip();
  for (const [p, c] of Object.entries(files)) z.addFile(p, Buffer.from(c));
  return z.toBuffer();
}

describe("importSkillArchive", () => {
  it("extracts a zip with SKILL.md into a folder skill", () => {
    const buf = zipOf({ "SKILL.md": "---\nname: x\ndescription: \"d\"\n---\n# X", "reference.md": "# Ref" });
    const skill = imp.importSkillArchive("my-skill.zip", buf);
    expect(skill.name).toBe("my-skill");
    expect(skill.files).toEqual(["reference.md"]);
    expect(skill.body).toContain("# X");
  });

  it("strips a single root folder (claude-style zip)", () => {
    const buf = zipOf({ "bundle/SKILL.md": "# B", "bundle/docs/ref.md": "r" });
    const skill = imp.importSkillArchive("bundle.zip", buf);
    expect(skill.files).toEqual(["docs/ref.md"]);
  });

  it("rejects zip without SKILL.md and zip-slip paths", () => {
    expect(() => imp.importSkillArchive("a.zip", zipOf({ "readme.md": "x" }))).toThrow(/SKILL.md/);
    // adm-zip 은 addFile 시점에 ../ 를 정규화하므로, 악성 zip 은 바이트 패치로 재현
    // (local header + central directory 양쪽의 파일명을 같은 길이의 "../e.md" 로 치환).
    const benign = zipOf({ "evil.md": "x", "SKILL.md": "s" });
    const evil = Buffer.from(benign.toString("latin1").replaceAll("evil.md", "../e.md"), "latin1");
    expect(() => imp.importSkillArchive("b.zip", evil)).toThrow(/unsafe/);
  });

  it("rejects duplicates and accepts a bare .md as a single-file skill", () => {
    expect(() => imp.importSkillArchive("my-skill.zip", zipOf({ "SKILL.md": "again" }))).toThrow(/exists/);
    const s = imp.importSkillArchive("solo.md", Buffer.from("# Solo body"));
    expect(s.name).toBe("solo");
    expect(office.readSkills().find((x) => x.name === "solo")?.body).toContain("# Solo body");
  });
});

describe("importRulesArchive", () => {
  it("imports every .md in a zip as a rule named by filename", () => {
    const rules = imp.importRulesArchive("rules.zip", zipOf({ "style.md": "# S", "review.md": "# R" }));
    expect(rules.map((r) => r.name).sort()).toEqual(["review", "style"]);
    expect(office.readRules().some((r) => r.name === "style")).toBe(true);
  });
});
