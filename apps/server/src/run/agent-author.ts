// 프롬프트로 에이전트 초안 생성 — LLM 이 실재하는 office 자원(스킬·mcp·rule·어댑터)만
// 골라 AgentSpec 을 설계한다. 환각 참조는 서버가 정화하고 warning 으로 알린다.
// 저장은 하지 않는다(초안 반환 → 사용자 검토 후 PUT /agents/:name).

import type { AdapterKind, AgentSpec } from "@loom/core";
import { listAdapterKinds, probeAdapter } from "../adapters/registry.js";
import { readFunction, readMcp, readRules, readSkills } from "../office.js";
import { extractJson, runAuthor } from "./author.js";

// LLM 이 준 이름을 안전한 식별자로 정리(safeName 은 검증만 하고 throw 하므로 직접 청소).
// 허용 외 문자 제거 + 영숫자로 시작 보장, 비면 fallback.
function cleanName(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  const cleaned = s.replace(/[^a-zA-Z0-9_-]/g, "").replace(/^[_-]+/, "");
  return cleaned || "new-agent";
}

export interface AgentDraft {
  draft: AgentSpec;
  /** 환각·미등록 참조를 걸러냈을 때의 안내(사용자 검토용). */
  warnings: string[];
}

interface OfficeNames {
  skills: Set<string>;
  mcp: Set<string>;
  rules: Set<string>;
  adapters: Set<string>;
}

/** LLM 이 뱉은 raw 초안을 실재 자원으로 정화 — 순수. 테스트 대상.
 *  존재하지 않는 skill/mcp/rule 은 버리고, 미등록 adapter 는 fallback 으로 클램프. */
export function sanitizeAgentDraft(
  raw: unknown,
  names: OfficeNames,
  fallbackAdapter: AdapterKind,
): AgentDraft {
  const warnings: string[] = [];
  const r = (raw ?? {}) as Record<string, unknown>;

  const name = cleanName(r.name);

  let adapter = fallbackAdapter;
  if (typeof r.adapter === "string" && names.adapters.has(r.adapter)) adapter = r.adapter as AdapterKind;
  else if (r.adapter) warnings.push(`unknown adapter "${String(r.adapter)}" → using ${fallbackAdapter}`);

  // 존재하는 이름만 남긴다 — 모르는 건 버리고 한 번에 묶어 알린다.
  const keep = (vals: unknown, set: Set<string>, kind: string): string[] | undefined => {
    if (!Array.isArray(vals)) return undefined;
    const ok: string[] = [];
    const dropped: string[] = [];
    for (const v of vals) {
      if (typeof v !== "string") continue;
      if (set.has(v)) ok.push(v);
      else dropped.push(v);
    }
    if (dropped.length) warnings.push(`dropped unknown ${kind}: ${dropped.join(", ")}`);
    return ok.length ? ok : undefined;
  };

  const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
    typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;

  const draft: AgentSpec = {
    name,
    adapter,
    ...(typeof r.label === "string" && r.label.trim() ? { label: r.label.trim() } : {}),
    ...(typeof r.model === "string" && r.model.trim() ? { model: r.model.trim() } : {}),
    ...(oneOf(r.reasoning, ["high", "medium", "low"] as const) ? { reasoning: r.reasoning as AgentSpec["reasoning"] } : {}),
    ...(oneOf(r.permission, ["default", "acceptEdits", "bypass"] as const) ? { permission: r.permission as AgentSpec["permission"] } : {}),
    ...(r.delegate === true ? { delegate: true } : {}),
    ...(typeof r.prompt === "string" && r.prompt.trim() ? { prompt: r.prompt } : {}),
    ...(keep(r.rules, names.rules, "rules") ? { rules: keep(r.rules, names.rules, "rules") } : {}),
    ...(keep(r.skills, names.skills, "skills") ? { skills: keep(r.skills, names.skills, "skills") } : {}),
    ...(keep(r.mcp, names.mcp, "mcp") ? { mcp: keep(r.mcp, names.mcp, "mcp") } : {}),
  };
  return { draft, warnings };
}

/** authoring run 에 줄 컨텍스트 — 모델이 고를 수 있는 실재 자원 목록. */
async function buildContext(prompt: string): Promise<string> {
  const skills = readSkills().map((s) => ({ name: s.name, description: s.description }));
  const mcp = readMcp().map((m) => ({ name: m.name, description: m.description }));
  const rules = readRules().map((r) => r.name);
  const probes = await Promise.all(
    listAdapterKinds().map(async (kind) => {
      const p = await probeAdapter(kind).catch(() => null);
      return { adapter: kind, authenticated: p?.auth?.state === "authenticated" };
    }),
  );
  return JSON.stringify(
    { request: prompt, available: { adapters: probes, skills, mcp, rules } },
    null,
    2,
  );
}

export async function generateAgentDraft(prompt: string): Promise<AgentDraft> {
  const fn = readFunction("agent-author");
  const context = await buildContext(prompt);
  const out = await runAuthor("agent-author", context);
  const raw = extractJson(out);

  const kinds = listAdapterKinds();
  const names: OfficeNames = {
    skills: new Set(readSkills().map((s) => s.name)),
    mcp: new Set(readMcp().map((m) => m.name)),
    rules: new Set(readRules().map((r) => r.name)),
    adapters: new Set(kinds),
  };
  // fallback 어댑터 — agent-author 기능의 어댑터(인증돼 동작 중)를 기본값으로.
  const fallback = (kinds.includes(fn.adapter) ? fn.adapter : kinds[0]) as AdapterKind;
  return sanitizeAgentDraft(raw, names, fallback);
}
