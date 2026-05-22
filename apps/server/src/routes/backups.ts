import { Hono } from "hono";
import { createBackup, listBackups } from "../services/backup.js";

export const backupsRoute = new Hono();

backupsRoute.get("/", (c) => c.json(listBackups()));

backupsRoute.post("/", async (c) => {
  const info = await createBackup();
  return c.json(info, 201);
});
