// 서버 설정. 환경 변수를 읽고 유효성 검증. 잘못된 값은 즉시 throw —
// 라이프사이클 초기(index.ts import 시)에 터져야 런타임 중간에 안 터짐.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Raw reads ────────────────────────────────────────────────────────────

const envDataDir = process.env.LOOM_DATA_DIR;
const defaultDataDir = path.join(os.homedir(), ".loom", "data");

const rawPort = process.env.LOOM_PORT ?? "3200";
const port = Number(rawPort);
// 0 = OS가 빈 포트 자동 할당 (테스트용). 실제 서비스에서는 1~65535.
if (!Number.isFinite(port) || port < 0 || port > 65535) {
  throw new Error(
    `LOOM_PORT 값이 잘못됨: "${rawPort}" — 0~65535 사이 정수 필요`,
  );
}

const host = process.env.LOOM_HOST ?? "127.0.0.1";
const dataDir = envDataDir ?? defaultDataDir;

const rawMaxConcurrentRuns = process.env.LOOM_MAX_CONCURRENT_RUNS ?? "10";
const maxConcurrentRuns = Number(rawMaxConcurrentRuns);
if (!Number.isInteger(maxConcurrentRuns) || maxConcurrentRuns < 1) {
  throw new Error(
    `LOOM_MAX_CONCURRENT_RUNS 값이 잘못됨: "${rawMaxConcurrentRuns}" — 1 이상 정수 필요`,
  );
}

const rawMaxLogChunks = process.env.LOOM_MAX_LOG_CHUNKS_PER_RUN ?? "10000";
const maxLogChunksPerRun = Number(rawMaxLogChunks);
if (!Number.isInteger(maxLogChunksPerRun) || maxLogChunksPerRun < 100) {
  throw new Error(
    `LOOM_MAX_LOG_CHUNKS_PER_RUN 값이 잘못됨: "${rawMaxLogChunks}" — 100 이상 정수 필요`,
  );
}

// ── dataDir 보장 ─────────────────────────────────────────────────────────
// 존재하지 않으면 생성. 이미 있으면 noop.
fs.mkdirSync(dataDir, { recursive: true });

// 쓰기 권한 확인 — DB / 로그 / loadout 모두 여기에 의존.
try {
  fs.accessSync(dataDir, fs.constants.W_OK);
} catch {
  throw new Error(
    `LOOM_DATA_DIR "${dataDir}" 에 쓰기 권한 없음`,
  );
}

// ── Export ────────────────────────────────────────────────────────────────

export const config = {
  port,
  host,
  dataDir,
  maxConcurrentRuns,
  maxLogChunksPerRun,
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
