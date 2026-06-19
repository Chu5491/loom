// 스마트 디스패치 — 작업 설명을 보고 적합한 에이전트를 고른다. 순수 로직.
// v1 은 키워드 매칭: 에이전트의 label/prompt + 보유 스킬의 이름·설명과
// 작업 텍스트의 단어 겹침을 점수화. (LLM 라우터는 점수가 못 가를 때의 후속 후보.)
// 라우팅일 뿐 주입이 아니다 — 프롬프트는 적은 그대로 선택된 에이전트에게 간다.

import type { AgentSpec, SkillSpec } from "@loom/core";

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 2),
  );
}

export interface DispatchPick {
  agent: string;
  score: number;
  /** 점수에 기여한 단어들 — UI/로그 설명용. */
  matched: string[];
}

/** 후보별 점수. 에이전트 자기소개(label·prompt)는 1점, 스킬 이름·설명은 2점(전문성 신호). */
export function scoreAgent(task: string, agent: AgentSpec, skills: SkillSpec[]): DispatchPick {
  const want = tokens(task);
  const matched = new Set<string>();
  let score = 0;

  const own = tokens(`${agent.label ?? ""} ${agent.prompt ?? ""}`);
  for (const w of want) {
    if (own.has(w)) {
      score += 1;
      matched.add(w);
    }
  }

  const skillText = (agent.skills ?? [])
    .map((n) => skills.find((s) => s.name === n))
    .filter(Boolean)
    .map((s) => `${s!.name.replace(/-/g, " ")} ${s!.description}`)
    .join(" ");
  const skillTokens = tokens(skillText);
  for (const w of want) {
    if (skillTokens.has(w)) {
      score += 2;
      matched.add(w);
    }
  }

  return { agent: agent.name, score, matched: [...matched] };
}

/** 최고점 에이전트 — 키워드 동점이면 30일 성공률(successRate, 0~1)이 높은 쪽을 고른다.
 *  성공률도 같으면 정의 순서(안정 정렬). 모두 0점·무실적이면 첫 에이전트(명시적 폴백).
 *  successRate 를 안 주면 키워드 점수 + 정의 순서로만 — 기존 동작과 동일. 라우팅일 뿐 주입 아님. */
export function pickAgent(
  task: string,
  agents: AgentSpec[],
  skills: SkillSpec[],
  successRate?: Record<string, number>,
): DispatchPick | null {
  if (agents.length === 0) return null;
  const scored = agents.map((a) => ({ pick: scoreAgent(task, a, skills), rate: successRate?.[a.name] ?? 0 }));
  scored.sort((x, y) => y.pick.score - x.pick.score || y.rate - x.rate);
  return scored[0]!.pick;
}
