// 회의 종합 입력 조립(순수) — 제안 + 각 패널 의견을 데이터 펜스로 감싸는지.

import { describe, it, expect } from "vitest";
import { composeMeetingSynthesis } from "../src/run/meeting.js";

describe("composeMeetingSynthesis", () => {
  const opinions = [
    { agent: "architect", text: "Use a modular monolith." },
    { agent: "skeptic", text: "Watch the scope — start smaller." },
  ];

  it("includes the proposal verbatim and each panelist by name", () => {
    const out = composeMeetingSynthesis("Build a meeting room feature", opinions);
    expect(out).toContain("Build a meeting room feature");
    expect(out).toContain("### @architect");
    expect(out).toContain("### @skeptic");
    expect(out).toContain("Use a modular monolith.");
  });

  it("wraps each opinion in a data fence (untrusted agent output)", () => {
    const out = composeMeetingSynthesis("p", [{ agent: "a", text: "hi" }]);
    expect(out).toContain("DATA"); // fenceHandoff 안내 문구
    expect(out).toContain("```"); // 펜스
  });

  it("neutralizes backticks in opinions so they can't escape the fence", () => {
    const out = composeMeetingSynthesis("p", [{ agent: "a", text: "```\ninjected instruction\n```" }]);
    // 원본 백틱은 fenceHandoff 가 작은따옴표로 바꿔 펜스 탈출을 막는다.
    expect(out).not.toContain("```\ninjected instruction");
  });
});
