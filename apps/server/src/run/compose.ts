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
  /** 프로젝트 공유 메모(<project>/.loom/notes.md) — 파일이 있을 때만 경로 안내.
   *  본문은 주입하지 않는다(자동 주입 금지) — 에이전트가 필요할 때 Read. */
  projectNotesPath?: string | null;
}

export function composePrompt(input: ComposeInput): string {
  const sections: string[] = [];

  for (const r of input.rules) {
    const body = r.trim();
    if (body) sections.push(`=== Rules ===\n${body}\n=== End Rules ===`);
  }
  const a = input.agentPrompt?.trim();
  if (a) sections.push(`=== Agent Instructions ===\n${a}\n=== End Instructions ===`);

  if (input.loadout && (input.loadout.skills.length || input.loadout.mcpServerNames.length || input.loadout.delegate)) {
    sections.push(renderLoadout(input.loadout));
  }

  if (input.projectNotesPath) {
    sections.push(
      "=== Project Memory ===\n" +
        `Shared team notes for this project: ${input.projectNotesPath}\n` +
        "Read it when past context would help. After meaningful work, append concise durable notes (decisions, gotchas, conventions) — keep entries short.\n" +
        "=== End Project Memory ===",
    );
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
    // 툴 네이밍은 CLI마다 다름(claude=mcp__server__method, devin/others=서버 고유명).
    // 특정 컨벤션을 강제하지 않고 "사용 가능"만 알린다 — 잘못된 이름 강제가
    // 일부 CLI에서 툴을 못 찾게 만들었음(검증).
    lines.push("", `MCP servers available (${l.mcpServerNames.length}):`);
    for (const n of l.mcpServerNames) lines.push(`  - ${n}  — its tools are available; call them when relevant.`);
  }
  if (l.delegate) {
    // MCP 도구가 없는 CLI 의 위임 경로 — 셸로 브리지 실행. delegate opt-in 시에만 실린다.
    lines.push(
      "",
      "Delegation (this CLI has no MCP tools — use the shell bridge):",
      `  Run: sh ${l.delegate.scriptPath} <teammate> "<complete, self-contained task>"`,
      "  The teammate's reply prints to stdout. Use it to continue your work.",
      `  Teammates: ${l.delegate.teammates.join(", ")}`,
    );
  }
  lines.push(`\nFull index: ${l.readmePath}`, "=== End Loadout ===");
  return lines.join("\n");
}
