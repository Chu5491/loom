// 스레드 API — 대화 단위. 같은 스레드의 연속 턴은 CLI 세션이 이어진다.

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { deleteThreadDb, getThreadDb, insertThread, listThreadsDb } from "../db.js";
import { isResponse, parseBody } from "./helpers.js";

export const threadsRoute = new Hono();

// ?projectId=<id> 의 스레드들, ?projectId=none 은 오피스 홈.
threadsRoute.get("/", (c) => {
  const q = c.req.query("projectId");
  return c.json({ threads: listThreadsDb(q === undefined || q === "none" ? null : q) });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  projectId: z.string().nullable().optional(),
});
threadsRoute.post("/", async (c) => {
  const data = await parseBody(c, createSchema);
  if (isResponse(data)) return data;
  const thread = {
    id: randomUUID(),
    name: data.name,
    projectId: data.projectId ?? null,
    createdAt: new Date().toISOString(),
  };
  insertThread(thread);
  return c.json({ thread }, 201);
});

threadsRoute.delete("/:id", (c) => {
  if (!getThreadDb(c.req.param("id"))) return c.json({ error: "not_found" }, 404);
  deleteThreadDb(c.req.param("id"));
  return c.json({ ok: true });
});
