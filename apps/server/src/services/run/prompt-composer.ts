// 최종 프롬프트 조립.
//
// 이전 모델: 모든 스킬 markdown 본문을 매 프롬프트에 박아 넣음.
//   문제 1) 매 턴 같은 내용이 user message에 들어가 토큰 낭비
//   문제 2) 스킬 추가/제거 시 프롬프트 prefix가 통째로 밀려 캐시 미스
//   문제 3) 에이전트가 "필요한 스킬만" 고를 수 없음 — 전부 강제 주입
//
// 새 모델: 스킬 본문은 디스크의 loadout 폴더에 두고, 프롬프트엔 "여기 있다"는
// 짧은 인덱스만. 에이전트가 자기 Read 도구로 필요한 것만 가져감.

import type { AgentLoadout } from "./agent-loadout.js";

export interface ComposePromptInput {
  userPrompt: string;
  agentPrompt?: string;
  threadContext?: string;
  /** 디스크에 펼쳐진 loadout. null이면 인덱스 블록 생략. */
  loadout?: AgentLoadout | null;
}

export function composePrompt(input: ComposePromptInput): string {
  const sections: string[] = [];
  const a = input.agentPrompt?.trim();
  if (a) {
    sections.push(
      `=== Agent Instructions ===\n${a}\n=== End Instructions ===`,
    );
  }
  if (input.loadout && hasLoadoutContent(input.loadout)) {
    sections.push(renderLoadoutBlock(input.loadout));
  }
  const c = input.threadContext?.trim();
  if (c) {
    sections.push(`=== Thread Context ===\n${c}\n=== End Context ===`);
  }
  sections.push(input.userPrompt);
  return sections.join("\n\n");
}

function hasLoadoutContent(loadout: AgentLoadout): boolean {
  return loadout.skills.length > 0 || loadout.mcpServerNames.length > 0;
}

function renderLoadoutBlock(loadout: AgentLoadout): string {
  const lines: string[] = [];
  lines.push("=== Loadout ===");
  lines.push(`Your toolbox lives at: ${loadout.dir}`);
  lines.push(
    "Read files from this folder on demand — don't load all of them upfront.",
  );

  if (loadout.skills.length > 0) {
    lines.push("");
    lines.push(`Skills (${loadout.skills.length}):`);
    for (const s of loadout.skills) {
      const blurb = s.blurb ? ` — ${s.blurb}` : "";
      lines.push(`  - ${s.relPath}  ${s.name}${blurb}`);
    }
  }

  if (loadout.mcpServerNames.length > 0) {
    lines.push("");
    lines.push(`MCP servers available (${loadout.mcpServerNames.length}):`);
    for (const name of loadout.mcpServerNames) {
      lines.push(`  - ${name}   (call as mcp__${name}__<method>)`);
    }
  }

  lines.push(
    `\nFull index: ${loadout.readmePath} (also human-readable).`,
  );
  lines.push("=== End Loadout ===");
  return lines.join("\n");
}
