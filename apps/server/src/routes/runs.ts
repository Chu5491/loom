// 런 API — 시작(POST), 목록/단건(GET), 이벤트 스트림(SSE), 취소.

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { isResponse, parseBody } from "./helpers.js";
import { readAgents, readSkills } from "../office.js";
import { pickAgent } from "../run/dispatch.js";
import { cancelRun, deleteRun, fireManualHandoff, getPersistedRun, getRun, listRuns, startRun, subscribe } from "../run/engine.js";

export const runsRoute = new Hono();

const startSchema = z.object({
  agent: z.string().min(1),
  prompt: z.string().min(1),
  cwd: z.string().optional(),
  projectId: z.string().optional(),
  skills: z.array(z.string()).optional(),
});

// ?projectId=<id> 로 스코프, ?projectId=none 으로 프로젝트 없는 run 만, 없으면 전체.
runsRoute.get("/", (c) => {
  const q = c.req.query("projectId");
  const filter = q === undefined ? undefined : q === "none" ? null : q;
  return c.json({ runs: listRuns(filter) });
});

runsRoute.post("/", async (c) => {
  const data = await parseBody(c, startSchema);
  if (isResponse(data)) return data;
  const result = await startRun(data);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ run: result.run }, 201);
});

runsRoute.get("/:id", (c) => {
  const run = getRun(c.req.param("id"));
  if (!run) return c.json({ error: "not_found" }, 404);
  return c.json({ run });
});

// 스마트 디스패치 — 작업 설명으로 적합 에이전트를 골라 run 시작.
// 라우팅일 뿐 주입 아님: 프롬프트는 적은 그대로 전달된다.
const dispatchSchema = z.object({
  prompt: z.string().min(1),
  projectId: z.string().optional(),
  skills: z.array(z.string()).optional(),
});
runsRoute.post("/dispatch", async (c) => {
  const data = await parseBody(c, dispatchSchema);
  if (isResponse(data)) return data;
  const pick = pickAgent(data.prompt, readAgents(), readSkills());
  if (!pick) return c.json({ error: "no_agents" }, 400);
  const result = await startRun({ ...data, agent: pick.agent });
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ run: result.run, pick }, 201);
});

runsRoute.delete("/:id", (c) => {
  const r = deleteRun(c.req.param("id"));
  return r.ok ? c.json({ ok: true }) : c.json({ error: r.error }, r.status);
});

runsRoute.post("/:id/cancel", (c) =>
  cancelRun(c.req.param("id"))
    ? c.json({ ok: true })
    : c.json({ error: "not_active" }, 409),
);

// ask/manual 엣지 수동 발화 — body: { to: agentName }.
const handoffSchema = z.object({ to: z.string().min(1) });
runsRoute.post("/:id/handoff", async (c) => {
  const data = await parseBody(c, handoffSchema);
  if (isResponse(data)) return data;
  const result = await fireManualHandoff(c.req.param("id"), data.to);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ run: result.run }, 201);
});

// SSE — replay(이미 나온 이벤트) → 라이브 → done. 순서 보장을 위해 큐로 직렬화.
runsRoute.get("/:id/events", (c) => {
  const id = c.req.param("id");
  return streamSSE(c, async (stream) => {
    type Msg = { kind: "event"; event: unknown } | { kind: "done"; run: unknown };
    const queue: Msg[] = [];
    let wake: (() => void) | null = null;
    let aborted = false;

    const sub = subscribe(id, (msg) => {
      queue.push(msg as Msg);
      wake?.();
    });
    if (!sub) {
      // 인메모리에 없음 — 재시작 후의 완료 run 이면 디스크 기록에서 정적 복원.
      const persisted = getPersistedRun(id);
      if (!persisted) {
        await stream.writeSSE({ event: "error", data: JSON.stringify({ error: "not_found" }) });
        return;
      }
      for (const ev of persisted.events) {
        await stream.writeSSE({ event: "event", data: JSON.stringify({ kind: "event", event: ev }) });
      }
      await stream.writeSSE({ event: "done", data: JSON.stringify({ kind: "done", run: persisted.run }) });
      return;
    }
    // 구독 시점 스냅샷을 큐 앞에 — 등록 이후 들어온 라이브 이벤트보다 먼저 나가도록.
    queue.unshift(...sub.replay.map((ev) => ({ kind: "event" as const, event: ev })));
    if (sub.done) queue.push({ kind: "done", run: sub.done });

    c.req.raw.signal.addEventListener("abort", () => {
      aborted = true;
      sub.off();
      wake?.();
    }, { once: true });

    while (!aborted) {
      while (queue.length) {
        const msg = queue.shift()!;
        await stream.writeSSE({ event: msg.kind, data: JSON.stringify(msg) });
        if (msg.kind === "done") {
          sub.off();
          return;
        }
      }
      await new Promise<void>((r) => (wake = r));
    }
    sub.off();
  });
});
