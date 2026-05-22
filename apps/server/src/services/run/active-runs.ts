// 활성 run의 AbortController를 가지고 있는 인메모리 맵. 서버 재시작 시 비고,
// markOrphanedRunsFailed가 startup에서 정리.

import { getRun } from "../../db/runs.js";

const activeRuns = new Map<string, { abort: AbortController }>();

// Synchronous counter incremented *before* any await in startRun,
// so concurrent requests cannot all pass the limit check.
let pendingCount = 0;

export function reserveRunSlot(): void { pendingCount++; }
export function releaseRunSlot(): void { pendingCount = Math.max(0, pendingCount - 1); }

export function trackActiveRun(runId: string, abort: AbortController): void {
  activeRuns.set(runId, { abort });
}

export function untrackActiveRun(runId: string): void {
  activeRuns.delete(runId);
}

export type CancelResult =
  | { ok: true }
  | { ok: false; status: 404 | 409; error: string };

export function cancelRun(runId: string): CancelResult {
  const active = activeRuns.get(runId);
  if (!active) {
    const run = getRun(runId);
    if (!run) return { ok: false, status: 404, error: "not_found" };
    return { ok: false, status: 409, error: `not_active: ${run.status}` };
  }
  active.abort.abort();
  return { ok: true };
}

export function isRunActive(runId: string): boolean {
  return activeRuns.has(runId);
}

export function activeRunCount(): number {
  return activeRuns.size + pendingCount;
}

export function _activeRunIds(): string[] {
  return [...activeRuns.keys()];
}
