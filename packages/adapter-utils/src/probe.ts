import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { BinaryStatus } from "@loom/core";

const PROBE_TIMEOUT_MS = 3000;

/**
 * Runs `<command> --version` (or a custom version arg) with a tight timeout
 * and returns a BinaryStatus. Never throws — failures are reported in the
 * returned object.
 */
export async function probeBinary(
  command: string,
  options: { versionArg?: string } = {},
): Promise<BinaryStatus> {
  const versionArg = options.versionArg ?? "--version";
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(command, [versionArg], {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
    } catch (err) {
      resolve({
        available: false,
        command,
        error: (err as Error).message,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    const killTimer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignore — process may already have exited
      }
    }, PROBE_TIMEOUT_MS);

    proc.stdout.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
    proc.stderr.on("data", (b: Buffer) => (stderr += b.toString("utf8")));

    proc.on("error", (err) => {
      clearTimeout(killTimer);
      const msg = (err as NodeJS.ErrnoException).code === "ENOENT"
        ? `not found on PATH (${command})`
        : err.message;
      resolve({ available: false, command, error: msg });
    });

    proc.on("exit", (code) => {
      clearTimeout(killTimer);
      const combined = (stdout + stderr).trim();
      // First non-empty line is almost always the version banner.
      const firstLine = combined.split("\n").find((l) => l.trim()) ?? "";
      const version = parseVersion(firstLine);
      if (code === 0 || version) {
        resolve({
          available: true,
          command,
          version: version ?? (firstLine.slice(0, 80) || undefined),
        });
      } else {
        resolve({
          available: false,
          command,
          error: combined.slice(0, 200) || `exit ${code}`,
        });
      }
    });
  });
}

/** Pulls "1.2.3"-style fragments out of a version banner. */
function parseVersion(line: string): string | null {
  const m = line.match(/(\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?)/);
  return m?.[1] ?? null;
}

export function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function dirExistsAndNotEmpty(p: string): boolean {
  try {
    const stat = fs.statSync(p);
    if (!stat.isDirectory()) return false;
    return fs.readdirSync(p).length > 0;
  } catch {
    return false;
  }
}

export function envIsSet(name: string): boolean {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0;
}

/** Cross-platform home directory expansion for "~/..." paths. */
export function homePath(...segments: string[]): string {
  return path.join(os.homedir(), ...segments);
}
