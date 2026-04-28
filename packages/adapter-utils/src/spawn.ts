import { spawn } from "node:child_process";
import type { RunHandle } from "@loom/core";

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
  const proc = spawn(opts.command, opts.args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (opts.signal) {
    const onAbort = () => proc.kill("SIGTERM");
    if (opts.signal.aborted) onAbort();
    else opts.signal.addEventListener("abort", onAbort, { once: true });
  }

  proc.stdout.on("data", (b: Buffer) => opts.onStdout(b.toString("utf8")));
  proc.stderr.on("data", (b: Buffer) => opts.onStderr(b.toString("utf8")));

  const promise = new Promise<{ exitCode: number; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      proc.on("error", reject);
      proc.on("exit", (code, signal) =>
        resolve({ exitCode: code ?? -1, signal }),
      );
    },
  );

  if (opts.stdin) proc.stdin.write(opts.stdin);
  proc.stdin.end();

  return {
    pid: proc.pid ?? -1,
    promise,
    kill: () => proc.kill("SIGTERM"),
  };
}
