// "에이전트가 지금 어떤 도구를 쓰고 있는지" — 사무실 뷰의 책상 위 활동 표시용.
// active-touches가 "어떤 파일을 만지는가"라면 이건 "어떤 손에 뭘 들었는가".
// 같은 in-memory 패턴 — run 끝나면 비움. tool은 짧고 휘발성 정보라 영속 X.

import type { ActiveTool, ActiveToolsForAgent, ToolUse } from "@loom/core";

interface RunEntry {
  agentId: string;
  projectId: string;
  recent: ActiveTool[];
  mcpServers: Set<string>;
}

// 책상 한 곳에 16개 이상은 노이즈. 한 run이 너무 많이 쓰면 뒤로 굴림.
const MAX_RECENT = 16;

const runs = new Map<string, RunEntry>();

export function startToolTracking(args: {
  runId: string;
  agentId: string;
  projectId: string;
}): void {
  runs.set(args.runId, {
    agentId: args.agentId,
    projectId: args.projectId,
    recent: [],
    mcpServers: new Set(),
  });
}

export function recordTools(runId: string, tools: ToolUse[]): void {
  const entry = runs.get(runId);
  if (!entry) return;
  const now = new Date().toISOString();
  for (const t of tools) {
    entry.recent.push({ ts: now, name: t.name, target: t.target });
    if (t.name.startsWith("mcp__")) {
      // 패턴: mcp__<server>__<method>. server만 따로 모음.
      const parts = t.name.split("__");
      if (parts.length >= 2 && parts[1]) {
        entry.mcpServers.add(parts[1]);
      }
    }
  }
  if (entry.recent.length > MAX_RECENT) {
    entry.recent.splice(0, entry.recent.length - MAX_RECENT);
  }
}

export function stopToolTracking(runId: string): void {
  runs.delete(runId);
}

export function listToolsForProject(projectId: string): ActiveToolsForAgent[] {
  const out: ActiveToolsForAgent[] = [];
  for (const [runId, entry] of runs) {
    if (entry.projectId !== projectId) continue;
    if (entry.recent.length === 0) continue;
    out.push({
      agentId: entry.agentId,
      runId,
      projectId: entry.projectId,
      recent: [...entry.recent],
      mcpServers: [...entry.mcpServers],
    });
  }
  return out;
}
