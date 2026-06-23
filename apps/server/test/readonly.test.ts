// 읽기 전용 매핑(순수) — 회의 run 이 각 CLI 를 쓰기 차단 모드로 띄우는지.
// 어떤 어댑터든 쓰기 권한 우회(bypass)는 반드시 꺼야 한다.

import { describe, it, expect } from "vitest";
import type { AdapterKind } from "@loom/core";
import { readonlyConfig } from "../src/run/readonly.js";

const ALL: AdapterKind[] = ["claude-code", "antigravity", "codex", "opencode", "devin", "factory"];

describe("readonlyConfig", () => {
  it("claude → plan 모드(분석만), bypass 끔", () => {
    const c = readonlyConfig("claude-code");
    expect(c.permissionMode).toBe("plan");
    expect(c.dangerouslySkipPermissions).toBe(false);
  });

  it("codex → read-only 샌드박스, 두 bypass 토글 모두 끔", () => {
    const c = readonlyConfig("codex");
    expect(c.sandboxMode).toBe("read-only");
    expect(c.dangerouslyBypassApprovalsAndSandbox).toBe(false);
    expect(c.dangerouslySkipPermissions).toBe(false);
  });

  it("factory → readonly 플래그(어댑터가 --auto 생략)", () => {
    const c = readonlyConfig("factory");
    expect(c.readonly).toBe(true);
    expect(c.dangerouslySkipPermissions).toBe(false);
  });

  it("모든 어댑터에서 쓰기 권한 우회를 끈다", () => {
    for (const kind of ALL) {
      expect(readonlyConfig(kind).dangerouslySkipPermissions).toBe(false);
    }
  });
});
