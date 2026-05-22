import { Hono } from "hono";
import { z } from "zod";
import {
  computeOverall,
  listCiChecks,
  upsertCiCheck,
} from "../db/ci-checks.js";
import { getThread } from "../db/threads.js";
import { getWebhookSecret, rotateWebhookSecret } from "../db/settings.js";
import { isResponse, parseBody } from "./helpers.js";

const ciSchema = z.object({
  threadId: z.string().min(1),
  name: z.string().min(1).max(120),
  status: z.enum(["pending", "running", "success", "failure", "error"]),
  provider: z.enum(["github", "gitlab", "custom"]).optional(),
  detailUrl: z.string().url().max(2048).optional().nullable(),
  sha: z.string().max(80).optional().nullable(),
});

export const webhooksRoute = new Hono();

/**
 * POST /api/webhooks/ci — 외부 CI 시스템이 빌드 결과를 보내는 엔드포인트.
 * Authorization: Bearer <webhook_secret> 필수.
 * (thread_id, name) 기준 upsert — 같은 check 이름은 최신 상태로 갱신.
 */
webhooksRoute.post("/ci", async (c) => {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const token = auth.slice(7);
  if (token !== getWebhookSecret()) {
    return c.json({ error: "invalid_token" }, 403);
  }

  const data = await parseBody(c, ciSchema);
  if (isResponse(data)) return data;

  const thread = getThread(data.threadId);
  if (!thread) {
    return c.json({ error: "thread_not_found" }, 404);
  }

  const check = upsertCiCheck({
    threadId: data.threadId,
    name: data.name,
    status: data.status,
    provider: data.provider,
    detailUrl: data.detailUrl,
    sha: data.sha,
  });
  return c.json({ check }, 200);
});

/**
 * GET /api/webhooks/secret — 현재 webhook secret 조회.
 * UI 설정 페이지에서 복사용. 내부 API이므로 별도 인증 없음.
 */
webhooksRoute.get("/secret", (c) => {
  return c.json({ secret: getWebhookSecret() });
});

/**
 * POST /api/webhooks/secret/rotate — webhook secret 재발급.
 * 기존 token 무효화 + 새 token 생성.
 */
webhooksRoute.post("/secret/rotate", (c) => {
  const secret = rotateWebhookSecret();
  return c.json({ secret });
});
