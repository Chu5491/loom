// 백업 내보내기 — office(정의) + loom.db(기록) + standup/analysis 를 한 zip 으로.
// data/ 는 gitignore 라 머신 손상·실수 삭제 시 복구 수단이 없었다 — 수동 백업 경로.
// 로그(data/logs)는 GB 급일 수 있어 기본 제외(?logs=1 로 포함).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { Hono } from "hono";
import { paths } from "../config.js";
import { backupDb } from "../db.js";
import { logger } from "../logger.js";

export const backupRoute = new Hono();

backupRoute.get("/", async (c) => {
  const includeLogs = c.req.query("logs") === "1";
  // loom.db 는 열려 있으므로 일관 스냅샷을 임시 파일로 먼저 뜬다(WAL 중간 상태 회피).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-backup-"));
  const dbSnapshot = path.join(tmp, "loom.db");
  try {
    await backupDb(dbSnapshot);
    const zip = new AdmZip();
    if (fs.existsSync(paths.office)) zip.addLocalFolder(paths.office, "office");
    zip.addLocalFile(dbSnapshot, "data");
    for (const sub of ["standup", "analysis"]) {
      const dir = path.join(paths.data, sub);
      if (fs.existsSync(dir)) zip.addLocalFolder(dir, `data/${sub}`);
    }
    if (includeLogs && fs.existsSync(paths.logs)) zip.addLocalFolder(paths.logs, "data/logs");

    const buf = zip.toBuffer();
    // 파일명에 날짜를 박는다(서버 now — Date 는 라우트에서 허용).
    const stamp = new Date().toISOString().slice(0, 10);
    return c.body(buf, 200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="loom-backup-${stamp}.zip"`,
    });
  } catch (e) {
    logger.error({ err: e }, "backup export failed");
    return c.json({ error: (e as Error).message }, 500);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
