import { Hono } from "hono";
import { z } from "zod";
import { isResponse, parseBody } from "./helpers.js";
import {
  buildGeminiSnippet,
  getGeminiSyncStatus,
  runGeminiSync,
  setGeminiSyncEnabled,
} from "../services/gemini-sync.js";

export const geminiSyncRoute = new Hono();

geminiSyncRoute.get("/status", (c) => {
  return c.json({ status: getGeminiSyncStatus() });
});

/** 카탈로그가 변경 안 됐어도 사용자가 명시적으로 "지금 동기화" 누를 때.
 *  enabled=false여도 force=true면 한 번은 돈다. */
geminiSyncRoute.post("/run", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const force = !!(body as { force?: boolean }).force;
  const report = runGeminiSync({ force });
  return c.json({
    report,
    status: getGeminiSyncStatus(),
  });
});

const settingsSchema = z.object({
  enabled: z.boolean(),
});

geminiSyncRoute.patch("/settings", async (c) => {
  const data = await parseBody(c, settingsSchema);
  if (isResponse(data)) return data;
  setGeminiSyncEnabled(data.enabled);
  // enable로 토글한 경우엔 곧장 한 번 머지 — 사용자 입장에서 "켰는데 아직 동기화 X"는
  // 직관에 안 맞음.
  if (data.enabled) {
    runGeminiSync();
  }
  return c.json({ status: getGeminiSyncStatus() });
});

/** 사용자가 자동 동기화를 끄고 직접 settings.json에 붙여넣고 싶을 때. */
geminiSyncRoute.get("/snippet", (c) => {
  return c.json({ snippet: buildGeminiSnippet() });
});
