// 서버 설정. v2: CLI 허브 + office-as-code.
//   office/  = git 커밋되는 정의 (rules/skills/mcp/agents/workflows)
//   data/    = gitignore 되는 기록 (runs/logs/loadouts)
// 둘 다 리포 루트 기준 (LOOM_HOME 으로 오버라이드 — 다른 오피스 폴더 열 때).

import path from "node:path";

/** env 정수 파싱 + 검증(1 이상). 잘못되면 부팅 즉시 실패(조용한 오작동 방지). */
function posInt(raw: string | undefined, def: number, name: string): number {
  const v = Number(raw ?? String(def));
  if (!Number.isInteger(v) || v < 1) throw new Error(`${name} 값이 잘못됨: "${raw}" — 1 이상 정수 필요`);
  return v;
}

const rawPort = process.env.LOOM_PORT ?? "3200";
const port = Number(rawPort);
if (!Number.isFinite(port) || port < 0 || port > 65535) {
  throw new Error(`LOOM_PORT 값이 잘못됨: "${rawPort}" — 0~65535 사이 정수 필요`);
}

const host = process.env.LOOM_HOST ?? "127.0.0.1";

// 데스크톱 패키징에서만 설정 — 빌드된 웹을 서버와 같은 오리진에서 서빙할 디렉토리.
// dev 에선 미설정(Vite 3201 이 /api 를 프록시). 헌법: 웹은 상대경로만 호출하므로
// 같은 오리진에서 정적 자산을 내주면 /api·SSE 가 그대로 동작한다.
const webDir = process.env.LOOM_WEB_DIR
  ? path.resolve(process.env.LOOM_WEB_DIR)
  : null;

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

// 워크플로우/위임 타이밍(분·건수) — 운영 환경에 맞게 조정. 위임 한 건 한도(delegate)는
// join 대기보다 짧게 두는 게 보통(위임이 join 안에서 끝나도록).
const joinTimeoutMin = posInt(process.env.LOOM_JOIN_TIMEOUT_MIN, 60, "LOOM_JOIN_TIMEOUT_MIN");
const stepTimeoutMin = posInt(process.env.LOOM_STEP_TIMEOUT_MIN, 30, "LOOM_STEP_TIMEOUT_MIN");
const delegateTimeoutMin = posInt(process.env.LOOM_DELEGATE_TIMEOUT_MIN, 10, "LOOM_DELEGATE_TIMEOUT_MIN");
const maxConcurrentDelegations = posInt(process.env.LOOM_MAX_DELEGATIONS, 3, "LOOM_MAX_DELEGATIONS");

// 기록 보존 일수 — ended_at 이 이보다 오래된 run(+로그)을 자동 정리. 0=비활성(무한 보존).
// 헌법: data/ 는 기록일 뿐 — 디스크가 무한정 차지 않게 한다.
const rawRetention = process.env.LOOM_RETENTION_DAYS ?? "30";
const retentionDays = Number(rawRetention);
if (!Number.isInteger(retentionDays) || retentionDays < 0) {
  throw new Error(`LOOM_RETENTION_DAYS 값이 잘못됨: "${rawRetention}" — 0 이상 정수 필요(0=비활성)`);
}

// 새 run 시작 전 요구하는 data/ 디스크 최소 여유(MB). 미만이면 run 을 거부 —
// 디스크가 꽉 찬 채 돌면 raw 쓰기 실패로 run 이 죽고 이벤트를 조용히 잃는다. 0=비활성.
const rawMinFree = process.env.LOOM_MIN_FREE_MB ?? "200";
const minFreeMb = Number(rawMinFree);
if (!Number.isInteger(minFreeMb) || minFreeMb < 0) {
  throw new Error(`LOOM_MIN_FREE_MB 값이 잘못됨: "${rawMinFree}" — 0 이상 정수 필요(0=비활성)`);
}

export const config = {
  port, host, home, maxConcurrentRuns, webDir, retentionDays, minFreeMb,
  joinTimeoutMs: joinTimeoutMin * 60_000,
  stepTimeoutMs: stepTimeoutMin * 60_000,
  delegateTimeoutMs: delegateTimeoutMin * 60_000,
  maxConcurrentDelegations,
} as const;

export const paths = {
  office: path.join(home, "office"),
  data: path.join(home, "data"),
  logs: path.join(home, "data", "logs"),
  loadouts: path.join(home, "data", "loadouts"),
  runPids: path.join(home, "data", "run-pids"), // 살아있는 run 의 그룹 pid — 하드 크래시 후 부팅 시 회수.
  db: path.join(home, "data", "loom.db"), // 런 기록(history) — 정의 아님. gitignore.
} as const;
