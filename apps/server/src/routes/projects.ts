// 프로젝트 API — 로컬 작업 디렉토리 등록/목록/삭제.
// 경로는 머신별이라 data/(gitignore)에 기록. 등록 시 실제 존재+디렉토리 검증.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { deleteProjectDb, insertProject, listProjectsDb, projectPathExists } from "../db.js";
import { isResponse, parseBody } from "./helpers.js";

export const projectsRoute = new Hono();

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  path: z.string().trim().min(1),
});

projectsRoute.get("/", (c) => c.json({ projects: listProjectsDb() }));

projectsRoute.post("/", async (c) => {
  const data = await parseBody(c, createSchema);
  if (isResponse(data)) return data;

  const abs = path.resolve(data.path.replace(/^~(?=\/|$)/, process.env.HOME ?? "~"));
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    return c.json({ error: "path_not_found", path: abs }, 400);
  }
  if (!stat.isDirectory()) return c.json({ error: "not_a_directory", path: abs }, 400);
  if (projectPathExists(abs)) return c.json({ error: "already_registered", path: abs }, 409);

  const project = { id: randomUUID(), name: data.name, path: abs, createdAt: new Date().toISOString() };
  insertProject(project);
  return c.json({ project }, 201);
});

projectsRoute.delete("/:id", (c) => {
  deleteProjectDb(c.req.param("id"));
  return c.json({ ok: true });
});
