import { spawn, exec } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { RunHandle } from "@loom/core";
import { withAugmentedPath } from "./env.js";

const IS_WIN = process.platform === "win32";

/** SIGTERM 을 무시하는 CLI 대비 — 이 유예 안에 안 죽으면 SIGKILL 승격. */
const KILL_GRACE_MS = 5_000;

/** 프로세스 그룹 종료 — SIGTERM 후 유예 내 안 죽으면 SIGKILL 승격.
 *  detached spawn 으로 자식이 그룹 리더라, 음수 pid 시그널로 CLI 가 띄운
 *  손자(MCP stdio 서버, bash 도구)까지 함께 거둔다. 직계만 죽이면 고아가 남는다.
 *  부팅 시 고아 프로세스 회수에도 재사용(주의: 하드 크래시~부팅 사이 pid 가
 *  재사용되면 다른 그룹을 건드릴 수 있는 best-effort — 직접 kill 의 본질적 한계). */
export function killProcessGroup(pid: number | undefined): void {
  if (pid === undefined || pid <= 0) return;
  if (IS_WIN) {
    try { exec(`taskkill /PID ${pid} /T /F`).unref(); } catch { /* process may have exited */ }
    return;
  }
  const group = -pid;
  try {
    process.kill(group, "SIGTERM");
  } catch {
    return; // 이미 종료된 그룹
  }
  const escalate = setTimeout(() => {
    try { process.kill(group, "SIGKILL"); } catch { /* 유예 중 종료됨 */ }
  }, KILL_GRACE_MS);
  escalate.unref();
}

function killProc(pid: number | undefined): void {
  killProcessGroup(pid);
}

export interface SpawnProcessOptions {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  /** Sent to the child's stdin and immediately closed. Empty string sends nothing. */
  stdin?: string;
  signal?: AbortSignal;
  onStdout: (chunk: string) => void;
  onStderr: (chunk: string) => void;
}

export async function spawnProcess(opts: SpawnProcessOptions): Promise<RunHandle> {
  // shell:true on Windows would open a command injection surface (command comes
  // from user-editable AdapterConfig). Instead, append .cmd suffix on Windows
  // so Node can resolve npm-installed .cmd shims without a shell.
  const resolvedCmd = IS_WIN && !opts.command.includes("\\") && !opts.command.includes("/")
    ? `${opts.command}.cmd`
    : opts.command;

  // detached: POSIX 에서 자식을 프로세스 그룹 리더로 — killProc 의 그룹 시그널 전제.
  const spawnOpts = {
    cwd: opts.cwd,
    // 서버를 어떻게 띄웠든 설치된 CLI 를 찾도록 PATH 에 알려진 설치 디렉토리 보강.
    env: withAugmentedPath({ ...process.env, ...opts.env }),
    stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"],
    detached: !IS_WIN,
  };

  let proc;
  try {
    proc = spawn(resolvedCmd, opts.args, spawnOpts);
  } catch {
    // .cmd resolution failed — fall back to original command name.
    proc = spawn(opts.command, opts.args, spawnOpts);
  }

  if (opts.signal) {
    const onAbort = () => killProc(proc.pid);
    if (opts.signal.aborted) onAbort();
    else opts.signal.addEventListener("abort", onAbort, { once: true });
  }

  // 청크가 UTF-8 멀티바이트 문자(한글 3바이트 등) 중간에서 잘리면 chunk 별
  // toString 은 양쪽을 U+FFFD 로 깨뜨린다 — StringDecoder 가 경계를 이어붙인다.
  const outDec = new StringDecoder("utf8");
  const errDec = new StringDecoder("utf8");
  proc.stdout.on("data", (b: Buffer) => opts.onStdout(outDec.write(b)));
  proc.stderr.on("data", (b: Buffer) => opts.onStderr(errDec.write(b)));
  proc.stdout.on("end", () => { const tail = outDec.end(); if (tail) opts.onStdout(tail); });
  proc.stderr.on("end", () => { const tail = errDec.end(); if (tail) opts.onStderr(tail); });

  const promise = new Promise<{ exitCode: number; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      proc.on("error", reject);
      // 'exit' 시점엔 stdio 버퍼에 미전달 데이터가 남을 수 있다 — 'close'(전 스트림
      // flush 후)에서 resolve 해야 마지막 출력이 run 마감 전에 consume 된다.
      // 단, 손자가 stdout 파이프를 물려받아 안 닫으면 'close' 가 영영 안 오므로
      // 'exit' 후 유예 타이머를 폴백으로 둔다 (먼저 오는 쪽이 이긴다).
      let exited: { exitCode: number; signal: NodeJS.Signals | null } | null = null;
      proc.on("close", (code, signal) =>
        resolve(exited ?? { exitCode: code ?? -1, signal }),
      );
      proc.on("exit", (code, signal) => {
        exited = { exitCode: code ?? -1, signal };
        const fallback = setTimeout(() => resolve(exited!), 2_000);
        fallback.unref();
      });
    },
  );

  // EPIPE 가드 — 자식이 stdin 을 읽기 전에 죽으면(인증 실패 즉시 종료 등) 스트림
  // 'error' 가 뜨고, 리스너가 없으면 uncaught exception 으로 서버 전체가 죽는다.
  proc.stdin.on("error", () => {});
  if (opts.stdin) proc.stdin.write(opts.stdin);
  proc.stdin.end();

  return {
    pid: proc.pid ?? -1,
    promise,
    kill: () => killProc(proc.pid),
  };
}
