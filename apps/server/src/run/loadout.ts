// Agent loadout — 매 run 직전에 그 에이전트의 스킬·MCP 설정을 디스크에 펼친다.
// 스킬 본문을 프롬프트에 통째로 박지 않고, 경로+인덱스만 알려 에이전트가 필요할
// 때 Read 하게 한다 (토큰 ↓, 캐시 ↑). data/loadouts/<agent>/<scope>/ 에 run 마다
// 격리 생성 — 종료 시 engine 이 정리하고, 부팅 시 잔재를 통째로 청소한다.

import fs from "node:fs";
import path from "node:path";
import type { AgentSpec, McpServer, SkillSpec } from "@loom/core";
import { paths } from "../config.js";

export interface LoadoutSkill {
  name: string;
  relPath: string; // "skills/foo.md"
  blurb: string;
}

export interface AgentLoadout {
  dir: string;
  readmePath: string;
  mcpConfigPath: string | null;
  skills: LoadoutSkill[];
  mcpServerNames: string[];
  /** MCP 주입 불가 CLI(antigravity)용 위임 셸 브리지 — delegate.sh 경로 + 팀원. */
  delegate?: { scriptPath: string; teammates: string[] } | null;
}

/** MCP 를 못 싣는 CLI 용 위임 브리지 입력 — 엔진이 delegate opt-in 시 넘긴다. */
export interface DelegateBridge {
  runId: string;
  /** POST <url>?runId=&agent= (body=task) — 결과 텍스트가 응답으로 온다. */
  url: string;
  teammates: string[];
}

function safeFilename(raw: string, fallback: string): string {
  const t = raw
    .normalize("NFKC")
    .replace(/[^\w\-가-힣 ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
  return t || fallback;
}

function extractBlurb(content: string): string {
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (t) return t.replace(/^#+\s*/, "").slice(0, 80);
  }
  return "";
}

/** McpServer → claude-code `.mcp.json` 한 엔트리 (정본 인코딩). */
export function toClaudeMcpEntry(s: McpServer): Record<string, unknown> {
  if (s.kind === "stdio") {
    return {
      type: "stdio",
      ...(s.command ? { command: s.command } : {}),
      args: s.args,
      ...(Object.keys(s.env).length > 0 ? { env: s.env } : {}),
    };
  }
  return {
    type: s.kind,
    ...(s.url ? { url: s.url } : {}),
    ...(Object.keys(s.headers).length > 0 ? { headers: s.headers } : {}),
  };
}

function renderReadme(
  agent: string,
  dir: string,
  skills: LoadoutSkill[],
  mcp: McpServer[],
): string {
  const l: string[] = [`# Loadout — @${agent}`, "", `Directory: \`${dir}\``, ""];
  l.push("Regenerated every run. Read files below only when relevant.", "");
  if (skills.length) {
    l.push("## Skills (`skills/`)", "");
    for (const s of skills) l.push(`- \`${s.relPath}\` · **${s.name}**${s.blurb ? ` — ${s.blurb}` : ""}`);
    l.push("");
  }
  if (mcp.length) {
    l.push("## MCP servers", "");
    for (const s of mcp) l.push(`- **${s.name}** (\`${s.kind}\`)${s.description ? ` — ${s.description}` : ""}`);
    l.push("", "Call tools as `mcp__<server>__<method>`.", "");
  }
  return l.join("\n");
}

export function materializeLoadout(
  agent: AgentSpec,
  skills: SkillSpec[],
  mcp: McpServer[],
  bridge: DelegateBridge | null,
  scope: string,
): AgentLoadout {
  // scope(runId 또는 "preview")로 격리 — 에이전트 단위 디렉토리 하나를 공유하면
  // 같은 에이전트의 동시 run/프리뷰가 라이브 run 이 읽을 스킬·mcp.json 을 지워버린다.
  const dir = path.join(paths.loadouts, agent.name, scope);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  if (skills.length) fs.mkdirSync(path.join(dir, "skills"), { recursive: true });

  const used = new Set<string>();
  const loadoutSkills: LoadoutSkill[] = skills.map((s) => {
    let cand = safeFilename(s.name, "skill");
    let n = 2;
    while (used.has(cand)) cand = `${safeFilename(s.name, "skill")}-${n++}`;
    used.add(cand);

    // 폴더 스킬(딸린 references/스크립트 보유)은 office 의 원본 폴더를 통째 복사 —
    // SKILL.md 가 형제 파일을 상대경로로 참조해도 그대로 동작한다.
    if (s.files?.length) {
      const src = path.join(paths.office, "skills", s.name);
      const dst = path.join(dir, "skills", cand);
      fs.cpSync(src, dst, { recursive: true });
      return { name: s.name, relPath: `skills/${cand}/SKILL.md`, blurb: extractBlurb(s.body) };
    }

    const relPath = `skills/${cand}.md`;
    fs.writeFileSync(path.join(dir, relPath), s.body);
    return { name: s.name, relPath, blurb: extractBlurb(s.body) };
  });

  let mcpConfigPath: string | null = null;
  if (mcp.length) {
    mcpConfigPath = path.join(dir, "mcp.json");
    fs.writeFileSync(
      mcpConfigPath,
      JSON.stringify(
        { mcpServers: Object.fromEntries(mcp.map((s) => [s.name, toClaudeMcpEntry(s)])) },
        null,
        2,
      ),
    );
  }

  // MCP 불가 CLI 의 위임 — 에이전트가 자기 셸 도구로 실행하는 브리지 스크립트.
  // 결과 텍스트가 stdout 으로 돌아오므로 어떤 CLI 든 동작한다.
  let delegate: AgentLoadout["delegate"] = null;
  if (bridge) {
    const scriptPath = path.join(dir, "delegate.sh");
    fs.writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        "# loom delegate bridge — usage: sh delegate.sh <teammate> <task...>",
        'AGENT="$1"; shift',
        `printf '%s' "$*" | curl -sS -X POST "${bridge.url}?runId=${bridge.runId}&agent=$AGENT" -H 'Content-Type: text/plain' --data-binary @-`,
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    delegate = { scriptPath, teammates: bridge.teammates };
  }

  const readmePath = path.join(dir, "README.md");
  fs.writeFileSync(readmePath, renderReadme(agent.name, dir, loadoutSkills, mcp));

  return { dir, readmePath, mcpConfigPath, skills: loadoutSkills, mcpServerNames: mcp.map((s) => s.name), delegate };
}
