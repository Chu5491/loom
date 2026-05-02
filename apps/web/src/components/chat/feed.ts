// runs[] → ThreadGroup[] 시간순 피드 변환.

import { useMemo } from "react";
import type { Agent, Run } from "@loom/core";
import {
  CONTINUATION_WINDOW_MS,
  dayKey,
  type FeedItem,
  type ThreadGroup,
} from "./utils.js";

function workingAgentIdsFromRuns(runs: Run[]): Set<string> {
  const out = new Set<string>();
  for (const r of runs) {
    if (r.status === "queued" || r.status === "running") out.add(r.agentId);
  }
  return out;
}

// 50단계 cap — 무한 루프 방어용.
function rootRunId(run: Run, byId: Map<string, Run>): string {
  let cur = run;
  let depth = 0;
  while (cur.parentRunId && depth < 50) {
    const parent = byId.get(cur.parentRunId);
    if (!parent) break;
    cur = parent;
    depth++;
  }
  return cur.id;
}

function buildThreadGroups(runs: Run[]): ThreadGroup[] {
  const byId = new Map(runs.map((r) => [r.id, r]));
  const groups = new Map<string, Run[]>();
  for (const r of runs) {
    const key = r.threadId ?? rootRunId(r, byId);
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }
  const threads: ThreadGroup[] = [];
  for (const [rootId, ofThread] of groups) {
    const sorted = [...ofThread].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    const items: FeedItem[] = [];
    for (const r of sorted) {
      items.push({ kind: "user", run: r, ts: r.createdAt, senderId: "user" });
      items.push({
        kind: "agent",
        run: r,
        ts: r.startedAt ?? r.createdAt,
        senderId: r.agentId,
      });
    }
    items.sort((a, b) => a.ts.localeCompare(b.ts));
    threads.push({
      rootId,
      runs: sorted,
      items,
      firstTs: items[0]!.ts,
      lastTs: items[items.length - 1]!.ts,
    });
  }
  threads.sort((a, b) => a.lastTs.localeCompare(b.lastTs));
  return threads;
}

export function useRoomDerived(
  runs: Run[],
  agents: Agent[],
): {
  threads: ThreadGroup[];
  working: Agent[];
  workingIds: Set<string>;
} {
  return useMemo(() => {
    const workingIds = workingAgentIdsFromRuns(runs);
    return {
      threads: buildThreadGroups(runs),
      working: agents.filter((a) => workingIds.has(a.id)),
      workingIds,
    };
  }, [runs, agents]);
}

export function isContinuation(curr: FeedItem, prev: FeedItem | undefined): boolean {
  if (!prev) return false;
  if (prev.senderId !== curr.senderId) return false;
  if (dayKey(prev.ts) !== dayKey(curr.ts)) return false;
  const delta = new Date(curr.ts).getTime() - new Date(prev.ts).getTime();
  return delta < CONTINUATION_WINDOW_MS;
}

export function findParentAgent(
  run: Run,
  thread: ThreadGroup,
  agents: Agent[],
): Agent | undefined {
  if (!run.parentRunId) return undefined;
  const parent = thread.runs.find((r) => r.id === run.parentRunId);
  if (!parent) return undefined;
  return agents.find((a) => a.id === parent.agentId);
}
