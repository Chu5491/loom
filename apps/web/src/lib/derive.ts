// Talk 화면의 순수 변환 로직 — OfficeEvent 스트림 → 표시용 view. 컴포넌트(JSX)와 분리해
// 단위 테스트 가능하게 둔다. deriveView 가 reasoning·토큰·trace·result·report 를 한 번에 추린다.

import { Bot, FilePen, FilePlus2, FileSearch, Globe, Pencil, Plug, Terminal, Workflow, Wrench } from "lucide-react";
import type { OfficeEvent } from "@loom/core";
import { extractReport, type WorkReport } from "./report.js";

export interface TraceItem {
  kind: "tool" | "file" | "handoff";
  name: string; // 도구명 / 파일 action / 대상 에이전트
  target?: string;
  action?: "edit" | "write";
}

export interface DerivedView {
  trace: TraceItem[];
  body: string;
  reasoning?: string;
  report?: WorkReport;
  result?: Extract<OfficeEvent, { kind: "result" }>;
  errors: string[];
  changedFiles: number;
  loadout?: { skills: string[]; mcp: string[]; delegate: boolean };
  /** 누적 토큰(usage 이벤트) — 입력·출력·캐시 적중분. S5 가 캡처, ActivityCard 가 표시. */
  tokens?: { input: number; output: number; cached: number };
}

// 도구 표시명 정리 — mcp__server__tool → server·tool, 그 외는 그대로.
export function prettyTool(name: string): string {
  const m = /^mcp__([^_]+)__(.+)$/.exec(name);
  return m ? `${m[1]}·${m[2]}` : name;
}

export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** 토큰 수 → 짧은 표기(1.2k / 13k). */
export function fmtTok(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

export function deriveView(events: OfficeEvent[]): DerivedView {
  const trace: TraceItem[] = [];
  const texts: string[] = [];
  const reasonings: string[] = [];
  const errors: string[] = [];
  let result: Extract<OfficeEvent, { kind: "result" }> | undefined;
  let loadout: { skills: string[]; mcp: string[]; delegate: boolean } | undefined;
  let changedFiles = 0;
  let inT = 0, outT = 0, cachedT = 0;
  for (const e of events) {
    if (e.kind === "text") texts.push(e.text);
    else if (e.kind === "reasoning") reasonings.push(e.text);
    else if (e.kind === "tool") trace.push({ kind: "tool", name: e.name, target: e.target });
    else if (e.kind === "file") {
      trace.push({ kind: "file", name: e.action === "edit" ? "Edit" : "Write", target: e.path, action: e.action });
      changedFiles++;
    } else if (e.kind === "handoff") trace.push({ kind: "handoff", name: `@${e.toAgent}`, target: e.reason });
    else if (e.kind === "loadout") loadout = { skills: e.skills, mcp: e.mcp, delegate: e.delegate };
    else if (e.kind === "result") result = e;
    else if (e.kind === "usage") { inT += e.inputTokens ?? 0; outT += e.outputTokens ?? 0; cachedT += e.cachedInputTokens ?? 0; }
    else if (e.kind === "error") errors.push(e.message);
  }
  // result 가 오면 그게 최종 전체 텍스트 — 누적 text 보다 우선.
  const rawBody = result?.text ?? texts.join("");
  const { body, report } = extractReport(rawBody);
  return {
    trace,
    body,
    reasoning: reasonings.length ? reasonings.join("\n\n") : undefined,
    report,
    result,
    errors,
    changedFiles,
    loadout,
    tokens: inT || outT ? { input: inT, output: outT, cached: cachedT } : undefined,
  };
}

// 도구 이름 → 아이콘. CLI마다 이름이 달라 휴리스틱 매칭(모르면 렌치).
export function traceIcon(it: TraceItem) {
  if (it.kind === "handoff") return Workflow;
  if (it.kind === "file") return it.action === "edit" ? FilePen : FilePlus2;
  const n = it.name.toLowerCase();
  if (n.startsWith("mcp__")) return Plug;
  if (/(^|_)(read|glob|grep|search|ls|cat)/.test(n)) return FileSearch;
  if (/(edit|write|notebook|apply)/.test(n)) return Pencil;
  if (/(bash|shell|terminal|exec|command)/.test(n)) return Terminal;
  if (/(web|fetch|http|browser)/.test(n)) return Globe;
  if (/(task|agent|subagent)/.test(n)) return Bot;
  return Wrench;
}
