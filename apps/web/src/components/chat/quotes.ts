// 답장/포워드/선택 영역 인용 텍스트 빌더.

import type { Agent, Run } from "@loom/core";
import { api } from "../../api/client.js";

type T = (key: string, vars?: Record<string, string | number>) => string;

export function buildReplyQuote(
  run: Run,
  agent: Agent | undefined,
  t: T,
): string {
  const name = agent?.name ?? run.agentId.slice(0, 8);
  const heading = t("chat.message.quoteHeading", { agent: name });
  const lines = run.prompt.split("\n").map((l) => `> ${l}`);
  return `${heading}\n${lines.join("\n")}\n\n`;
}

export async function buildForwardQuote(
  run: Run,
  agent: Agent | undefined,
  t: T,
): Promise<string> {
  const name = agent?.name ?? run.agentId.slice(0, 8);
  const heading = t("chat.message.quoteHeading", { agent: name });
  let body = run.prompt;
  try {
    const r = await api.getRunResult(run.id);
    if (r.resultText) body = r.resultText;
  } catch {
    // 폴백 이미 설정됨
  }
  const lines = body.split("\n").map((l) => `> ${l}`);
  return `${heading}\n${lines.join("\n")}\n\n`;
}

export function buildSelectionQuote(
  selection: string,
  agent: Agent | undefined,
  agentIdFallback: string,
  t: T,
): string {
  const name = agent?.name ?? agentIdFallback.slice(0, 8);
  const heading = t("chat.message.quoteHeading", { agent: name });
  const lines = selection.split("\n").map((l) => `> ${l}`);
  return `${heading}\n${lines.join("\n")}\n\n`;
}
