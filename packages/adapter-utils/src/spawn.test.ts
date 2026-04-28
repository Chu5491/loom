import { describe, it, expect } from "vitest";
import { spawnProcess } from "./spawn.js";

function captureStreams() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    onStdout: (c: string) => stdout.push(c),
    onStderr: (c: string) => stderr.push(c),
  };
}

describe("spawnProcess", () => {
  it("pipes stdin to the process and forwards stdout", async () => {
    const { onStdout, onStderr, stdout } = captureStreams();
    const handle = await spawnProcess({
      command: "/bin/cat",
      args: [],
      cwd: process.cwd(),
      env: {},
      stdin: "ping\n",
      onStdout,
      onStderr,
    });
    const result = await handle.promise;
    expect(result.exitCode).toBe(0);
    expect(stdout.join("")).toBe("ping\n");
    expect(handle.pid).toBeGreaterThan(0);
  });

  it("forwards stderr to onStderr", async () => {
    const { onStdout, onStderr, stdout, stderr } = captureStreams();
    const handle = await spawnProcess({
      command: "/bin/sh",
      args: ["-c", "echo err 1>&2; echo out"],
      cwd: process.cwd(),
      env: {},
      onStdout,
      onStderr,
    });
    await handle.promise;
    expect(stdout.join("")).toContain("out");
    expect(stderr.join("")).toContain("err");
  });

  it("propagates non-zero exit codes", async () => {
    const { onStdout, onStderr } = captureStreams();
    const handle = await spawnProcess({
      command: "/bin/sh",
      args: ["-c", "exit 7"],
      cwd: process.cwd(),
      env: {},
      onStdout,
      onStderr,
    });
    expect((await handle.promise).exitCode).toBe(7);
  });

  it("kills the process when AbortSignal fires", async () => {
    const ctrl = new AbortController();
    const { onStdout, onStderr } = captureStreams();
    const handle = await spawnProcess({
      command: "/bin/sh",
      args: ["-c", "sleep 30"],
      cwd: process.cwd(),
      env: {},
      signal: ctrl.signal,
      onStdout,
      onStderr,
    });
    setTimeout(() => ctrl.abort(), 50);
    expect((await handle.promise).signal).toBe("SIGTERM");
  });

  it("merges env: process < adapter < spawn (spawn wins)", async () => {
    const { onStdout, onStderr, stdout } = captureStreams();
    process.env.LOOM_TEST_BASELINE = "from-process";
    const handle = await spawnProcess({
      command: "/bin/sh",
      args: ["-c", "echo $LOOM_TEST_OVERRIDE-$LOOM_TEST_BASELINE"],
      cwd: process.cwd(),
      env: { LOOM_TEST_OVERRIDE: "from-spawn" },
      onStdout,
      onStderr,
    });
    await handle.promise;
    expect(stdout.join("").trim()).toBe("from-spawn-from-process");
    delete process.env.LOOM_TEST_BASELINE;
  });
});
