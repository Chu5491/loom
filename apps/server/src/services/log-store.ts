import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { config, paths } from "../config.js";

export type StreamKind = "stdout" | "stderr";

export interface ChunkEvent {
  ts: string;
  stream: StreamKind;
  data: string;
}

export interface DoneEvent {
  ts: string;
  status: "succeeded" | "failed" | "cancelled";
  exitCode: number | null;
}

export type LogEvent =
  | { kind: "chunk"; chunk: ChunkEvent }
  | { kind: "done"; done: DoneEvent };

export type LogListener = (event: LogEvent) => void;

interface ActiveLog {
  fd: number;
  filePath: string;
  chunks: ChunkEvent[];
  listeners: Set<LogListener>;
  done: DoneEvent | null;
}

const active = new Map<string, ActiveLog>();

export function logPathFor(runId: string): string {
  return path.join(paths.logs, `${runId}.jsonl`);
}

export function startLog(runId: string): string {
  fs.mkdirSync(paths.logs, { recursive: true });
  const filePath = logPathFor(runId);
  const fd = fs.openSync(filePath, "a");
  active.set(runId, {
    fd,
    filePath,
    chunks: [],
    listeners: new Set(),
    done: null,
  });
  return filePath;
}

export function appendChunk(runId: string, stream: StreamKind, data: string): void {
  const log = active.get(runId);
  if (!log) return;
  const chunk: ChunkEvent = { ts: new Date().toISOString(), stream, data };
  log.chunks.push(chunk);
  // 디스크에는 전량 기록, 인메모리 버퍼만 캡 적용 — OOM 방지.
  // 10% 초과 시에만 splice하여 O(n) shift를 amortize.
  const cap = config.maxLogChunksPerRun;
  if (log.chunks.length > cap + Math.ceil(cap * 0.1)) {
    log.chunks.splice(0, log.chunks.length - cap);
  }
  fs.writeSync(log.fd, JSON.stringify({ kind: "chunk", chunk }) + "\n");
  for (const listener of log.listeners) {
    try {
      listener({ kind: "chunk", chunk });
    } catch {
      // listener errors must not break log writes
    }
  }
}

export function finishLog(runId: string, done: DoneEvent): void {
  const log = active.get(runId);
  if (!log) return;
  log.done = done;
  fs.writeSync(log.fd, JSON.stringify({ kind: "done", done }) + "\n");
  fs.closeSync(log.fd);
  for (const listener of log.listeners) {
    try {
      listener({ kind: "done", done });
    } catch {
      // listener errors must not break log finalization
    }
  }
  // keep entry briefly so subscribers attached during finalization can drain;
  // remove on next tick.
  setImmediate(() => active.delete(runId));
}

export interface SubscribeOptions {
  onEvent: LogListener;
}

export interface SubscribeResult {
  /** Snapshot of chunks emitted before subscription. Send these first. */
  replay: ChunkEvent[];
  /** Already-finished done event, if the run completed before subscription. */
  alreadyDone: DoneEvent | null;
  /** Detach listener. */
  unsubscribe: () => void;
}

export function subscribeActive(
  runId: string,
  opts: SubscribeOptions,
): SubscribeResult | null {
  const log = active.get(runId);
  if (!log) return null;
  log.listeners.add(opts.onEvent);
  return {
    replay: [...log.chunks],
    alreadyDone: log.done,
    unsubscribe: () => log.listeners.delete(opts.onEvent),
  };
}

export function isActive(runId: string): boolean {
  return active.has(runId);
}

export async function readLogFile(filePath: string): Promise<LogEvent[]> {
  if (!fs.existsSync(filePath)) return [];
  const events: LogEvent[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as LogEvent);
    } catch {
      // skip malformed lines
    }
  }
  return events;
}

/** For tests: drain in-memory state. */
export function _resetLogStore(): void {
  for (const log of active.values()) {
    try {
      fs.closeSync(log.fd);
    } catch {
      // ignore
    }
  }
  active.clear();
}
