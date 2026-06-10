// 어댑터 프리미티브 — adapter.ts / manifest.ts / 각 어댑터가 공유하는 최소 타입.
// (v2 office 도메인 타입은 office.ts 에 있음.)

export type AdapterKind =
  | "claude-code"
  | "antigravity"
  | "codex"
  | "opencode"
  | "devin";

/** 에이전트의 adapter 설정 — CLI 명령/모델/env + 어댑터별 자유 필드. */
export interface AdapterConfig {
  command?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
  model?: string;
  [key: string]: unknown;
}

export type McpServerKind = "stdio" | "http" | "sse";

/** MCP 서버 한 개의 런타임 형태 — 어댑터의 applyMcpServers 가 소비.
 *  office/mcp/servers.json 로더가 이 형태로 정규화한다(없는 필드는 기본값).
 *  secret 은 env/headers 값에 "${ENV_NAME}" 참조로 두고 spawn 시점에 resolve. */
export interface McpServer {
  /** .mcp.json 의 키이자 office 안의 고유 이름. */
  name: string;
  description: string | null;
  kind: McpServerKind;
  command: string | null; // stdio
  args: string[];
  env: Record<string, string>;
  url: string | null; // http / sse
  headers: Record<string, string>;
}
