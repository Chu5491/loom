import { spawn, exec } from "node:child_process";
import type { RunHandle } from "@loom/core";

const IS_WIN = process.platform === "win32";

function killProc(pid: number | undefined): void {
  if (pid === undefined) return;
  if (IS_WIN) {
    try { exec(`taskkill /PID ${pid} /T /F`).unref(); } catch { /* process may have exited */ }
  } else {
    try { process.kill(pid, "SIGTERM"); } catch { /* process may have exited */ }
  }
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

  let proc;
  try {
    proc = spawn(resolvedCmd, opts.args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    // .cmd resolution failed — fall back to original command name.
    proc = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  if (opts.signal) {
    const onAbort = () => killProc(proc.pid);
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
    kill: () => killProc(proc.pid),
  };
}
