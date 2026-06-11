// 스킬 딸린 파일 — 경로 검증(traversal 차단) + 단일 .md → 폴더 자동 승격.

import { afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "loom-skillfiles-test-"));
process.env.LOOM_HOME = home;

const office = await import("../src/office.js");

afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

describe("safeRelPath", () => {
  it("accepts nested safe paths", () => {
    expect(office.safeRelPath("docs/reference.md")).toBe("docs/reference.md");
  });
  it("rejects traversal and SKILL.md", () => {
    expect(() => office.safeRelPath("../evil.md")).toThrow();
    expect(() => office.safeRelPath("a/../../b")).toThrow();
    expect(() => office.safeRelPath("SKILL.md")).toThrow();
  });
});

describe("writeSkillFile", () => {
  it("promotes a single-file skill to a folder and keeps the body", () => {
    office.writeSkill("promo", "desc", "# Body");
    const skill = office.writeSkillFile("promo", "ref.md", "# Ref");
    expect(skill.files).toEqual(["ref.md"]);
    expect(fs.existsSync(path.join(home, "office/skills/promo/SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(home, "office/skills/promo.md"))).toBe(false);
    expect(office.readSkills().find((s) => s.name === "promo")?.body).toContain("# Body");
    expect(office.readSkillFile("promo", "ref.md")).toBe("# Ref");
  });

  it("deleteSkillFile removes only that file", () => {
    office.writeSkillFile("promo", "extra.md", "x");
    expect(office.deleteSkillFile("promo", "extra.md")).toBe(true);
    expect(office.readSkills().find((s) => s.name === "promo")?.files).toEqual(["ref.md"]);
  });
});
