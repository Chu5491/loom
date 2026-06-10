// 헤드리스 진입점 — GUI 없이 엔진을 직접 부른다. B 아키텍처("엔진 + 클라이언트")의
// 두 번째 클라이언트. 같은 boot() + 같은 services 를 HTTP 없이 재사용.
//
// 이 진입점이 스케줄링(#6)의 기반 primitive 다 — cron 이 호출할 한 줄이
// `loom run --agent <id> --prompt "..."` 이다.
//
//   loom projects                              프로젝트 목록 (id 찾기용)
//   loom agents [--project <id>]               에이전트 목록
//   loom runs   [--agent <id>] [--limit N]     최근 run 목록
//   loom run --agent <id> --prompt "<text>"    run 실행 + 종료까지 스트리밍
//            [--cwd <path>] [--fresh]          종료코드 = run 성공 여부

import { boot } from "./boot.js";
import { closeDb } from "./db/client.js";
import { listProjects } from "./db/projects.js";
import { getAgent, listAgents } from "./db/agents.js";
import { getRun, listRuns } from "./db/runs.js";
import { listSchedules } from "./db/schedules.js";
import { listHarnessEdges } from "./db/harness-edges.js";
import { startRun } from "./services/run-service.js";
import { subscribeActive } from "./services/log-store.js";

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string | true>;
}

// --key value | --flag | positional. 값 없는 마지막 --flag 는 boolean true.
function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (tok.startsWith("--")) {
      const key = tok.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, true);
      }
    } else {
      positionals.push(tok);
    }
  }
  return { positionals, flags };
}

function str(flags: Map<string, string | true>, key: string): string | undefined {
  const v = flags.get(key);
  return typeof v === "string" ? v : undefined;
}

function fail(message: string): never {
  process.stderr.write(`loom: ${message}\n`);
  closeDb();
  process.exit(2);
}

const HELP = `loom — headless engine CLI

  loom projects                              list projects
  loom agents [--project <id>]               list agents
  loom runs   [--agent <id>] [--limit N]     list recent runs
  loom schedules [--agent <id>]              list scheduled runs
  loom harness --project <id>                list agent handoff edges
  loom run --agent <id> --prompt "<text>"    start a run, stream to exit
           [--cwd <path>] [--fresh]          exit code 0 = succeeded
`;

function cmdProjects(): void {
  const rows = listProjects();
  if (rows.length === 0) {
    process.stdout.write("(no projects)\n");
    return;
  }
  for (const p of rows) {
    process.stdout.write(`${p.id}  ${p.name}  ${p.path}\n`);
  }
}

function cmdAgents(flags: Map<string, string | true>): void {
  const projectId = str(flags, "project");
  const rows = listAgents(projectId ? { projectId } : {});
  if (rows.length === 0) {
    process.stdout.write("(no agents)\n");
    return;
  }
  for (const a of rows) {
    process.stdout.write(`${a.id}  ${a.name}  [${a.adapterKind}]\n`);
  }
}

function cmdRuns(flags: Map<string, string | true>): void {
  const agentId = str(flags, "agent");
  const limitRaw = str(flags, "limit");
  const limit = limitRaw ? Number(limitRaw) : 20;
  if (!Number.isInteger(limit) || limit < 1) fail(`bad --limit: ${limitRaw}`);
  const rows = listRuns({ agentId, limit });
  if (rows.length === 0) {
    process.stdout.write("(no runs)\n");
    return;
  }
  for (const r of rows) {
    const cost = r.costUsd != null ? ` $${r.costUsd.toFixed(4)}` : "";
    const head = r.prompt.replace(/\s+/g, " ").slice(0, 48);
    process.stdout.write(`${r.id}  ${r.status.padEnd(9)}${cost}  ${head}\n`);
  }
}

function cmdSchedules(flags: Map<string, string | true>): void {
  const agentId = str(flags, "agent");
  const rows = listSchedules(agentId ? { agentId } : {});
  if (rows.length === 0) {
    process.stdout.write("(no schedules)\n");
    return;
  }
  for (const s of rows) {
    const state = s.enabled ? "on " : "off";
    const next = s.nextFireAt ? `next ${s.nextFireAt}` : "next —";
    process.stdout.write(
      `${s.id}  ${state}  ${s.cron.padEnd(16)} ${next}  ${s.name}\n`,
    );
  }
}

function cmdHarness(flags: Map<string, string | true>): void {
  const projectId = str(flags, "project");
  if (!projectId) fail("harness requires --project <id>");
  const edges = listHarnessEdges(projectId);
  if (edges.length === 0) {
    process.stdout.write("(no harness edges)\n");
    return;
  }
  const nameOf = (id: string) => getAgent(id)?.name ?? id.slice(0, 8);
  for (const e of edges) {
    const carry = e.carryResult ? " +carry" : "";
    process.stdout.write(
      `${nameOf(e.fromAgentId)} -> ${nameOf(e.toAgentId)}  [${e.trigger}/${e.mode}${carry}]\n`,
    );
  }
}

async function cmdRun(flags: Map<string, string | true>): Promise<void> {
  const agentId = str(flags, "agent");
  const prompt = str(flags, "prompt");
  if (!agentId) fail("run requires --agent <id>");
  if (!prompt) fail("run requires --prompt <text>");

  const res = await startRun({
    agentId,
    prompt,
    cwd: str(flags, "cwd"),
    freshSession: flags.get("fresh") === true,
  });
  if (!res.ok) fail(`${res.error} (${res.status})`);

  const runId = res.run.id;
  process.stderr.write(`loom: run ${runId} started\n`);

  // 활성 로그 구독 — replay(이미 나온 청크) → 라이브 청크 → done 에서 resolve.
  await new Promise<void>((resolve) => {
    const sub = subscribeActive(runId, {
      onEvent: (ev) => {
        if (ev.kind === "chunk") {
          const out = ev.chunk.stream === "stderr" ? process.stderr : process.stdout;
          out.write(ev.chunk.data);
        } else {
          resolve();
        }
      },
    });
    if (!sub) {
      // 구독 전에 이미 끝났거나 로그가 사라짐 — 폴링 없이 즉시 종료.
      resolve();
      return;
    }
    for (const c of sub.replay) {
      const out = c.stream === "stderr" ? process.stderr : process.stdout;
      out.write(c.data);
    }
    if (sub.alreadyDone) resolve();
  });

  const final = getRun(runId);
  process.stderr.write(`loom: run ${runId} ${final?.status ?? "unknown"}\n`);
  closeDb();
  process.exit(final?.status === "succeeded" ? 0 : 1);
}

async function main(): Promise<void> {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const cmd = positionals[0];

  if (!cmd || cmd === "help" || flags.get("help") === true) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  boot();

  switch (cmd) {
    case "projects":
      cmdProjects();
      break;
    case "agents":
      cmdAgents(flags);
      break;
    case "runs":
      cmdRuns(flags);
      break;
    case "schedules":
      cmdSchedules(flags);
      break;
    case "harness":
      cmdHarness(flags);
      break;
    case "run":
      await cmdRun(flags); // exits internally
      return;
    default:
      fail(`unknown command: ${cmd}\n\n${HELP}`);
  }

  closeDb();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`loom: ${(err as Error).message}\n`);
  closeDb();
  process.exit(1);
});
