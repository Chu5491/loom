import path from "node:path";
import os from "node:os";

const envDataDir = process.env.LOOM_DATA_DIR;
const defaultDataDir = path.join(os.homedir(), ".loom", "data");

export const config = {
  port: Number(process.env.LOOM_PORT ?? 3200),
  host: process.env.LOOM_HOST ?? "127.0.0.1",
  dataDir: envDataDir ?? defaultDataDir,
} as const;

export const paths = {
  db: path.join(config.dataDir, "loom.db"),
  logs: path.join(config.dataDir, "logs"),
  worktrees: path.join(config.dataDir, "worktrees"),
} as const;
