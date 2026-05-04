// Agent loadout 디렉터리 — 매 run 직전에 그 에이전트가 가진 스킬과 MCP 설정을
// 디스크에 펼쳐 놓는 곳.
//
// 핵심 아이디어: 스킬 내용을 매 프롬프트에 통째로 박지 않는다. 대신 디렉터리
// 경로와 파일 인덱스만 알려주고, 에이전트가 필요할 때 자기 Read 도구로 가져가게
// 한다. 토큰 비용 ↓, 캐시 안정성 ↑, 에이전트가 무엇이 있는지 "선택해서" 사용.
//
// Layout:
//   ~/.loom/data/agents/<agentId>/
//   ├── README.md     — 인덱스 (사람도 읽을 수 있고 에이전트도 한 번에 훑음)
//   ├── skills/
//   │   └── <safe-name>.md
//   └── mcp.json      — claude-code .mcp.json 포맷 (없으면 생성 안 함)
//
// 매 run마다 디렉터리 통째로 재생성 — rename/삭제가 깔끔히 반영되게.

import fs from "node:fs";
import path from "node:path";
import type { Agent, McpServer, Spec } from "@loom/core";
import { paths } from "../../config.js";

export interface LoadoutSkill {
  /** 원본 spec 이름 (사람이 읽기 위한 것). */
  name: string;
  /** 디렉터리 기준 상대 경로 — "skills/foo.md". 프롬프트에 그대로 박을 수 있음. */
  relPath: string;
  /** content의 첫 줄(헤딩) — 인덱스에 한 줄 설명. */
  blurb: string;
}

export interface AgentLoadout {
  /** 절대 경로. /Users/.../.loom/data/agents/<id>/ */
  dir: string;
  /** README.md 절대 경로 (인덱스). */
  readmePath: string;
  /** mcp.json 절대 경로. 할당된 MCP가 0개면 null. */
  mcpConfigPath: string | null;
  /** 펼쳐 놓은 스킬 파일들. */
  skills: LoadoutSkill[];
  /** 권한 부여된 MCP 서버 이름들 — 프롬프트 인덱스 + 어댑터별 처리에 사용. */
  mcpServerNames: string[];
}

/** 위험한 파일명 문자 제거. 결과가 비면 fallback id 사용. */
function safeFilename(raw: string, fallback: string): string {
  const trimmed = raw
    .normalize("NFKC")
    .replace(/[^\w\-가-힣 ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
  return trimmed || fallback;
}

/** 첫 번째 헤딩(`# X`) 또는 첫 비공백 줄을 인덱스 blurb으로. */
function extractBlurb(content: string): string {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    return trimmed.replace(/^#+\s*/, "").slice(0, 80);
  }
  return "";
}

/** McpServer → claude-code `.mcp.json`이 받는 단일 엔트리.
 *
 *  claude-code의 mcpServers 항목 구조 (ref: code.claude.com/docs/en/mcp):
 *    stdio: { type: "stdio", command, args, env }
 *    http : { type: "http",  url, headers }
 *    sse  : { type: "sse",   url, headers }
 *
 *  다른 어댑터는 자기 코드에서 자기 포맷으로 다시 변환 — 디스크에 떨어뜨리는
 *  한 가지 정본 포맷이 claude-code 포맷이라 이 함수가 정본 인코더.
 *  exported for unit tests. */
export function toClaudeMcpEntry(server: McpServer): Record<string, unknown> {
  if (server.kind === "stdio") {
    return {
      type: "stdio",
      ...(server.command ? { command: server.command } : {}),
      args: server.args,
      ...(Object.keys(server.env).length > 0 ? { env: server.env } : {}),
    };
  }
  // http / sse — same shape, different `type`.
  return {
    type: server.kind,
    ...(server.url ? { url: server.url } : {}),
    ...(Object.keys(server.headers).length > 0
      ? { headers: server.headers }
      : {}),
  };
}

function renderReadme(
  agent: Agent,
  loadoutDir: string,
  skills: LoadoutSkill[],
  mcpServers: McpServer[],
): string {
  const lines: string[] = [];
  lines.push(`# Agent Loadout — @${agent.name}`);
  lines.push("");
  if (agent.role) {
    lines.push(`Role: **${agent.role}**`);
    lines.push("");
  }
  lines.push(`Loadout directory: \`${loadoutDir}\``);
  lines.push("");
  lines.push("This folder is regenerated on every run. Read the files below");
  lines.push("only when relevant — don't dump everything upfront.");
  lines.push("");

  if (skills.length > 0) {
    lines.push("## Skills (`skills/`)");
    lines.push("");
    for (const s of skills) {
      const blurb = s.blurb ? ` — ${s.blurb}` : "";
      lines.push(`- \`${s.relPath}\` · **${s.name}**${blurb}`);
    }
    lines.push("");
  } else {
    lines.push("## Skills");
    lines.push("");
    lines.push("_None assigned._");
    lines.push("");
  }

  if (mcpServers.length > 0) {
    lines.push("## MCP servers");
    lines.push("");
    for (const s of mcpServers) {
      const desc = s.description ? ` — ${s.description}` : "";
      lines.push(`- **${s.name}** (\`${s.kind}\`)${desc}`);
    }
    lines.push("");
    lines.push(
      "Tools surfaced by these servers are available as `mcp__<server>__<method>`.",
    );
    lines.push("");
  }

  return lines.join("\n");
}

export function materializeAgentLoadout(
  agent: Agent,
  skills: Spec[],
  mcpServers: McpServer[],
): AgentLoadout {
  const dir = path.join(paths.agents, agent.id);

  // 통째로 wipe — 이전 run에서 떨어뜨린 파일이 남아있어 인덱스와 어긋나는 일을 방지.
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  if (skills.length > 0) {
    fs.mkdirSync(path.join(dir, "skills"), { recursive: true });
  }

  const usedNames = new Set<string>();
  const loadoutSkills: LoadoutSkill[] = skills.map((s) => {
    let base = safeFilename(s.name, s.id);
    // 동일 이름 충돌 시 숫자 접미사.
    let candidate = base;
    let n = 2;
    while (usedNames.has(candidate)) {
      candidate = `${base}-${n++}`;
    }
    usedNames.add(candidate);
    const relPath = `skills/${candidate}.md`;
    fs.writeFileSync(path.join(dir, relPath), s.content);
    return { name: s.name, relPath, blurb: extractBlurb(s.content) };
  });

  let mcpConfigPath: string | null = null;
  if (mcpServers.length > 0) {
    mcpConfigPath = path.join(dir, "mcp.json");
    const config = {
      mcpServers: Object.fromEntries(
        mcpServers.map((s) => [s.name, toClaudeMcpEntry(s)]),
      ),
    };
    fs.writeFileSync(mcpConfigPath, JSON.stringify(config, null, 2));
  }

  const readmePath = path.join(dir, "README.md");
  fs.writeFileSync(readmePath, renderReadme(agent, dir, loadoutSkills, mcpServers));

  return {
    dir,
    readmePath,
    mcpConfigPath,
    skills: loadoutSkills,
    mcpServerNames: mcpServers.map((s) => s.name),
  };
}
