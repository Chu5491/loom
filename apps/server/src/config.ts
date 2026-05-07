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
  // git URL 로 만든 프로젝트의 clone 이 사는 곳. 폴더명은 project id.
  // 사용자가 "Local path" 로 만든 프로젝트는 여기 안 들어옴 — 사용자 path 그대로 사용.
  repos: path.join(config.dataDir, "repos"),
} as const;
