import type { Context } from "hono";
import type { z } from "zod";
import { NotAGitRepoError } from "../services/git.js";

export async function parseBody<T extends z.ZodTypeAny>(
  c: Context,
  schema: T,
): Promise<z.infer<T> | Response> {
  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "invalid_body", issues: parsed.error.issues },
      400,
    );
  }
  return parsed.data;
}

export function isResponse(v: unknown): v is Response {
  return v instanceof Response;
}

export function gitError(c: Context, err: unknown): Response {
  if (err instanceof NotAGitRepoError) {
    return c.json({ error: "not_a_git_repo" }, 409);
  }
  return c.json(
    { error: "git_failed", message: (err as Error).message },
    500,
  );
}
