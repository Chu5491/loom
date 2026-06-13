// 스레드 API — 대화 단위. 같은 스레드의 연속 턴은 CLI 세션이 이어진다.

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { deleteThreadDb, getThreadDb, insertThread, listRunsDb, listThreadsDb, renameThreadDb } from "../db.js";
import { deleteRunFiles } from "../run/engine.js";
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

threadsRoute.patch("/:id", async (c) => {
  const data = await parseBody(c, z.object({ name: z.string().trim().min(1).max(80) }));
  if (isResponse(data)) return data;
  if (!getThreadDb(c.req.param("id"))) return c.json({ error: "not_found" }, 404);
  renameThreadDb(c.req.param("id"), data.name);
  return c.json({ ok: true });
});

threadsRoute.delete("/:id", (c) => {
  const id = c.req.param("id");
  if (!getThreadDb(id)) return c.json({ error: "not_found" }, 404);
  // 실행 중 run 이 있는 스레드를 지우면 CLI 프로세스는 계속 도는데 기록과 취소
  // 경로만 사라진다(보이지 않는 고아) — 단건 deleteRun 과 동일하게 409 거부.
  const threadRuns = listRunsDb({ threadId: id });
  if (threadRuns.some((r) => r.status === "running")) {
    return c.json({ error: "still_running" }, 409);
  }
  // DB 행 삭제 전에 각 run 의 로그·프롬프트 파일도 거둔다(고아 파일 방지).
  for (const r of threadRuns) deleteRunFiles(r.id);
  deleteThreadDb(id);
  return c.json({ ok: true });
});
