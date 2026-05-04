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
  // 에이전트별 loadout(스킬 markdown + MCP 설정)이 사는 곳. 매 run마다 그 에이전트의
  // 디렉터리만 다시 그림. CLI에는 이 경로를 프롬프트로 알려줘 필요할 때 Read로 가져가게.
  agents: path.join(config.dataDir, "agents"),
} as const;
