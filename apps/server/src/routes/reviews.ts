import { Hono } from "hono";
import { z } from "zod";
import { getReview, listReviewsByThread, updateReviewStatus } from "../db/reviews.js";
import { requestReview } from "../services/review-service.js";

const createSchema = z.object({
  threadId: z.string().min(1),
  reviewerAgentId: z.string().min(1),
});

const statusSchema = z.object({
  status: z.enum(["approved", "changes_requested"]),
});

export const reviewsRoute = new Hono();

// POST /api/reviews — 리뷰 요청 (리뷰어 에이전트 run 생성)
reviewsRoute.post("/", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  const result = await requestReview(parsed.data);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ review: result.review }, 201);
});

// GET /api/reviews?threadId=… — 스레드별 리뷰 목록
reviewsRoute.get("/", (c) => {
  const threadId = c.req.query("threadId");
  if (!threadId) return c.json({ error: "threadId required" }, 400);
  const reviews = listReviewsByThread(threadId);
  return c.json({ reviews });
});

// GET /api/reviews/:id
reviewsRoute.get("/:id", (c) => {
  const review = getReview(c.req.param("id"));
  if (!review) return c.json({ error: "not_found" }, 404);
  return c.json({ review });
});

// PATCH /api/reviews/:id — 상태 변경 (approved / changes_requested)
reviewsRoute.patch("/:id", async (c) => {
  const review = getReview(c.req.param("id"));
  if (!review) return c.json({ error: "not_found" }, 404);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const parsed = statusSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }

  updateReviewStatus(review.id, parsed.data.status);
  return c.json({ review: { ...review, status: parsed.data.status } });
});
