// 회의실 API — 제안 하나를 패널들에게 병렬로 던지고 의장이 종합. run 들은
// workflow="meeting:<id>" 로 묶여 있어 그걸 그룹핑해 목록/상세를 만든다.

import { Hono } from "hono";
import { z } from "zod";
import type { RunInfo } from "@loom/core";
import { listMeetingRunsDb, runsByWorkflowDb } from "../db.js";
import { deleteMeeting } from "../run/engine.js";
import { startMeeting } from "../run/meeting.js";
import { deleteSessionArtifacts, sessionArtifactsFromRuns } from "./cli-sessions.js";
import { isResponse, parseBody } from "./helpers.js";
import { logger } from "../logger.js";

export const meetingsRoute = new Hono();

interface Meeting {
  id: string;
  proposal: string;
  startedAt: string;
  panel: RunInfo[];
  chair: RunInfo | null;
}

/** run 들을 meeting id(=workflow)로 묶는다. 제안은 패널 run 의 프롬프트(그대로 전달). */
function groupMeetings(runs: RunInfo[]): Meeting[] {
  const byId = new Map<string, RunInfo[]>();
  for (const r of runs) {
    if (!r.workflow) continue;
    const group = byId.get(r.workflow);
    if (group) group.push(r);
    else byId.set(r.workflow, [r]);
  }
  const meetings: Meeting[] = [];
  for (const [id, group] of byId) {
    const panel = group.filter((r) => r.node === "panel");
    const chair = group.find((r) => r.node === "chair") ?? null;
    meetings.push({
      id,
      proposal: panel[0]?.prompt ?? "",
      startedAt: group[0]?.startedAt ?? "",
      panel,
      chair,
    });
  }
  // 최신 회의 먼저.
  return meetings.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

meetingsRoute.get("/", (c) => {
  const q = c.req.query("projectId");
  const projectId = q === undefined || q === "none" ? null : q;
  return c.json({ meetings: groupMeetings(listMeetingRunsDb(projectId)) });
});

const startSchema = z.object({
  proposal: z.string().trim().min(1).max(20_000),
  participants: z.array(z.string()).min(1),
  projectId: z.string().nullish(),
});

meetingsRoute.post("/", async (c) => {
  const data = await parseBody(c, startSchema);
  if (isResponse(data)) return data;
  const started = await startMeeting({
    proposal: data.proposal,
    participants: data.participants,
    projectId: data.projectId ?? null,
  });
  if (!started.ok) return c.json({ error: started.error }, started.status as 400 | 500);
  return c.json({ meetingId: started.meetingId, panelRunIds: started.panelRunIds });
});

// 회의 삭제 — 패널·의장 run 을 통째로 거둔다(진행 중이면 취소 후). 세션 파일은 run 행을
// 지우기 *전에* 모은다(adapter+session_id 가 사라지면 디스크에서 못 찾으므로).
meetingsRoute.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!id.startsWith("meeting:")) return c.json({ error: "bad_request" }, 400);
  const runs = runsByWorkflowDb(id);
  if (runs.length === 0) return c.json({ error: "not_found" }, 404);
  const freed = deleteSessionArtifacts(sessionArtifactsFromRuns(runs)); // CLI 세션(디스크)
  await deleteMeeting(runs); // 취소·대기 후 run·이벤트·로그 정리
  logger.info({ meetingId: id, removed: runs.length, freedSessionFiles: freed.deletedFiles }, "meeting deleted");
  return c.json({ ok: true, removed: runs.length });
});
