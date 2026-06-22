// useRunStream 의 까다로운 순수 로직 — 단위 테스트 가능하도록 분리(EventSource·setState 와 격리).

import type { RunStatus } from "@loom/core";

/** EventSource `error` 의 상태 전이. CLOSED 는 영구 실패(run 소실 등) → running 이었을
 *  때만 failed 로(이미 끝난 상태는 보존). 그 외(CONNECTING)는 브라우저가 자동 재접속
 *  중이므로 상태를 건드리지 않는다 — 여기서 failed 로 굳히면 내장 재연결이 죽는다. */
export function streamStatusOnError(isClosed: boolean, prev: RunStatus): RunStatus {
  return isClosed && prev === "running" ? "failed" : prev;
}

/** SSE 페이로드 한 줄을 안전 파싱 — 깨진 JSON 한 줄이 스트림 전체를 죽이면 안 되므로 null. */
export function parsePayload<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
