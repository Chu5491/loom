// v2-core 스모크 — 레지스트리가 빌트인 어댑터를 전부 알고, 매니페스트가 UI가
// 기대하는 최소 형태(kind/displayName/fields)를 갖는지. DB 없음.

import { describe, it, expect } from "vitest";
import {
  getAdapter,
  getManifest,
  listAdapterKinds,
  listManifests,
} from "../src/adapters/registry.js";

const EXPECTED = ["claude-code", "antigravity", "codex", "opencode", "devin", "factory"];

describe("adapter registry (v2-core)", () => {
  it("registers all built-in adapters", () => {
    expect(listAdapterKinds().sort()).toEqual([...EXPECTED].sort());
  });

  it("every manifest has display metadata and a default command", () => {
    for (const m of listManifests()) {
      expect(m.kind).toBeTruthy();
      expect(m.displayName).toBeTruthy();
      expect(m.defaultCommand).toBeTruthy();
      expect(Array.isArray(m.fields)).toBe(true);
    }
  });

  it("adapter and manifest lookups agree", () => {
    for (const kind of EXPECTED) {
      expect(getAdapter(kind as never)?.kind).toBe(kind);
      expect(getManifest(kind as never)?.kind).toBe(kind);
    }
  });

  it("unknown kind returns null, not a throw", () => {
    expect(getAdapter("nope" as never)).toBeNull();
    expect(getManifest("nope" as never)).toBeNull();
  });
});
