// stdout 청크를 가로채 비용/세션id/touched 파일을 추출하는 tap factory들.
// 각 tap은 독립적이고 순서 무관. executeRun이 onStdout에서 모두 호출.

import type { CliAdapter } from "@loom/core";
import { setRunCostUsd, setRunSessionId } from "../../db/runs.js";
import { recordEdits, recordPaths } from "../active-touches.js";
import { recordTools } from "../active-tools.js";

export function makeCostTapper(runId: string): (chunk: string) => void {
  let buffer = "";
  return (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line || !line.includes('"total_cost_usd"')) continue;
      try {
        const j = JSON.parse(line) as { type?: string; total_cost_usd?: number };
        if (j.type === "result" && typeof j.total_cost_usd === "number") {
          setRunCostUsd(runId, j.total_cost_usd);
        }
      } catch {
        /* malformed JSON */
      }
    }
  };
}

// 같은 session id가 여러 이벤트(init/assistant/result)에 반복 등장 — 첫 발견에 latch.
export function makeSessionIdTapper(
  runId: string,
  adapter: CliAdapter,
): (chunk: string) => void {
  let latched = false;
  return (chunk) => {
    if (latched || !adapter.extractSessionId) return;
    const sid = adapter.extractSessionId(chunk);
    if (sid) {
      setRunSessionId(runId, sid);
      latched = true;
    }
  };
}

// extractTouchedEdits가 있으면 우선 (라인 정보 포함), 없으면 paths로 폴백.
export function makeTouchesTapper(
  runId: string,
  adapter: CliAdapter,
): (chunk: string) => void {
  return (chunk) => {
    if (adapter.extractTouchedEdits) {
      const edits = adapter.extractTouchedEdits(chunk);
      if (edits.length > 0) recordEdits(runId, edits);
      return;
    }
    if (adapter.extractTouchedPaths) {
      const paths = adapter.extractTouchedPaths(chunk);
      if (paths.length > 0) recordPaths(runId, paths);
    }
  };
}

// 모든 tool_use 이벤트(파일 수정 + Read/Bash/Grep/MCP/...)를 모음. Office 뷰의
// 책상 위 "지금 들고 있는 도구" 표시 + MCP 서버 chip용. 어댑터가 미지원이면 no-op.
export function makeToolsTapper(
  runId: string,
  adapter: CliAdapter,
): (chunk: string) => void {
  return (chunk) => {
    if (!adapter.extractToolUses) return;
    const tools = adapter.extractToolUses(chunk);
    if (tools.length > 0) recordTools(runId, tools);
  };
}
