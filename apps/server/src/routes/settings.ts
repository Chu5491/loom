// 워크스페이스 settings API. 지금은 global rule 한 가지만.

import { Hono } from "hono";
import { z } from "zod";
import { getSettings, setGlobalRule } from "../db/settings.js";

export const settingsRoute = new Hono();

settingsRoute.get("/", (c) => c.json({ settings: getSettings() }));

settingsRoute.get("/global-rule", (c) =>
  c.json({ content: getSettings().globalRule }),
);

const putGlobalRuleSchema = z.object({
  // 길이 상한 — 매 run prompt prefix 에 들어가서 토큰 비용에 직결됨. 8KB 면
  // 대략 2k 토큰. 그 이상이면 사용자가 spec/스킬로 빼는 게 맞음.
  content: z.string().max(8192),
});

settingsRoute.put("/global-rule", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = putGlobalRuleSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  }
  const updated = setGlobalRule(parsed.data.content);
  return c.json({ settings: updated });
});
