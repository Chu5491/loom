import { exec as execCb, spawn } from "node:child_process";

const IS_WIN = process.platform === "win32";

export interface SpawnCaptureResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Set when the process was killed by our timeout. */
  timedOut: boolean;
}

/**
 * Runs a command and captures stdout/stderr. Used by adapters to ask the CLI
 * "list your models" / "what's your version" / etc. without going through any
 * provider HTTP API — the CLI's own auth and config decide what comes back.
 */
export async function spawnCapture(
  command: string,
  args: string[],
  options: { timeoutMs?: number; cwd?: string } = {},
): Promise<SpawnCaptureResult> {
  return new Promise((resolve) => {
    // Windows: .cmd shim resolution (same pattern as spawn.ts / probe.ts).
    const resolvedCmd = IS_WIN && !command.includes("\\") && !command.includes("/")
      ? `${command}.cmd`
      : command;

    let proc;
    try {
      proc = spawn(resolvedCmd, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
        cwd: options.cwd,
      });
    } catch (err) {
      resolve({
        exitCode: -1,
        stdout: "",
        stderr: (err as Error).message,
        timedOut: false,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const killTimer = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform === "win32" && proc.pid) {
          execCb(`taskkill /PID ${proc.pid} /T /F`).unref();
        } else {
          proc.kill("SIGKILL");
        }
      } catch {
        // process may already have exited
      }
    }, options.timeoutMs ?? 15_000);

    proc.stdout.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
    proc.stderr.on("data", (b: Buffer) => (stderr += b.toString("utf8")));

    proc.on("error", (err) => {
      clearTimeout(killTimer);
      const code = (err as NodeJS.ErrnoException).code;
      resolve({
        exitCode: -1,
        stdout,
        stderr: code === "ENOENT" ? `not found on PATH: ${command}` : err.message,
        timedOut,
      });
    });

    proc.on("exit", (code) => {
      clearTimeout(killTimer);
      resolve({ exitCode: code ?? -1, stdout, stderr, timedOut });
    });
  });
}

/** Strip ANSI color codes commonly present in CLI output. */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
