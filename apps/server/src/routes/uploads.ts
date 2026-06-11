// 첨부 업로드 — 컴포저에 드롭/붙여넣은 파일(이미지 포함)을 data/uploads/ 에 저장하고
// 절대경로를 돌려준다. 프롬프트의 [Files] 블록에 실려 에이전트가 Read 로 읽는다.
// 기록(data/)이므로 gitignore — 프로젝트 디렉토리를 더럽히지 않는다.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { paths } from "../config.js";
import { isResponse, parseBody } from "./helpers.js";

export const uploadsRoute = new Hono();

const MAX_BYTES = 10 * 1024 * 1024; // 10MB

const schema = z.object({
  filename: z.string().min(1).max(200),
  dataBase64: z.string().min(1).max(15_000_000), // ~10MB raw
});

function safeBasename(raw: string): string {
  const base = path.basename(raw).normalize("NFKC").replace(/[^\w.\-가-힣 ]+/g, "_").slice(0, 120);
  return base || "file";
}

uploadsRoute.post("/", async (c) => {
  const data = await parseBody(c, schema);
  if (isResponse(data)) return data;
  const buf = Buffer.from(data.dataBase64, "base64");
  if (buf.length > MAX_BYTES) return c.json({ error: "file_too_large" }, 413);
  const dir = path.join(paths.data, "uploads", randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, safeBasename(data.filename));
  fs.writeFileSync(abs, buf);
  return c.json({ path: abs, name: path.basename(abs), bytes: buf.length }, 201);
});
