// 런 API — 시작(POST), 목록/단건(GET), 이벤트 스트림(SSE), 취소.

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { isResponse, parseBody } from "./helpers.js";
import { cancelRun, getRun, listRuns, startRun, subscribe } from "../run/engine.js";

export const runsRoute = new Hono();

const startSchema = z.object({
  agent: z.string().min(1),
  prompt: z.string().min(1),
  cwd: z.string().optional(),
});

runsRoute.get("/", (c) => c.json({ runs: listRuns() }));

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

runsRoute.post("/:id/cancel", (c) =>
  cancelRun(c.req.param("id"))
    ? c.json({ ok: true })
    : c.json({ error: "not_active" }, 409),
);

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
      await stream.writeSSE({ event: "error", data: JSON.stringify({ error: "not_found" }) });
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
