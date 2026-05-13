// 워크스페이스 settings API.
//   - global rule: 모든 에이전트 프롬프트 위에 prepend 되는 텍스트
//   - external API keys: 마켓플레이스 source (smithery, skills.sh) 의 인증 키

import { Hono } from "hono";
import { z } from "zod";
import { isResponse, parseBody } from "./helpers.js";
import {
  getApiKeyStatuses,
  getSettings,
  setGlobalRule,
  setSkillsShApiKey,
  setSmitheryApiKey,
} from "../db/settings.js";
import { clearSmitheryCache } from "../services/smithery.js";
import { clearSkillsShCache } from "../services/skills-sh.js";

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
  const data = await parseBody(c, putGlobalRuleSchema);
  if (isResponse(data)) return data;
  const updated = setGlobalRule(data.content);
  return c.json({ settings: updated });
});

// ─── External API keys ──────────────────────────────────────────────────
//
// GET → 현재 상태 (configured + source). 실제 값은 절대 보내지 않음.
// PUT → 새 값을 저장 (빈 문자열이면 clear). 캐시는 즉시 invalidate.

settingsRoute.get("/api-keys", (c) => c.json(getApiKeyStatuses()));

const putApiKeysSchema = z
  .object({
    // null = clear, undefined = 변경 안 함, string = 새 값.
    smithery: z.string().max(2048).nullable().optional(),
    skillsSh: z.string().max(2048).nullable().optional(),
  })
  .refine(
    (v) => v.smithery !== undefined || v.skillsSh !== undefined,
    { message: "at least one key must be specified" },
  );

settingsRoute.put("/api-keys", async (c) => {
  const data = await parseBody(c, putApiKeysSchema);
  if (isResponse(data)) return data;
  if (data.smithery !== undefined) {
    setSmitheryApiKey(data.smithery);
    clearSmitheryCache();
  }
  if (data.skillsSh !== undefined) {
    setSkillsShApiKey(data.skillsSh);
    clearSkillsShCache();
  }
  return c.json(getApiKeyStatuses());
});
