// stdout 청크를 가로채 비용/세션id/touched 파일을 추출하는 tap factory들.
// 각 tap은 독립적이고 순서 무관. executeRun이 onStdout에서 모두 호출.
//
// 모든 tapper는 lineBuffer()를 공유해 partial-line 잘림을 방지.
// child process의 stdout은 chunk 경계가 JSON 라인과 일치한다는 보장이 없음 —
// 버퍼링 없이 raw chunk를 JSON.parse하면 잘린 라인에서 파싱 실패.

import type { CliAdapter } from "@loom/core";
import { setRunCostUsd, setRunUsage, setRunSessionId } from "../../db/runs.js";
import { recordDelegation, completeDelegation } from "../../db/delegations.js";
import { recordEdits, recordPaths } from "../active-touches.js";
import { recordTools } from "../active-tools.js";

/** 줄 단위 버퍼. chunk가 "\n" 경계와 일치하지 않으면 잔여를 다음 호출로 이월.
 *  flush()로 프로세스 종료 시 마지막 잔여 라인을 처리. */
function lineBuffer(onLines: (complete: string) => void): {
  feed: (chunk: string) => void;
  flush: () => void;
} {
  let buf = "";
  return {
    feed(chunk) {
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      if (lines.length > 0) onLines(lines.join("\n") + "\n");
    },
    flush() {
      if (buf.trim()) {
        onLines(buf + "\n");
        buf = "";
      }
    },
  };
}

export function makeCostTapper(runId: string): {
  tap: (chunk: string) => void;
  flush: () => void;
} {
  const lb = lineBuffer((complete) => {
    for (const raw of complete.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || !line.includes('"total_cost_usd"')) continue;
      try {
        const j = JSON.parse(line) as {
          type?: string;
          total_cost_usd?: number;
          usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
          };
          modelUsage?: Record<string, unknown>;
        };
        if (j.type !== "result" || typeof j.total_cost_usd !== "number") continue;
        setRunCostUsd(runId, j.total_cost_usd);
        if (j.usage) {
          const model = j.modelUsage ? Object.keys(j.modelUsage)[0] ?? null : null;
          setRunUsage(runId, {
            inputTokens: j.usage.input_tokens ?? 0,
            outputTokens: j.usage.output_tokens ?? 0,
            cacheReadTokens: j.usage.cache_read_input_tokens ?? 0,
            cacheWriteTokens: j.usage.cache_creation_input_tokens ?? 0,
            model,
          });
        }
      } catch {
        /* malformed JSON */
      }
    }
  });
  return { tap: lb.feed, flush: lb.flush };
}

// 같은 session id가 여러 이벤트(init/assistant/result)에 반복 등장 — 첫 발견에 latch.
export function makeSessionIdTapper(
  runId: string,
  adapter: CliAdapter,
): { tap: (chunk: string) => void; flush: () => void } {
  let latched = false;
  const lb = lineBuffer((complete) => {
    if (latched || !adapter.extractSessionId) return;
    const sid = adapter.extractSessionId(complete);
    if (sid) {
      setRunSessionId(runId, sid);
      latched = true;
    }
  });
  return { tap: lb.feed, flush: lb.flush };
}

// extractTouchedEdits가 있으면 우선 (라인 정보 포함), 없으면 paths로 폴백.
export function makeTouchesTapper(
  runId: string,
  adapter: CliAdapter,
): { tap: (chunk: string) => void; flush: () => void } {
  const lb = lineBuffer((complete) => {
    if (adapter.extractTouchedEdits) {
      const edits = adapter.extractTouchedEdits(complete);
      if (edits.length > 0) recordEdits(runId, edits);
      return;
    }
    if (adapter.extractTouchedPaths) {
      const paths = adapter.extractTouchedPaths(complete);
      if (paths.length > 0) recordPaths(runId, paths);
    }
  });
  return { tap: lb.feed, flush: lb.flush };
}

// 모든 tool_use 이벤트(파일 수정 + Read/Bash/Grep/MCP/...)를 모음. Office 뷰의
// 책상 위 "지금 들고 있는 도구" 표시 + MCP 서버 chip용. 어댑터가 미지원이면 no-op.
export function makeToolsTapper(
  runId: string,
  adapter: CliAdapter,
): { tap: (chunk: string) => void; flush: () => void } {
  const lb = lineBuffer((complete) => {
    if (!adapter.extractToolUses) return;
    const tools = adapter.extractToolUses(complete);
    if (tools.length > 0) recordTools(runId, tools);
  });
  return { tap: lb.feed, flush: lb.flush };
}

// Sub-agent delegation (Task/Agent tool 호출) 자동 감지.
// toolCallId → DB delegation id 매핑을 유지해 initiate→complete 페어링.
export function makeDelegationTapper(
  runId: string,
  adapter: CliAdapter,
): { tap: (chunk: string) => void; flush: () => void } {
  const pending = new Map<string, number>();
  const lb = lineBuffer((complete) => {
    if (!adapter.extractDelegations) return;
    const events = adapter.extractDelegations(complete);
    for (const ev of events) {
      if (ev.phase === "initiate") {
        const dbId = recordDelegation({
          parentRunId: runId,
          taskDescription: ev.description,
          targetAgentName: ev.agentName ?? null,
        });
        pending.set(ev.toolCallId, dbId);
      } else {
        const dbId = pending.get(ev.toolCallId);
        if (dbId !== undefined) {
          completeDelegation(dbId, {
            status: ev.status,
            summary: ev.summary,
          });
          pending.delete(ev.toolCallId);
        }
      }
    }
  });
  return { tap: lb.feed, flush: lb.flush };
}
