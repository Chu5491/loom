// 서버 설정. v2: CLI 허브 + office-as-code.
//   office/  = git 커밋되는 정의 (rules/skills/mcp/agents/harness)
//   data/    = gitignore 되는 기록 (runs/logs/loadouts)
// 둘 다 리포 루트 기준 (LOOM_HOME 으로 오버라이드 — 다른 오피스 폴더 열 때).

import path from "node:path";

const rawPort = process.env.LOOM_PORT ?? "3200";
const port = Number(rawPort);
if (!Number.isFinite(port) || port < 0 || port > 65535) {
  throw new Error(`LOOM_PORT 값이 잘못됨: "${rawPort}" — 0~65535 사이 정수 필요`);
}

const host = process.env.LOOM_HOST ?? "127.0.0.1";

// 리포 루트 = apps/server 에서 두 단계 위. LOOM_HOME 으로 임의 오피스 폴더 지정 가능.
const home = process.env.LOOM_HOME
  ? path.resolve(process.env.LOOM_HOME)
  : path.resolve(process.cwd(), "..", "..");

export const config = { port, host, home } as const;

export const paths = {
  office: path.join(home, "office"),
  data: path.join(home, "data"),
  logs: path.join(home, "data", "logs"),
  loadouts: path.join(home, "data", "loadouts"),
} as const;
