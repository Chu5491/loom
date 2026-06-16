// 회의실 API — 제안 하나를 패널들에게 병렬로 던지고 의장이 종합. run 들은
// workflow="meeting:<id>" 로 묶여 있어 그걸 그룹핑해 목록/상세를 만든다.

import { Hono } from "hono";
import { z } from "zod";
import type { RunInfo } from "@loom/core";
import { listMeetingRunsDb } from "../db.js";
import { startMeeting } from "../run/meeting.js";
import { isResponse, parseBody } from "./helpers.js";

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
  chair: z.string().min(1),
  projectId: z.string().nullish(),
});

meetingsRoute.post("/", async (c) => {
  const data = await parseBody(c, startSchema);
  if (isResponse(data)) return data;
  const started = await startMeeting({
    proposal: data.proposal,
    participants: data.participants,
    chair: data.chair,
    projectId: data.projectId ?? null,
  });
  if (!started.ok) return c.json({ error: started.error }, started.status as 400 | 500);
  return c.json({ meetingId: started.meetingId, panelRunIds: started.panelRunIds });
});
