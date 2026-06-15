// splitFrontmatter — writeSkill(JSON.stringify) 과 대칭으로 파싱되는지.
// 핵심 회귀: 따옴표 든 description 이 저장→로드 왕복에서 백슬래시를 남기지 않아야 한다.

import { describe, it, expect } from "vitest";
import { splitFrontmatter } from "../src/office.js";

describe("splitFrontmatter", () => {
  it("JSON-parses double-quoted values so inner quotes survive cleanly", () => {
    // writeSkill 이 내보내는 형태: description: <JSON.stringify(...)>
    const desc = 'proposing "deepening" refactors';
    const raw = `---\nname: x\ndescription: ${JSON.stringify(desc)}\n---\nbody`;
    const { meta } = splitFrontmatter(raw);
    expect(meta.description).toBe(desc);
    expect(meta.description).not.toContain("\\");
  });

  it("round-trips a quoted description without accumulating backslashes", () => {
    const desc = 'a "quoted" word';
    const once = `description: ${JSON.stringify(desc)}`;
    // 한 번 직렬화한 값을 다시 직렬화해도(왕복) 파싱 결과는 동일해야 한다
    const r1 = splitFrontmatter(`---\nname: x\n${once}\n---\n`).meta.description;
    const r2 = splitFrontmatter(`---\nname: x\ndescription: ${JSON.stringify(r1)}\n---\n`).meta.description;
    expect(r1).toBe(desc);
    expect(r2).toBe(desc);
  });

  it("falls back to stripping outer quotes for non-JSON values", () => {
    const { meta } = splitFrontmatter(`---\nname: 'single'\ndescription: bare value\n---\n`);
    expect(meta.name).toBe("single");
    expect(meta.description).toBe("bare value");
  });

  it("tolerates a double-quoted but non-JSON value (no throw)", () => {
    const { meta } = splitFrontmatter(`---\ndescription: "unterminated \\q escape"\n---\n`);
    expect(typeof meta.description).toBe("string");
  });
});
