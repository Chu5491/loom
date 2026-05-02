// 최종 프롬프트 조립: agentPrompt → threadContext → skills → userPrompt.
// threadContext는 composer의 "컨텍스트 첨부" 토글로 opt-in. 자동 주입 금지.

import type { Spec } from "@loom/core";

export function composePrompt(
  userPrompt: string,
  skills: Spec[],
  agentPrompt = "",
  threadContext = "",
): string {
  const sections: string[] = [];
  const a = agentPrompt.trim();
  if (a) sections.push(`=== Agent Instructions ===\n${a}\n=== End Instructions ===`);
  const c = threadContext.trim();
  if (c) sections.push(`=== Thread Context ===\n${c}\n=== End Context ===`);
  for (const s of skills) {
    sections.push(`=== Skill: ${s.name} ===\n${s.content}\n=== End Skill ===`);
  }
  sections.push(userPrompt);
  return sections.join("\n\n");
}
