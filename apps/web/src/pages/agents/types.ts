// AgentsPage 공유 타입 + 상수.

import type { Agent } from "@loom/core";

export type FormMode = { mode: "create" } | { mode: "edit"; agent: Agent };

export type Autonomy = "read-only" | "suggest" | "auto";
export const AUTONOMY_LEVELS: Autonomy[] = ["read-only", "suggest", "auto"];

export const ROLE_OPTIONS = [
  "engineer",
  "researcher",
  "reviewer",
  "writer",
  "other",
] as const;

// autonomy 필드 도입 전에 만들어진 에이전트는 "auto"로 — 그 시기 동작과 일치.
export function readAutonomy(
  config: Record<string, unknown> | undefined,
): Autonomy {
  const v = config?.autonomy;
  if (v === "read-only" || v === "suggest" || v === "auto") return v;
  return "auto";
}

export function stripUndefined(
  o: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === "") continue;
    out[k] = v;
  }
  return out;
}
