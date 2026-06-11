// parseEvents — 5개 CLI의 서로 다른 출력 포맷을 OfficeEvent 하나로 통합.
// 한 줄(line) 단위로 파싱. JSON 이면 형태로 분기, 아니면 plain text(devin).
//
// 인식하는 형태:
//   {type:"result", result, total_cost_usd, session_id}      claude/codex/antigravity 최종
//   {type:"error" | is_error}                                 에러
//   {type:"assistant", message:{content:[{type:"text"|"tool_use"}]}}  claude 텍스트/툴
//   {type:"text", part:{text}}                                opencode 텍스트
//   {type:"tool_use", part:{tool,state.input} | tool_name,parameters}  opencode/antigravity 툴
//   그 외 비-JSON 줄                                          plain text

import type { OfficeEvent } from "@loom/core";

const FILE_TOOLS = new Set(["edit", "write", "Edit", "Write", "replace", "write_file", "apply_patch"]);

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function toolEvent(name: string, input: unknown): OfficeEvent {
  const p = (input ?? {}) as Record<string, unknown>;
  const file = str(p.file_path) ?? str(p.filePath) ?? str(p.path);
  if (FILE_TOOLS.has(name) && file) {
    return { kind: "file", path: file, action: name.toLowerCase().includes("edit") || name === "replace" ? "edit" : "write" };
  }
  const target =
    file ??
    str(p.command)?.slice(0, 80) ??
    str(p.pattern) ??
    str(p.query) ??
    str(p.url)?.slice(0, 80);
  return { kind: "tool", name, target };
}

function errText(j: Record<string, unknown>): string {
  const m = j.message ?? (j.error as Record<string, unknown> | undefined)?.message ?? j.result;
  return typeof m === "string" ? m : JSON.stringify(j).slice(0, 300);
}

export function parseLine(line: string): OfficeEvent[] {
  const t = line.trim();
  if (!t) return [];
  if (t[0] !== "{") return [{ kind: "text", text: t }];

  let j: Record<string, unknown>;
  try {
    j = JSON.parse(t) as Record<string, unknown>;
  } catch {
    return [{ kind: "text", text: t }];
  }
  const type = j.type;

  if (type === "error" || j.is_error) return [{ kind: "error", message: errText(j) }];

  if (type === "result" && typeof j.result === "string") {
    return [{ kind: "result", text: j.result, costUsd: num(j.total_cost_usd), sessionId: str(j.session_id) }];
  }

  // opencode 텍스트
  const part = j.part as { text?: unknown; tool?: unknown; state?: { input?: unknown } } | undefined;
  if (type === "text" && str(part?.text)) return [{ kind: "text", text: str(part!.text)! }];

  // claude assistant 메시지(텍스트 + tool_use)
  const msg = j.message as { content?: unknown } | undefined;
  if (type === "assistant" && Array.isArray(msg?.content)) {
    const out: OfficeEvent[] = [];
    for (const c of msg!.content as Record<string, unknown>[]) {
      if (c.type === "text" && str(c.text)) out.push({ kind: "text", text: str(c.text)! });
      if (c.type === "tool_use" && str(c.name)) out.push(toolEvent(str(c.name)!, c.input));
    }
    return out;
  }

  // opencode / antigravity tool_use
  if (type === "tool_use") {
    const name = str(part?.tool) ?? str(j.tool_name);
    if (name) return [toolEvent(name, part?.state?.input ?? j.parameters)];
  }

  // codex (신형): {type:"item.completed", item:{type:"agent_message"|"command_execution"|...}}
  if (type === "item.completed") {
    const item = j.item as Record<string, unknown> | undefined;
    if (item?.type === "agent_message" && str(item.text)) return [{ kind: "text", text: str(item.text)! }];
    if (item?.type === "command_execution" && str(item.command)) {
      return [{ kind: "tool", name: "shell", target: str(item.command)!.slice(0, 80) }];
    }
    if ((item?.type === "file_change" || item?.type === "patch") && str(item.path)) {
      return [{ kind: "file", path: str(item.path)!, action: "edit" }];
    }
  }

  // type 없는 JSON = 스트림 이벤트가 아니라 모델이 말한 JSON 본문(plain-text CLI 가
  // pretty-print 한 조각 줄 등) — 버리면 devin 의 JSON 응답에 구멍이 난다(실측).
  if (type === undefined) return [{ kind: "text", text: t }];

  return [];
}
