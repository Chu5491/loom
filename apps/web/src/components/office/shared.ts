// Office 화면 공유 — 타입·상수·순수 헬퍼. shell(OfficePage)과 디테일 컴포넌트 양쪽이 import.
// React 컴포넌트는 두지 않는다(import-light 유지).

import type { AdapterKind, McpServer } from "@loom/core";

export const ADAPTERS: AdapterKind[] = ["claude-code", "antigravity", "codex", "opencode", "devin"];
export const MCP_UNSUPPORTED: AdapterKind[] = ["antigravity"];

export const inputCls =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring";
export const areaCls = inputCls + " font-mono text-xs leading-relaxed";

export type Kind = "agent" | "rule" | "skill" | "mcp" | "workflow" | "function" | "prompt";

export type Selection =
  | { kind: "overview" }
  | { kind: "agent"; name: string }
  | { kind: "agent-new" }
  | { kind: "rule"; name: string }
  | { kind: "rule-new" }
  | { kind: "skill"; name: string }
  | { kind: "skill-new" }
  | { kind: "skill-discover" }
  | { kind: "mcp"; name: string }
  | { kind: "mcp-new" }
  | { kind: "workflow"; name?: string }
  | { kind: "prompt"; name: string }
  | { kind: "function"; name: string };

export function t_workflows() {
  // 짧은 헬퍼 — switch 내부에서 hook 을 호출할 수 없어서 분리.
  // (workflow.name 이 있으면 그 이름을 쓰므로 여긴 fallback 일 뿐.)
  return "Workflows";
}

// 공식 출처 강조 — 서버 isOfficialSource 와 동일 목록(품질 신호).
export function isOfficialSourceWeb(owner: string): boolean {
  return ["vercel-labs", "anthropics", "microsoft", "openai"].includes(owner.toLowerCase());
}
export function formatInstalls(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function emptyServer(): McpServer {
  return {
    name: "",
    description: null,
    kind: "stdio",
    command: null,
    args: [],
    env: {},
    url: null,
    headers: {},
  };
}

export function kvToText(o: Record<string, string>): string {
  return Object.entries(o)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

export function textToKv(s: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const line of s.split(/\r?\n/)) {
    const m = line.match(/^([^=]+)=(.*)$/);
    if (m) o[m[1]!.trim()] = m[2]!;
  }
  return o;
}

export function firstLine(body: string): string {
  for (const l of body.split(/\r?\n/)) {
    const t = l.replace(/^#+\s*/, "").trim();
    if (t) return t.slice(0, 90);
  }
  return "";
}
