import { Hono } from "hono";
import { z } from "zod";
import {
  getAuthStatus,
  listOrgs,
  listRepos,
  searchRepos,
} from "../services/git-account.js";

export const gitAccountRoute = new Hono();

gitAccountRoute.get("/auth-status", async (c) => {
  return c.json(await getAuthStatus());
});

const reposSchema = z
  .object({
    org: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    sort: z.enum(["updated", "name", "stars"]).optional(),
  })
  .optional();

gitAccountRoute.get("/repos", async (c) => {
  const org = c.req.query("org");
  const limit = c.req.query("limit");
  const sort = c.req.query("sort");
  const parsed = reposSchema.safeParse({
    org: org || undefined,
    limit: limit || undefined,
    sort: sort || undefined,
  });
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
  const repos = await listRepos(parsed.data ?? {});
  return c.json({ repos });
});

gitAccountRoute.get("/orgs", async (c) => {
  return c.json({ orgs: await listOrgs() });
});

const searchSchema = z.object({
  q: z.string().min(1).max(256),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

gitAccountRoute.get("/search", async (c) => {
  const q = c.req.query("q");
  const limit = c.req.query("limit");
  const parsed = searchSchema.safeParse({ q, limit: limit || undefined });
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
  const repos = await searchRepos(parsed.data.q, parsed.data.limit);
  return c.json({ repos });
});
