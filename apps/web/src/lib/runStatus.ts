import type { Run, RunStatus } from "@loom/core";

type Variant = "info" | "success" | "destructive" | "warning" | "secondary";

// Run 상태(`succeeded`/`failed`/...)를 Badge 컬러 variant로 매핑.
// 이전엔 Chat / HomePage / ActivityPanel 세 곳에 동일 로직이 중복돼 있었음.
export function runStatusVariant(s: RunStatus | string): Variant {
  switch (s) {
    case "succeeded":
      return "success";
    case "failed":
      return "destructive";
    case "cancelled":
      return "warning";
    case "running":
    case "queued":
      return "info";
    default:
      return "secondary";
  }
}

// Run이 시작된 뒤 경과 초. startedAt이 비어 있으면 createdAt 기준.
export function elapsedSecs(run: Run): number {
  const start = run.startedAt ?? run.createdAt;
  return Math.max(0, Math.floor((Date.now() - new Date(start).getTime()) / 1000));
}
