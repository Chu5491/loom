import { Hono } from "hono";
import { search } from "../db/search.js";

export const searchRoute = new Hono();

searchRoute.get("/", (c) => {
  const q = c.req.query("q")?.trim();
  if (!q) return c.json({ results: [] });

  const projectId = c.req.query("projectId") ?? undefined;
  const limitRaw = c.req.query("limit");
  const limit = limitRaw ? Math.min(Number(limitRaw), 50) : 20;

  const results = search(q, { projectId, limit });
  return c.json({ results });
});
