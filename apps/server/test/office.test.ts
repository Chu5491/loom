// office agentSchema 의 adapter enum 이 registry 에 등록된 어댑터와 어긋나지 않는지.
// (factory 가 enum 에서 빠져 에이전트 저장이 막혔던 회귀를 잡는 드리프트 가드.)

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.LOOM_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "loom-office-schema-"));

const { agentSchema } = await import("../src/office.js");
const { listAdapterKinds } = await import("../src/adapters/registry.js");

describe("agentSchema adapter enum", () => {
  it("accepts every registered adapter kind (registry ↔ office enum 드리프트 가드)", () => {
    const kinds = listAdapterKinds();
    expect(kinds.length).toBeGreaterThanOrEqual(6); // 6 CLI 모두 등록
    const rejected = kinds.filter((k) => !agentSchema.safeParse({ adapter: k }).success);
    expect(rejected).toEqual([]); // 등록됐는데 enum 에서 거부되는 어댑터가 없어야
  });

  it("rejects an unknown adapter kind", () => {
    expect(agentSchema.safeParse({ adapter: "nope" }).success).toBe(false);
  });
});
