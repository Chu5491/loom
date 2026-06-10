// 최종 프롬프트 조립. 자동 주입은 죄 — office 에 명시한 rules·loadout 만,
// 출처를 표시하고 붙인다. 스킬 본문은 loadout 디스크에, 프롬프트엔 인덱스만.

import type { AgentLoadout } from "./loadout.js";

export interface ComposeInput {
  userPrompt: string;
  /** 포함된 rule 들의 본문 (office/rules). 매 턴 동일 prefix → prompt cache 친화. */
  rules: string[];
  /** 에이전트 지시 프롬프트. */
  agentPrompt?: string;
  loadout?: AgentLoadout | null;
}

export function composePrompt(input: ComposeInput): string {
  const sections: string[] = [];

  for (const r of input.rules) {
    const body = r.trim();
    if (body) sections.push(`=== Rules ===\n${body}\n=== End Rules ===`);
  }
  const a = input.agentPrompt?.trim();
  if (a) sections.push(`=== Agent Instructions ===\n${a}\n=== End Instructions ===`);

  if (input.loadout && (input.loadout.skills.length || input.loadout.mcpServerNames.length)) {
    sections.push(renderLoadout(input.loadout));
  }

  sections.push(input.userPrompt);
  return sections.join("\n\n");
}

function renderLoadout(l: AgentLoadout): string {
  const lines: string[] = ["=== Loadout ==="];
  lines.push(`Your toolbox lives at: ${l.dir}`);
  lines.push("Read files from this folder on demand — don't load all upfront.");
  if (l.skills.length) {
    lines.push("", `Skills (${l.skills.length}):`);
    for (const s of l.skills) lines.push(`  - ${s.relPath}  ${s.name}${s.blurb ? ` — ${s.blurb}` : ""}`);
  }
  if (l.mcpServerNames.length) {
    lines.push("", `MCP servers (${l.mcpServerNames.length}):`);
    for (const n of l.mcpServerNames) lines.push(`  - ${n}   (call as mcp__${n}__<method>)`);
  }
  lines.push(`\nFull index: ${l.readmePath}`, "=== End Loadout ===");
  return lines.join("\n");
}
