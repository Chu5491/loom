import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { AdapterManifest, Agent, Run, RunStatus } from "@loom/core";
import { api } from "../api/client.js";
import { Button } from "./ui.js";
import { AdapterIcon } from "./AdapterIcon.js";
import { useI18n } from "../context/I18nContext.js";

/**
 * Group-chat view of a project.
 *
 * Every entity in the room — the user and each agent — appears as a peer:
 * left-aligned avatar + name + bubble, ordered chronologically. The user's
 * prompt and the agent's reply are *separate* messages in the timeline,
 * which is what makes it feel like Slack/Discord rather than a 1:1 chat.
 *
 * No agent-to-agent autonomy: the user picks each target. Forwarding an
 * agent's result to another agent is the routing primitive that makes the
 * "team room" feel real.
 */

function statusTone(s: RunStatus) {
  switch (s) {
    case "succeeded":
      return "emerald";
    case "failed":
      return "red";
    case "cancelled":
      return "amber";
    case "running":
      return "sky";
    default:
      return "zinc";
  }
}

interface TailEvent {
  kind: "text" | "tool" | "system";
  text: string;
}

function useRunTail(
  runId: string,
  active: boolean,
): { events: TailEvent[]; resultText: string | null } {
  const [events, setEvents] = useState<TailEvent[]>([]);
  const [resultText, setResultText] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    setEvents([]);
    setResultText(null);
    let buffer = "";
    const ev = new EventSource(`/api/runs/${runId}/logs`);

    const onChunk = (e: Event) => {
      const payload = JSON.parse((e as MessageEvent).data) as {
        stream: "stdout" | "stderr";
        data: string;
      };
      if (payload.stream !== "stdout") return;
      buffer += payload.data;
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      const next: TailEvent[] = [];
      let pickedResult: string | null = null;
      for (const line of parts) {
        if (!line) continue;
        try {
          const j = JSON.parse(line) as {
            type?: string;
            subtype?: string;
            message?: {
              content?: Array<{ type: string; text?: string; name?: string }>;
            };
            result?: string;
          };
          if (j.type === "assistant" && j.message?.content) {
            for (const c of j.message.content) {
              if (c.type === "text" && c.text) {
                next.push({ kind: "text", text: c.text });
              } else if (c.type === "tool_use" && c.name) {
                next.push({ kind: "tool", text: c.name });
              }
            }
          } else if (j.type === "result" && typeof j.result === "string") {
            pickedResult = j.result;
          } else if (j.type === "system" && j.subtype) {
            next.push({ kind: "system", text: j.subtype });
          }
        } catch {
          // skip non-JSON lines
        }
      }
      if (next.length) setEvents((prev) => [...prev, ...next].slice(-30));
      if (pickedResult !== null) setResultText(pickedResult);
    };

    ev.addEventListener("chunk", onChunk);
    ev.addEventListener("done", () => ev.close());
    ev.onerror = () => ev.close();
    return () => ev.close();
  }, [runId, active]);

  return { events, resultText };
}

// ────────────────────────────────────────────────────────────────────────────
// Member bar — top of the room
// ────────────────────────────────────────────────────────────────────────────

export function MemberBar({
  agents,
  manifests,
  workingIds,
  selectedAgentId,
  onPick,
}: {
  agents: Agent[];
  manifests: AdapterManifest[];
  workingIds: Set<string>;
  selectedAgentId?: string;
  onPick: (agentId: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 px-4 py-2.5">
      <div className="flex items-center gap-3 overflow-x-auto">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500 shrink-0">
          {t("chat.members.title")}
        </span>
        <div className="flex items-center gap-1.5">
          {agents.map((a) => {
            const manifest = manifests.find((m) => m.kind === a.adapterKind);
            const working = workingIds.has(a.id);
            const selected = selectedAgentId === a.id;
            return (
              <button
                key={a.id}
                onClick={() => onPick(a.id)}
                title={`@${a.name} — ${working ? t("chat.members.working") : t("chat.members.idle")}`}
                className={
                  "flex items-center gap-1.5 rounded-full pl-1 pr-2.5 py-0.5 text-xs transition-colors border " +
                  (selected
                    ? "border-sky-400 bg-sky-50 text-sky-800 dark:border-sky-600 dark:bg-sky-950/40 dark:text-sky-200"
                    : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 text-zinc-700 dark:text-zinc-300")
                }
              >
                <span className="relative">
                  {manifest ? (
                    <AdapterIcon manifest={manifest} size={20} />
                  ) : (
                    <span className="block w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-700" />
                  )}
                  <span
                    className={
                      "absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ring-1 " +
                      (working
                        ? "bg-sky-500 ring-white animate-pulse dark:ring-zinc-900"
                        : "bg-zinc-300 ring-white dark:bg-zinc-600 dark:ring-zinc-900")
                    }
                  />
                </span>
                <span className="font-medium">{a.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Messages
// ────────────────────────────────────────────────────────────────────────────

export function UserMessage({ run, target }: { run: Run; target: Agent | undefined }) {
  const { t } = useI18n();
  return (
    <Row
      avatar={<UserAvatar />}
      name={t("chat.message.you")}
      timestamp={run.createdAt}
      tag={target ? `→ @${target.name}` : undefined}
    >
      <div className="rounded-lg bg-white border border-zinc-200 px-3 py-2 text-sm text-zinc-900 whitespace-pre-wrap break-words dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-100">
        {run.prompt}
      </div>
    </Row>
  );
}

export function AgentMessage({
  run,
  agent,
  manifest,
  onReply,
  onForward,
}: {
  run: Run;
  agent: Agent | undefined;
  manifest: AdapterManifest | undefined;
  onReply: (run: Run, agent: Agent | undefined) => void;
  onForward: (run: Run, agent: Agent | undefined) => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const isActive = run.status === "queued" || run.status === "running";
  const { events, resultText } = useRunTail(run.id, isActive);

  const cancel = useMutation({
    mutationFn: () => api.cancelRun(run.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["runs"] }),
  });

  const name = agent?.name ?? run.agentId.slice(0, 8);
  const tone = statusTone(run.status);
  const hasContent = events.length > 0 || resultText !== null;

  return (
    <Row
      avatar={<AgentAvatar manifest={manifest} working={isActive} />}
      name={name}
      timestamp={run.createdAt}
      tag={
        <span className={"flex items-center gap-1.5 text-xs " + toneText(tone)}>
          <span className={"w-1.5 h-1.5 rounded-full " + toneDot(tone) + (isActive ? " animate-pulse" : "")} />
          {t(`status.${run.status}`)}
        </span>
      }
    >
      <div
        className={
          "rounded-lg border px-3 py-2 text-sm transition-colors " +
          (isActive
            ? "border-sky-300 bg-sky-50/40 dark:border-sky-800 dark:bg-sky-950/20"
            : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900")
        }
      >
        {!hasContent ? (
          <p className="text-xs italic text-zinc-400">
            {isActive ? t("chat.tail.waiting") : "—"}
          </p>
        ) : (
          <div className="space-y-1.5">
            {events.map((evt, i) => (
              <p
                key={i}
                className="whitespace-pre-wrap break-words text-zinc-800 dark:text-zinc-200"
              >
                {evt.kind === "tool" ? (
                  <>
                    <span className="text-amber-600 dark:text-amber-400">🛠</span>{" "}
                    <span className="mono text-zinc-600 dark:text-zinc-400 text-xs">
                      {evt.text}
                    </span>
                  </>
                ) : evt.kind === "system" ? (
                  <span className="text-xs text-zinc-500">· {evt.text}</span>
                ) : (
                  <span>{evt.text}</span>
                )}
              </p>
            ))}
            {resultText ? (
              <p className="whitespace-pre-wrap break-words text-zinc-900 dark:text-zinc-100 border-t border-zinc-200/60 dark:border-zinc-800/60 pt-1.5">
                {resultText}
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">
        <Link
          to={`/runs/${run.id}`}
          className="hover:text-sky-600 hover:underline dark:hover:text-sky-300"
        >
          {t("chat.message.openLog")}
        </Link>
        {!isActive ? (
          <>
            <button
              onClick={() => onReply(run, agent)}
              className="hover:text-sky-600 hover:underline dark:hover:text-sky-300"
            >
              {t("chat.message.reply")}
            </button>
            <button
              onClick={() => onForward(run, agent)}
              className="hover:text-sky-600 hover:underline dark:hover:text-sky-300"
            >
              {t("chat.message.forward")} →
            </button>
          </>
        ) : null}
        {isActive ? (
          <button
            onClick={() => {
              if (confirm(t("chat.message.cancelConfirm"))) cancel.mutate();
            }}
            disabled={cancel.isPending}
            className="hover:text-red-600 hover:underline dark:hover:text-red-400"
          >
            {t("chat.message.cancel")}
          </button>
        ) : null}
      </div>
    </Row>
  );
}

function Row({
  avatar,
  name,
  timestamp,
  tag,
  children,
}: {
  avatar: React.ReactNode;
  name: string;
  timestamp: string;
  tag?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 group">
      <div className="shrink-0 mt-0.5">{avatar}</div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
            {name}
          </span>
          {tag ? <span className="text-[11px]">{tag}</span> : null}
          <span className="text-[10px] text-zinc-400 dark:text-zinc-600 mono ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
            {new Date(timestamp).toLocaleTimeString()}
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}

function UserAvatar() {
  return (
    <div className="w-8 h-8 rounded-full bg-zinc-900 text-white flex items-center justify-center text-xs font-semibold dark:bg-zinc-100 dark:text-zinc-900">
      나
    </div>
  );
}

function AgentAvatar({
  manifest,
  working,
}: {
  manifest: AdapterManifest | undefined;
  working: boolean;
}) {
  return (
    <span className="relative block">
      <span className="block w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center overflow-hidden ring-1 ring-zinc-200 dark:ring-zinc-700">
        {manifest ? (
          <AdapterIcon manifest={manifest} size={22} />
        ) : (
          <span className="block w-5 h-5 rounded-full bg-zinc-300 dark:bg-zinc-600" />
        )}
      </span>
      {working ? (
        <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-sky-500 ring-2 ring-white dark:ring-zinc-950 animate-pulse" />
      ) : null}
    </span>
  );
}

function toneText(tone: string): string {
  switch (tone) {
    case "emerald":
      return "text-emerald-700 dark:text-emerald-400";
    case "red":
      return "text-red-600 dark:text-red-400";
    case "amber":
      return "text-amber-700 dark:text-amber-400";
    case "sky":
      return "text-sky-600 dark:text-sky-400";
    default:
      return "text-zinc-500";
  }
}
function toneDot(tone: string): string {
  switch (tone) {
    case "emerald":
      return "bg-emerald-500";
    case "red":
      return "bg-red-500";
    case "amber":
      return "bg-amber-500";
    case "sky":
      return "bg-sky-500";
    default:
      return "bg-zinc-400";
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Working strip + Composer
// ────────────────────────────────────────────────────────────────────────────

export function WorkingIndicator({
  workingAgents,
}: {
  workingAgents: Agent[];
}) {
  const { t } = useI18n();
  if (workingAgents.length === 0) return null;
  const label =
    workingAgents.length === 1
      ? t("chat.working.singular", { agent: workingAgents[0]!.name })
      : t("chat.working.plural", { count: workingAgents.length });
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-sky-700 dark:text-sky-300 bg-sky-50/60 dark:bg-sky-950/30 border-t border-sky-100 dark:border-sky-900/50">
      <span className="flex gap-0.5">
        <Dot delay={0} />
        <Dot delay={150} />
        <Dot delay={300} />
      </span>
      <span>{label}</span>
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      className="w-1 h-1 rounded-full bg-sky-500 animate-bounce"
      style={{ animationDelay: `${delay}ms`, animationDuration: "1s" }}
    />
  );
}

export function Composer({
  agents,
  manifests,
  agentId,
  onAgentChange,
  initialDraft,
  draftKey,
  onSent,
}: {
  agents: Agent[];
  manifests: AdapterManifest[];
  agentId: string;
  onAgentChange: (id: string) => void;
  initialDraft?: string;
  /** Bumped when the parent injects a fresh quote, so we sync the draft. */
  draftKey?: number;
  onSent: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [text, setText] = useState(initialDraft ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (initialDraft !== undefined) {
      setText(initialDraft);
      const el = textareaRef.current;
      if (el) {
        el.focus();
        requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  const create = useMutation({
    mutationFn: api.createRun,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["runs"] });
      setText("");
      onSent();
    },
  });

  const send = () => {
    if (!agentId || !text.trim() || create.isPending) return;
    create.mutate({ agentId, prompt: text });
  };

  const target = agents.find((a) => a.id === agentId);
  const targetManifest = target
    ? manifests.find((m) => m.kind === target.adapterKind)
    : undefined;

  const placeholder = target
    ? t("chat.composer.placeholder", { agent: target.name })
    : t("chat.composer.placeholderNoAgent");

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 pt-2.5 pb-3">
      {create.error ? (
        <p className="mb-2 text-xs text-red-500 dark:text-red-400 px-1">
          {create.error.message}
        </p>
      ) : null}
      <div className="rounded-2xl border border-zinc-300 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-100 dark:focus-within:ring-sky-950/40 transition-colors">
        <div className="flex items-center justify-between gap-2 px-2.5 pt-1.5">
          <AgentChipPicker
            agents={agents}
            value={agentId}
            onChange={onAgentChange}
            currentManifest={targetManifest}
          />
          <span className="text-[10px] text-zinc-400 dark:text-zinc-600">
            {t("chat.composer.hint")}
          </span>
        </div>
        <textarea
          ref={textareaRef}
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={placeholder}
          disabled={!agentId}
          className="w-full resize-none bg-transparent px-3 pb-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none dark:text-zinc-100 dark:placeholder-zinc-500 disabled:opacity-50"
        />
        <div className="flex justify-end px-2 pb-1.5">
          <Button
            size="sm"
            disabled={!agentId || !text.trim() || create.isPending}
            onClick={send}
          >
            {create.isPending ? t("chat.composer.sending") : t("chat.composer.send")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AgentChipPicker({
  agents,
  value,
  onChange,
  currentManifest,
}: {
  agents: Agent[];
  value: string;
  onChange: (id: string) => void;
  currentManifest: AdapterManifest | undefined;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none h-7 pl-7 pr-6 rounded-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:border-zinc-300 dark:hover:border-zinc-600 focus:outline-none cursor-pointer"
      >
        {agents.length === 0 ? <option value="">—</option> : null}
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            @{a.name}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2">
        {currentManifest ? (
          <AdapterIcon manifest={currentManifest} size={16} />
        ) : (
          <span className="block w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700" />
        )}
      </span>
      <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-zinc-400">
        ▾
      </span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Quote helpers — used by the page to prefill drafts
// ────────────────────────────────────────────────────────────────────────────

export function buildReplyQuote(
  run: Run,
  agent: Agent | undefined,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const name = agent?.name ?? run.agentId.slice(0, 8);
  const heading = t("chat.message.quoteHeading", { agent: name });
  const lines = run.prompt.split("\n").map((l) => `> ${l}`);
  return `${heading}\n${lines.join("\n")}\n\n`;
}

export async function buildForwardQuote(
  run: Run,
  agent: Agent | undefined,
  t: (key: string, vars?: Record<string, string | number>) => string,
): Promise<string> {
  const name = agent?.name ?? run.agentId.slice(0, 8);
  const heading = t("chat.message.quoteHeading", { agent: name });
  // Forward pulls the agent's actual result text from the log file; if not
  // available (no result line emitted), fall back to the user prompt so the
  // forward target at least sees what was originally asked.
  let body = run.prompt;
  try {
    const r = await api.getRunResult(run.id);
    if (r.resultText) body = r.resultText;
  } catch {
    // ignore — fallback already set
  }
  const lines = body.split("\n").map((l) => `> ${l}`);
  return `${heading}\n${lines.join("\n")}\n\n`;
}

/** Small helper to compute the working agent set from runs. */
export function workingAgentIdsFromRuns(runs: Run[]): Set<string> {
  const out = new Set<string>();
  for (const r of runs) {
    if (r.status === "queued" || r.status === "running") out.add(r.agentId);
  }
  return out;
}

export function workingAgents(runs: Run[], agents: Agent[]): Agent[] {
  const ids = workingAgentIdsFromRuns(runs);
  return agents.filter((a) => ids.has(a.id));
}

/** Build a single chronological feed of user messages + agent replies. */
export interface FeedItem {
  kind: "user" | "agent";
  run: Run;
  ts: string;
  /** For agent items, the timestamp shown is run.startedAt or createdAt. */
}
export function buildFeed(runs: Run[]): FeedItem[] {
  const items: FeedItem[] = [];
  for (const r of runs) {
    items.push({ kind: "user", run: r, ts: r.createdAt });
    items.push({
      kind: "agent",
      run: r,
      ts: r.startedAt ?? r.createdAt,
    });
  }
  // Stable sort by ts ascending — earliest at top.
  items.sort((a, b) => a.ts.localeCompare(b.ts));
  return items;
}

/** Convenience hook — keep all the room state derivation in one place. */
export function useRoomDerived(
  runs: Run[],
  agents: Agent[],
): {
  feed: FeedItem[];
  working: Agent[];
  workingIds: Set<string>;
} {
  return useMemo(() => {
    const workingIds = workingAgentIdsFromRuns(runs);
    return {
      feed: buildFeed(runs),
      working: agents.filter((a) => workingIds.has(a.id)),
      workingIds,
    };
  }, [runs, agents]);
}
