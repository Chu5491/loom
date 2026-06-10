// Agent loadout — 매 run 직전에 그 에이전트의 스킬·MCP 설정을 디스크에 펼친다.
// 스킬 본문을 프롬프트에 통째로 박지 않고, 경로+인덱스만 알려 에이전트가 필요할
// 때 Read 하게 한다 (토큰 ↓, 캐시 ↑). data/loadouts/<agent>/ 에 매번 재생성.

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
): AgentLoadout {
  const dir = path.join(paths.loadouts, agent.name);
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

  const readmePath = path.join(dir, "README.md");
  fs.writeFileSync(readmePath, renderReadme(agent.name, dir, loadoutSkills, mcp));

  return { dir, readmePath, mcpConfigPath, skills: loadoutSkills, mcpServerNames: mcp.map((s) => s.name) };
}
