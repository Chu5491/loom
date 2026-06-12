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

  it("reassembles multibyte UTF-8 split across chunk boundaries (Korean survives)", async () => {
    const { onStdout, onStderr, stdout } = captureStreams();
    // dd bs=1 로 1바이트씩 흘려 한글(3바이트)이 반드시 청크 경계에서 잘리게 한다.
    const handle = await spawnProcess({
      command: "/bin/sh",
      args: ["-c", "printf '연동 게이트 한글' | dd bs=1 2>/dev/null"],
      cwd: process.cwd(),
      env: {},
      onStdout,
      onStderr,
    });
    await handle.promise;
    const text = stdout.join("");
    expect(text).toBe("연동 게이트 한글");
    expect(text).not.toContain("�");
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

  it("delivers all stdout before the exit promise resolves ('close' flush)", async () => {
    const { onStdout, onStderr, stdout } = captureStreams();
    // 'exit' 기반 resolve 였다면 마지막 버퍼가 promise 해소 후 도착해 유실됐다.
    const handle = await spawnProcess({
      command: "/bin/sh",
      args: ["-c", "printf 'x%.0s' $(seq 1 100000)"],
      cwd: process.cwd(),
      env: {},
      onStdout,
      onStderr,
    });
    await handle.promise;
    expect(stdout.join("").length).toBe(100000);
  });

  it("survives the child exiting before reading large stdin (EPIPE guard)", async () => {
    const { onStdout, onStderr } = captureStreams();
    // stdin 'error' 리스너가 없으면 EPIPE 가 uncaught exception 으로 프로세스를 죽인다.
    const handle = await spawnProcess({
      command: "/bin/sh",
      args: ["-c", "exit 0"],
      cwd: process.cwd(),
      env: {},
      stdin: "x".repeat(1 << 20),
      onStdout,
      onStderr,
    });
    expect((await handle.promise).exitCode).toBe(0);
  });

  it("kills grandchildren via process-group signal", async () => {
    const { onStdout, onStderr, stdout } = captureStreams();
    const handle = await spawnProcess({
      command: "/bin/sh",
      args: ["-c", "sleep 30 & echo $!; wait"],
      cwd: process.cwd(),
      env: {},
      onStdout,
      onStderr,
    });
    await new Promise((r) => setTimeout(r, 100)); // 손자 pid 출력 대기
    const grandchild = Number(stdout.join("").trim());
    expect(grandchild).toBeGreaterThan(0);
    handle.kill();
    await handle.promise;
    await new Promise((r) => setTimeout(r, 100)); // init 의 좀비 수거 대기
    expect(() => process.kill(grandchild, 0)).toThrow(); // ESRCH = 그룹째 죽었음
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
