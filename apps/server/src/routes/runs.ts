import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { RunStatus } from "@loom/core";
import { getRun, listRuns } from "../db/runs.js";
import { cancelRun, startRun } from "../services/run-service.js";
import {
  readLogFile,
  subscribeActive,
  type LogEvent,
} from "../services/log-store.js";

const createSchema = z.object({
  agentId: z.string().min(1),
  prompt: z.string().min(1),
  cwd: z.string().optional(),
  parentRunId: z.string().nullable().optional(),
  attachedSpecIds: z.array(z.string()).optional(),
});

export const runsRoute = new Hono();

runsRoute.get("/", (c) => {
  const agentId = c.req.query("agentId") ?? undefined;
  const parentRunId = c.req.query("parentRunId") ?? undefined;
  const status = c.req.query("status") as RunStatus | undefined;
  const limitRaw = c.req.query("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  const runs = listRuns({ agentId, parentRunId, status, limit });
  return c.json({ runs });
});

runsRoute.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  }
  const result = await startRun(parsed.data);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ run: result.run }, 201);
});

runsRoute.get("/:id", (c) => {
  const run = getRun(c.req.param("id"));
  if (!run) return c.json({ error: "not_found" }, 404);
  return c.json({ run });
});

/**
 * The last `type: result` text from the run's stdout — what the CLI
 * declared as its final answer. Used for "Forward to another agent" so
 * the user can route an agent's output without manually copying it.
 */
runsRoute.get("/:id/result", async (c) => {
  const run = getRun(c.req.param("id"));
  if (!run) return c.json({ error: "not_found" }, 404);
  if (!run.logPath) return c.json({ resultText: null });
  const events = await readLogFile(run.logPath).catch(() => []);
  let buffer = "";
  let resultText: string | null = null;
  for (const ev of events) {
    if (ev.kind !== "chunk" || ev.chunk.stream !== "stdout") continue;
    buffer += ev.chunk.data;
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const line of parts) {
      if (!line) continue;
      try {
        const j = JSON.parse(line) as { type?: string; result?: string };
        if (j.type === "result" && typeof j.result === "string") {
          resultText = j.result;
        }
      } catch {
        // skip non-JSON lines
      }
    }
  }
  return c.json({ resultText });
});

runsRoute.post("/:id/cancel", (c) => {
  const result = cancelRun(c.req.param("id"));
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ ok: true });
});

runsRoute.get("/:id/logs", (c) => {
  const id = c.req.param("id");
  const run = getRun(id);
  if (!run) return c.json({ error: "not_found" }, 404);

  return streamSSE(c, async (stream) => {
    const send = async (event: LogEvent) => {
      await stream.writeSSE({
        event: event.kind,
        data: JSON.stringify(event.kind === "chunk" ? event.chunk : event.done),
      });
    };

    const queue: LogEvent[] = [];
    let resolveNext: (() => void) | null = null;
    const subscription = subscribeActive(id, {
      onEvent: (event) => {
        queue.push(event);
        resolveNext?.();
        resolveNext = null;
      },
    });

    if (!subscription) {
      // Terminal: replay from log file.
      if (run.logPath) {
        for (const event of await readLogFile(run.logPath)) {
          await send(event);
        }
      }
      return;
    }

    try {
      for (const chunk of subscription.replay) {
        await send({ kind: "chunk", chunk });
      }
      if (subscription.alreadyDone) {
        await send({ kind: "done", done: subscription.alreadyDone });
        return;
      }

      const onAbort = () => {
        resolveNext?.();
        resolveNext = null;
      };
      c.req.raw.signal.addEventListener("abort", onAbort, { once: true });

      try {
        while (!c.req.raw.signal.aborted) {
          if (queue.length === 0) {
            await new Promise<void>((r) => {
              resolveNext = r;
            });
          }
          while (queue.length > 0) {
            const event = queue.shift()!;
            await send(event);
            if (event.kind === "done") return;
          }
        }
      } finally {
        c.req.raw.signal.removeEventListener("abort", onAbort);
      }
    } finally {
      subscription.unsubscribe();
    }
  });
});
