// 프로젝트 API — 로컬 작업 디렉토리 등록/목록/삭제.
// 경로는 머신별이라 data/(gitignore)에 기록. 등록 시 실제 존재+디렉토리 검증.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { paths } from "../config.js";
import { deleteProjectCascadeDb, getProjectDb, insertProject, listProjectsDb, listRunsDb, projectPathExists } from "../db.js";
import { searchFiles } from "../files.js";
import { deleteRunFiles } from "../run/engine.js";
import { deleteSessionArtifacts, sessionArtifactsFromRuns } from "./cli-sessions.js";
import { logger } from "../logger.js";
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
  const id = c.req.param("id");
  // 캐스케이드 — 프로젝트의 대화(스레드)·run·이벤트·그 run 들이 만든 CLI 세션·로그를 함께
  // 정리("프로젝트→대화→CLI세션 일괄삭제"). 세션·로그는 run 행을 지우기 *전에* 모은다
  // (adapter+session_id 가 사라지면 디스크에서 못 찾으므로).
  const runs = listRunsDb({ projectId: id });
  const freed = deleteSessionArtifacts(sessionArtifactsFromRuns(runs)); // CLI 세션(디스크)
  for (const r of runs) deleteRunFiles(r.id); // raw 로그 파일
  deleteProjectCascadeDb(id); // runs + 이벤트 + threads + project 행
  // 프로젝트별 기록(분석·스탠드업)은 projectId 로 키된 data/ 파일 — 같이 거둔다.
  if (/^[0-9a-f-]{36}$/.test(id)) {
    for (const sub of ["analysis", "standup"]) {
      try {
        fs.rmSync(path.join(paths.data, sub, `${id}.json`), { force: true });
      } catch {
        // 없거나 권한 — 무해
      }
    }
  }
  logger.info(
    { projectId: id, removedRuns: runs.length, freedSessionFiles: freed.deletedFiles, freedBytes: freed.freedBytes },
    "project deleted (cascade)",
  );
  return c.json({ ok: true });
});

// 파일 검색 — Talk 컴포저 @file 멘션. ?q= substring, 최대 20개 상대경로.
projectsRoute.get("/:id/files", (c) => {
  const project = getProjectDb(c.req.param("id"));
  if (!project) return c.json({ error: "not_found" }, 404);
  const q = c.req.query("q") ?? "";
  return c.json({ files: searchFiles(project.path, q) });
});
