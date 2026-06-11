// 로컬 디렉토리 탐색 — 프로젝트 폴더 피커용. 브라우저는 보안상 로컬 절대경로를
// 알 수 없으므로, 같은 머신의 서버가 디렉토리 목록만 제공한다(파일은 안 보여줌).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";

export const fsRoute = new Hono();

// ?path= 의 하위 디렉토리 목록. 없으면 홈 디렉토리에서 시작.
fsRoute.get("/dirs", (c) => {
  const raw = c.req.query("path") || os.homedir();
  const abs = path.resolve(raw);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return c.json({ error: "not_a_directory", path: abs }, 400);
  }
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => ({ name: e.name, path: path.join(abs, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const parent = path.dirname(abs);
  return c.json({ path: abs, parent: parent === abs ? null : parent, home: os.homedir(), dirs });
});
