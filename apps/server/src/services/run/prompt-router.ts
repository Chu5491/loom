// @mention 라우팅.
//
// 사용자 입력에서 @agent 패턴을 파싱하여 각 에이전트에게 해당 부분만
// 전달하거나, mention이 없으면 기본 에이전트에게 전체 전달.
//
// 규칙 (ADR-000 §2.1):
//   1. @agent mention이 있으면 → 해당 에이전트로 라우팅
//   2. mention이 여러 개면 → prompt를 분할하여 각 에이전트에게 해당 부분만
//   3. mention이 없으면 → Thread의 기본 에이전트(첫 번째 등록)로 전달
//   4. @all 또는 @everyone → 모든 참여 에이전트에게 동일 prompt 전달

import type { Agent } from "@loom/core";

export interface RoutedPrompt {
  /** Target agent for this portion of the prompt. */
  agentId: string;
  /** The user prompt to send. Mention tags are stripped. */
  prompt: string;
}

/** Single @mention occurrence parsed from user input. */
interface MentionToken {
  /** Matched mention name (lowercase). */
  name: string;
  /** Start index in original string. */
  start: number;
  /** End index (exclusive). */
  end: number;
}

const MENTION_RE = /(?:^|\s)@(\w[\w-]{0,29})(?=\s|$|[,.!?;:])/g;

/** Extract all @mention tokens from user input. */
function parseMentions(prompt: string): MentionToken[] {
  const tokens: MentionToken[] = [];
  let m: RegExpExecArray | null;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(prompt)) !== null) {
    const name = m[1]!.toLowerCase();
    // The regex may match leading whitespace — the actual @name starts
    // at m.index + (m[0].length - m[1].length - 1).
    const atIdx = m.index + m[0].indexOf("@");
    // name === m[1] lowercased, so name.length is the matched-name length.
    tokens.push({ name, start: atIdx, end: atIdx + name.length + 1 });
  }
  return tokens;
}

/** Remove all @mention tags from a string, collapsing whitespace. */
function stripMentions(prompt: string, mentions: MentionToken[]): string {
  if (mentions.length === 0) return prompt;
  let out = prompt;
  // Remove from end to preserve indices.
  for (let i = mentions.length - 1; i >= 0; i--) {
    const m = mentions[i]!;
    out = out.slice(0, m.start) + out.slice(m.end);
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

/** Build a mention-name → agent lookup from the thread's agent list. */
function buildAgentIndex(agents: Agent[]): Map<string, Agent> {
  const idx = new Map<string, Agent>();
  for (const a of agents) {
    if (a.mentionName) idx.set(a.mentionName.toLowerCase(), a);
  }
  return idx;
}

/**
 * Route a user prompt to one or more agents based on @mentions.
 *
 * @param prompt      Raw user input (may contain @mentions).
 * @param agents      Agents participating in this thread.
 * @param defaultId   Agent ID to use when no mention matches.
 * @returns           One or more routed prompts, ready for run creation.
 */
export function routePrompt(
  prompt: string,
  agents: Agent[],
  defaultId: string,
): RoutedPrompt[] {
  const mentions = parseMentions(prompt);
  const stripped = stripMentions(prompt, mentions);

  // No mentions → send everything to the default agent.
  if (mentions.length === 0) {
    return [{ agentId: defaultId, prompt }];
  }

  const idx = buildAgentIndex(agents);
  const mentionNames = [...new Set(mentions.map((m) => m.name))];

  // @all / @everyone → broadcast to all participating agents.
  if (mentionNames.includes("all") || mentionNames.includes("everyone")) {
    return agents.map((a) => ({ agentId: a.id, prompt: stripped }));
  }

  // Single mention → route to that agent, strip the tag.
  if (mentionNames.length === 1) {
    const target = idx.get(mentionNames[0]!);
    if (!target) return [{ agentId: defaultId, prompt }];
    return [{ agentId: target.id, prompt: stripped }];
  }

  // Multiple mentions → split by mention sections. Each section runs
  // from one mention to the next. Text before the first mention goes
  // to the default agent.
  const result: RoutedPrompt[] = [];
  const sorted = [...mentions].sort((a, b) => a.start - b.start);

  // Text before first mention → default agent.
  const preamble = prompt.slice(0, sorted[0]!.start).trim();
  if (preamble) result.push({ agentId: defaultId, prompt: preamble });

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const nextStart = sorted[i + 1]?.start ?? prompt.length;
    const section = prompt.slice(cur.end, nextStart).trim();
    if (!section) continue;

    const target = idx.get(cur.name);
    if (target) {
      result.push({ agentId: target.id, prompt: section });
    } else {
      // Unknown mention → fall through to default.
      result.push({ agentId: defaultId, prompt: `@${cur.name} ${section}` });
    }
  }

  return result.length > 0 ? result : [{ agentId: defaultId, prompt }];
}

// Re-export for unit tests.
export { parseMentions as _parseMentions, stripMentions as _stripMentions };
