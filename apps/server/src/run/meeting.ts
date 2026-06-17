// 회의실 — 하나의 제안을 여러 에이전트에게 동시에 던지고, 각자 독립적으로 의견·
// 계획을 낸 뒤(병렬 1라운드), 의장 에이전트가 전부 모아 합의안/실행계획으로 정리.
//
// 헌법: 제안은 패널에게 그대로 전달(자동주입 없음). 패널 의견은 신뢰 불가 자료라
// 데이터 펜스로 감싸 의장에게 넘긴다(위임·standup 과 같은 정책).
//
// 별도 스레드/스키마 없이 기존 run 컬럼만 재사용: workflow="meeting:<id>" 로 한
// 회의의 run 들을 묶고, node="panel"|"chair" 로 역할을 구분한다. retention 도
// 일반 run 과 똑같이 적용된다(특수 처리 불필요).

import { randomUUID } from "node:crypto";
import type { OfficeEvent } from "@loom/core";
import { getRunEventsDb } from "../db.js";
import { logger } from "../logger.js";
import { readAgents, readFunction } from "../office.js";
import { getRun, startRun, waitForRun } from "./engine.js";
import { fenceHandoff } from "./workflow.js";

// 패널 의견을 기다리는 상한 — 코딩 에이전트의 실제 작업 단위를 고려해 넉넉히.
const PANEL_TIMEOUT_MS = 20 * 60_000;

export interface MeetingInput {
  proposal: string;
  participants: string[]; // 패널 에이전트 이름들
  projectId?: string | null;
}

export interface Opinion {
  agent: string;
  text: string;
}

/** 순수 — 의장에게 줄 종합 입력. 제안 + 각 패널 의견(데이터 펜스). */
export function composeMeetingSynthesis(proposal: string, opinions: Opinion[]): string {
  const panel = opinions
    .map((o) => `### @${o.agent}\n${fenceHandoff(o.text)}`)
    .join("\n\n");
  return `## Proposal\n${proposal}\n\n## Panel opinions\n${panel}`;
}

function lastResultText(runId: string): string | null {
  const result = [...getRunEventsDb(runId)].reverse().find(
    (e): e is Extract<OfficeEvent, { kind: "result" }> => e.kind === "result",
  );
  return result?.text ?? null;
}

/** 회의 시작 — 패널 run 들을 병렬로 띄우고 즉시 반환(UI 가 스트리밍). 패널이 모두
 *  끝나면 백그라운드에서 의장 종합 run 을 띄운다. */
export async function startMeeting(
  input: MeetingInput,
): Promise<{ ok: true; meetingId: string; panelRunIds: string[] } | { ok: false; status: number; error: string }> {
  const known = new Set(readAgents().map((a) => a.name));
  const participants = [...new Set(input.participants)].filter((n) => known.has(n));
  if (participants.length === 0) return { ok: false, status: 400, error: "no_valid_participants" };

  const meetingId = `meeting:${randomUUID()}`;
  const started = await Promise.all(
    participants.map((agent) =>
      startRun({ agent, prompt: input.proposal, projectId: input.projectId, workflow: meetingId, node: "panel" }),
    ),
  );
  const panelRunIds = started.filter((s) => s.ok).map((s) => (s as { run: { id: string } }).run.id);
  if (panelRunIds.length === 0) return { ok: false, status: 500, error: "no_panelist_started" };

  // fire-and-forget — 패널 대기 + 의장 종합. 내부에서 모든 에러 처리.
  void runSynthesis(input, meetingId, panelRunIds).catch((err) =>
    logger.error({ err, meetingId }, "meeting synthesis threw"),
  );
  return { ok: true, meetingId, panelRunIds };
}

async function runSynthesis(input: MeetingInput, meetingId: string, panelRunIds: string[]): Promise<void> {
  const opinions = await Promise.all(
    panelRunIds.map(async (id): Promise<Opinion> => {
      try {
        await waitForRun(id, PANEL_TIMEOUT_MS);
      } catch {
        // 타임아웃이어도 그때까지의 출력으로 진행 — 종합은 도착한 의견으로 한다.
      }
      return { agent: getRun(id)?.agent ?? "?", text: lastResultText(id) ?? "(no output)" };
    }),
  );
  // 의장 = 기능(office). 사용자가 고르는 게 아니라 meeting 기능의 어댑터·모델로 종합.
  const fn = readFunction("meeting");
  const result = await startRun({
    fn: { name: fn.name, adapter: fn.adapter, model: fn.model },
    prompt: composeMeetingSynthesis(input.proposal, opinions),
    promptOverride: fn.prompt,
    projectId: input.projectId,
    workflow: meetingId,
    node: "chair",
  });
  if (!result.ok) logger.warn({ meetingId, error: result.error }, "meeting chair run did not start");
}
