// 서버 설정. v2: CLI 허브 + office-as-code.
//   office/  = git 커밋되는 정의 (rules/skills/mcp/agents/workflows)
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

// 동시 CLI run 한도 — 스케줄×트리거×위임이 겹쳐도 머신이 폭주하지 않게.
// 위임 자식은 한도를 우회(부모가 슬롯을 쥔 채 기다리므로 — 데드락 방지).
const rawMax = process.env.LOOM_MAX_RUNS ?? "4";
const maxConcurrentRuns = Number(rawMax);
if (!Number.isInteger(maxConcurrentRuns) || maxConcurrentRuns < 1) {
  throw new Error(`LOOM_MAX_RUNS 값이 잘못됨: "${rawMax}" — 1 이상 정수 필요`);
}

export const config = { port, host, home, maxConcurrentRuns } as const;

export const paths = {
  office: path.join(home, "office"),
  data: path.join(home, "data"),
  logs: path.join(home, "data", "logs"),
  loadouts: path.join(home, "data", "loadouts"),
  db: path.join(home, "data", "loom.db"), // 런 기록(history) — 정의 아님. gitignore.
} as const;
