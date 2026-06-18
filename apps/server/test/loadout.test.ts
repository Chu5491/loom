// 로드아웃 펼치기 — run 직전 에이전트의 스킬·MCP·위임 브리지를 격리 디렉토리에
// 디스크로 실체화한다. 파일시스템 상호작용이라 임시 LOOM_HOME 으로 격리해 검증.

import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentSpec, SkillSpec, McpServer } from "@loom/core";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "loom-loadout-test-"));
process.env.LOOM_HOME = home;

const { materializeLoadout } = await import("../src/run/loadout.js");

afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

describe("materializeLoadout", () => {
  const lo = materializeLoadout(
    { name: "Coder", adapter: "claude-code", model: "m" } as AgentSpec,
    [{ name: "skill-a", body: "skill body here", description: "does a thing" }] as SkillSpec[],
    [{ name: "loom", kind: "stdio", command: "node", args: ["s.js"], env: {} }] as McpServer[],
    null,
    "run1",
  );

  it("scope 별 격리 디렉토리를 만든다", () => {
    expect(fs.existsSync(lo.dir)).toBe(true);
    expect(lo.dir).toContain(path.join("Coder", "run1"));
  });

  it("단일 스킬 본문을 쓰고 인덱스에 올린다", () => {
    expect(lo.skills).toHaveLength(1);
    const sk = lo.skills[0]!;
    expect(sk.name).toBe("skill-a");
    expect(fs.readFileSync(path.join(lo.dir, sk.relPath), "utf8")).toBe("skill body here");
    expect(sk.blurb).toBe("does a thing"); // description 우선
  });

  it("mcp.json 에 서버 엔트리를 쓴다", () => {
    expect(lo.mcpConfigPath).toBeTruthy();
    const cfg = JSON.parse(fs.readFileSync(lo.mcpConfigPath!, "utf8"));
    expect(cfg.mcpServers.loom).toBeTruthy();
    expect(lo.mcpServerNames).toEqual(["loom"]);
  });

  it("README 인덱스를 쓰고, bridge 가 null 이면 delegate 없음", () => {
    expect(fs.existsSync(lo.readmePath)).toBe(true);
    expect(lo.delegate).toBeNull();
  });

  it("재실행 시 같은 scope 디렉토리를 깨끗이 재생성한다", () => {
    fs.writeFileSync(path.join(lo.dir, "stale.txt"), "old");
    const lo2 = materializeLoadout(
      { name: "Coder", adapter: "claude-code", model: "m" } as AgentSpec,
      [],
      [],
      null,
      "run1",
    );
    expect(fs.existsSync(path.join(lo2.dir, "stale.txt"))).toBe(false); // 이전 잔재 제거
    expect(lo2.skills).toEqual([]);
    expect(lo2.mcpConfigPath).toBeNull();
  });
});
