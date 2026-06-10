// 하네스 발화 판정 — 순수 로직, 부수효과 없음. run 완료 시 어떤 엣지가
// 자동 발화하는지 결정하고, 자식 run 의 프롬프트를 조립한다.
// 엔진 배선(자식 spawn)은 engine.ts. 여긴 결정만.

import type { HarnessEdge, HarnessTrigger, RunStatus } from "@loom/core";

/** auto 발화 체인의 최대 hop. parentRunId 깊이로 측정, 무한루프(A→B→A) 방어. */
export const MAX_HARNESS_HOPS = 5;

export interface RunOutcome {
  status: RunStatus;
  /** 이 run 이 만든 file 이벤트 수. on_changes 판정용. */
  changedFileCount: number;
}

/** 한 트리거가 이 결과에 발화하는지. cancelled 는 어떤 트리거에도 발화 안 함. */
export function triggerMatches(trigger: HarnessTrigger, outcome: RunOutcome): boolean {
  switch (trigger) {
    case "on_success":
      return outcome.status === "succeeded";
    case "on_fail":
      return outcome.status === "failed";
    case "on_changes":
      return outcome.status === "succeeded" && outcome.changedFileCount > 0;
    case "manual":
      // 사용자가 명시적으로 누를 때만 — 자동 발화 대상 아님.
      return false;
  }
}

/** 자동 발화할 엣지만 — mode==="auto" + 트리거 일치. ask/manual 은 제외(UI 가 제안). */
export function resolveAutoEdges(edges: HarnessEdge[], outcome: RunOutcome): HarnessEdge[] {
  return edges.filter((e) => e.mode === "auto" && triggerMatches(e.trigger, outcome));
}

/**
 * 발화한 엣지로 자식 run 의 프롬프트를 조립 — 순수 함수.
 * carryResult 가 켜지고 결과가 있으면 *명시적으로 마크된 블록*으로 prepend
 * (자동주입 금지: 몰래 끼우지 않고 출처를 드러냄). 그 뒤 엣지 지시문.
 * 둘 다 비면 최소 안내문 — 빈 프롬프트로 CLI 를 띄우지 않도록.
 */
export function buildHandoffPrompt(args: {
  edgePrompt: string | undefined;
  carryResult: boolean;
  fromAgentName: string;
  fromRunId: string;
  resultText: string | null;
}): string {
  const sections: string[] = [];
  if (args.carryResult && args.resultText?.trim()) {
    sections.push(
      `=== Result from @${args.fromAgentName} (run ${args.fromRunId.slice(0, 8)}) ===\n` +
        `${args.resultText.trim()}\n` +
        `=== End Result ===`,
    );
  }
  const instruction = args.edgePrompt?.trim();
  if (instruction) sections.push(instruction);
  if (sections.length === 0) {
    sections.push(`Continue from @${args.fromAgentName}'s last run.`);
  }
  return sections.join("\n\n");
}
