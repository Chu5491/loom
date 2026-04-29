import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { AdapterManifest, Agent, Run, RunStatus } from "@loom/core";
import { api } from "../api/client.js";
import { Button } from "./ui.js";
import { AdapterIcon } from "./AdapterIcon.js";
import { useI18n } from "../context/I18nContext.js";
import {
  agentColorFor,
  classesFor,
  initialFor,
  type ColorClasses,
} from "./agentColor.js";

/**
 * Group-chat view of a project.
 *
 * Each agent has a deterministic signature color (id-hashed), so even if
 * three agents share the same adapter you can tell them apart at a glance.
 * Messages share a single chronological column (Slack/Discord style); the
 * left rail of an agent message wears the agent's color so ownership is
 * visible without reading names.
 *
 * No agent-to-agent autonomy — the user routes every message. Forwarding
 * an agent's result to another agent is the routing primitive that makes
 * the room feel like a team workspace.
 */

function statusTone(s: RunStatus): "emerald" | "red" | "amber" | "sky" | "zinc" {
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
// Avatars
// ────────────────────────────────────────────────────────────────────────────

export function AgentAvatar({
  agent,
  manifest,
  working,
  size = 36,
}: {
  agent: Agent;
  manifest: AdapterManifest | undefined;
  working: boolean;
  size?: number;
}) {
  const color = agentColorFor(agent.id);
  const cls = classesFor(color);
  const initial = initialFor(agent.name);

  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      <span
        className={
          "flex items-center justify-center rounded-full font-semibold ring-2 " +
          cls.bgSoft +
          " " +
          cls.text +
          " " +
          cls.ring
        }
        style={{
          width: size,
          height: size,
          fontSize: Math.round(size * 0.42),
        }}
      >
        {initial}
      </span>
      {manifest ? (
        <span
          className="absolute -bottom-0.5 -right-0.5 rounded-full bg-white dark:bg-zinc-950 p-0.5 ring-1 ring-zinc-200 dark:ring-zinc-800"
          title={manifest.displayName}
        >
          <AdapterIcon manifest={manifest} size={Math.round(size * 0.36)} />
        </span>
      ) : null}
      {working ? (
        <span
          className={
            "absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-zinc-950 breath " +
            cls.dot
          }
        />
      ) : null}
    </span>
  );
}

function UserAvatar({ size = 36 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full bg-zinc-900 text-white font-semibold ring-2 ring-zinc-200 shrink-0 dark:bg-zinc-100 dark:text-zinc-900 dark:ring-zinc-800"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      나
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Member panel — top of the room
// ────────────────────────────────────────────────────────────────────────────

export function MemberPanel({
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
    <div className="border-b border-zinc-200 dark:border-zinc-800 bg-gradient-to-b from-white to-zinc-50/50 dark:from-zinc-950 dark:to-zinc-900/40">
      <div className="px-4 pt-3 pb-1 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
          {t("chat.members.title")}
        </span>
        <span className="text-[10px] text-zinc-400 dark:text-zinc-600">
          · {agents.length}
        </span>
      </div>
      <div className="px-3 pb-3 flex items-center gap-2 overflow-x-auto">
        {agents.map((a) => {
          const manifest = manifests.find((m) => m.kind === a.adapterKind);
          const working = workingIds.has(a.id);
          const selected = selectedAgentId === a.id;
          const cls = classesFor(agentColorFor(a.id));
          return (
            <button
              key={a.id}
              onClick={() => onPick(a.id)}
              className={
                "flex items-center gap-2.5 rounded-xl pl-1.5 pr-3 py-1.5 transition-all border shrink-0 " +
                (selected
                  ? "border-zinc-900 bg-white shadow-sm dark:border-zinc-100 dark:bg-zinc-900"
                  : "border-zinc-200 bg-white/60 hover:border-zinc-300 hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:border-zinc-700 dark:hover:bg-zinc-900")
              }
            >
              <AgentAvatar
                agent={a}
                manifest={manifest}
                working={working}
                size={32}
              />
              <div className="text-left">
                <div className={"text-xs font-medium " + cls.text}>
                  @{a.name}
                </div>
                <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                  {working ? (
                    <span className="inline-flex items-center gap-1">
                      <span className={"w-1 h-1 rounded-full breath " + cls.dot} />
                      {t("chat.members.working")}
                    </span>
                  ) : (
                    t("chat.members.idle")
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Messages
// ────────────────────────────────────────────────────────────────────────────

export function UserMessage({
  run,
  target,
  manifest,
}: {
  run: Run;
  target: Agent | undefined;
  manifest: AdapterManifest | undefined;
}) {
  const { t } = useI18n();
  return (
    <Row
      avatar={<UserAvatar />}
      name={t("chat.message.you")}
      timestamp={run.createdAt}
      tag={
        target ? (
          <span className="text-[11px] text-zinc-500 inline-flex items-center gap-1">
            →{" "}
            <span className={"font-medium " + classesFor(agentColorFor(target.id)).text}>
              @{target.name}
            </span>
            {manifest ? <AdapterIcon manifest={manifest} size={12} /> : null}
          </span>
        ) : undefined
      }
    >
      <div className="rounded-xl bg-white border border-zinc-200 px-3.5 py-2 text-sm text-zinc-900 whitespace-pre-wrap break-words shadow-sm dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-100">
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
  const cls: ColorClasses | null = agent ? classesFor(agentColorFor(agent.id)) : null;

  return (
    <Row
      avatar={
        agent ? (
          <AgentAvatar agent={agent} manifest={manifest} working={isActive} />
        ) : (
          <span className="w-9 h-9 rounded-full bg-zinc-200 dark:bg-zinc-800 shrink-0" />
        )
      }
      name={name}
      nameColor={cls?.text}
      timestamp={run.createdAt}
      tag={
        <span className={"flex items-center gap-1.5 text-xs " + toneText(tone)}>
          <span
            className={
              "w-1.5 h-1.5 rounded-full " +
              toneDot(tone) +
              (isActive ? " breath" : "")
            }
          />
          {t(`status.${run.status}`)}
        </span>
      }
      leftRailClass={cls?.border}
    >
      <div
        className={
          "rounded-xl border px-3.5 py-2 text-sm shadow-sm transition-colors " +
          (isActive
            ? (cls?.bgSoft ?? "bg-sky-50") +
              " " +
              (cls?.border ?? "border-sky-300")
            : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900")
        }
      >
        {!hasContent ? (
          <p className="text-xs italic text-zinc-400 dark:text-zinc-500">
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

      <div className="flex items-center gap-3 text-[11px] text-zinc-400 dark:text-zinc-500 mt-1">
        <Link
          to={`/runs/${run.id}`}
          className="hover:text-zinc-700 hover:underline dark:hover:text-zinc-200"
        >
          {t("chat.message.openLog")}
        </Link>
        {!isActive ? (
          <>
            <button
              onClick={() => onReply(run, agent)}
              className="hover:text-zinc-700 hover:underline dark:hover:text-zinc-200"
            >
              {t("chat.message.reply")}
            </button>
            <button
              onClick={() => onForward(run, agent)}
              className="hover:text-zinc-700 hover:underline dark:hover:text-zinc-200"
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
  nameColor,
  timestamp,
  tag,
  leftRailClass,
  children,
}: {
  avatar: React.ReactNode;
  name: string;
  nameColor?: string;
  timestamp: string;
  tag?: React.ReactNode;
  leftRailClass?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="msg-in flex items-start gap-3 group">
      <div className="shrink-0 mt-0.5">{avatar}</div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-baseline gap-2">
          <span
            className={
              "font-semibold text-sm " +
              (nameColor ?? "text-zinc-900 dark:text-zinc-100")
            }
          >
            {name}
          </span>
          {tag ? <span className="text-[11px]">{tag}</span> : null}
          <span className="text-[10px] text-zinc-400 dark:text-zinc-600 mono ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
            {new Date(timestamp).toLocaleTimeString()}
          </span>
        </div>
        <div
          className={
            leftRailClass
              ? "border-l-2 pl-3 -ml-3 " + leftRailClass
              : ""
          }
        >
          {children}
        </div>
      </div>
    </div>
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
// Working strip
// ────────────────────────────────────────────────────────────────────────────

export function WorkingIndicator({
  workingAgents,
  manifests,
}: {
  workingAgents: Agent[];
  manifests: AdapterManifest[];
}) {
  const { t } = useI18n();
  if (workingAgents.length === 0) return null;
  const label =
    workingAgents.length === 1
      ? t("chat.working.singular", { agent: workingAgents[0]!.name })
      : t("chat.working.plural", { count: workingAgents.length });

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-gradient-to-r from-sky-50 via-white to-sky-50 dark:from-sky-950/30 dark:via-zinc-950 dark:to-sky-950/30 border-t border-sky-100 dark:border-sky-900/50">
      <AvatarStack
        agents={workingAgents}
        manifests={manifests}
        max={4}
      />
      <span className="text-xs text-sky-700 dark:text-sky-300 font-medium">
        {label}
      </span>
      <span className="flex gap-0.5 ml-auto">
        <Dot delay={0} />
        <Dot delay={150} />
        <Dot delay={300} />
      </span>
    </div>
  );
}

function AvatarStack({
  agents,
  manifests,
  max = 3,
}: {
  agents: Agent[];
  manifests: AdapterManifest[];
  max?: number;
}) {
  const visible = agents.slice(0, max);
  const overflow = agents.length - visible.length;
  return (
    <div className="flex -space-x-2">
      {visible.map((a) => (
        <span
          key={a.id}
          className="ring-2 ring-white dark:ring-zinc-950 rounded-full"
          title={a.name}
        >
          <AgentAvatar
            agent={a}
            manifest={manifests.find((m) => m.kind === a.adapterKind)}
            working={false}
            size={24}
          />
        </span>
      ))}
      {overflow > 0 ? (
        <span className="w-6 h-6 rounded-full bg-zinc-200 dark:bg-zinc-800 ring-2 ring-white dark:ring-zinc-950 flex items-center justify-center text-[10px] font-medium text-zinc-600 dark:text-zinc-400">
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-bounce"
      style={{ animationDelay: `${delay}ms`, animationDuration: "1.1s" }}
    />
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Composer
// ────────────────────────────────────────────────────────────────────────────

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
        requestAnimationFrame(() =>
          el.setSelectionRange(el.value.length, el.value.length),
        );
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
  const targetCls = target ? classesFor(agentColorFor(target.id)) : null;

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
      <div
        className={
          "rounded-2xl border bg-zinc-50 dark:bg-zinc-900 transition-all " +
          (target
            ? "border-zinc-300 dark:border-zinc-700 focus-within:border-zinc-500 focus-within:ring-2 focus-within:ring-zinc-200 dark:focus-within:border-zinc-400 dark:focus-within:ring-zinc-800"
            : "border-zinc-300 dark:border-zinc-800")
        }
      >
        <div className="flex items-center gap-2 px-2.5 pt-1.5">
          {target ? (
            <span className="flex items-center gap-1.5">
              <AgentAvatar
                agent={target}
                manifest={targetManifest}
                working={false}
                size={20}
              />
              <span
                className={
                  "text-xs font-semibold " + (targetCls?.text ?? "text-zinc-700")
                }
              >
                @{target.name}
              </span>
            </span>
          ) : null}
          <select
            value={agentId}
            onChange={(e) => onAgentChange(e.target.value)}
            className="appearance-none bg-transparent text-[10px] text-zinc-400 hover:text-zinc-600 cursor-pointer focus:outline-none dark:text-zinc-500 dark:hover:text-zinc-300"
            title="Change target"
          >
            {agents.length === 0 ? <option value="">—</option> : null}
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.name}
              </option>
            ))}
          </select>
          <span className="text-[10px] text-zinc-400 dark:text-zinc-600 ml-auto">
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

// ────────────────────────────────────────────────────────────────────────────
// Quote helpers + room derivations
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
  let body = run.prompt;
  try {
    const r = await api.getRunResult(run.id);
    if (r.resultText) body = r.resultText;
  } catch {
    // fallback already set
  }
  const lines = body.split("\n").map((l) => `> ${l}`);
  return `${heading}\n${lines.join("\n")}\n\n`;
}

function workingAgentIdsFromRuns(runs: Run[]): Set<string> {
  const out = new Set<string>();
  for (const r of runs) {
    if (r.status === "queued" || r.status === "running") out.add(r.agentId);
  }
  return out;
}

export interface FeedItem {
  kind: "user" | "agent";
  run: Run;
  ts: string;
}

function buildFeed(runs: Run[]): FeedItem[] {
  const items: FeedItem[] = [];
  for (const r of runs) {
    items.push({ kind: "user", run: r, ts: r.createdAt });
    items.push({ kind: "agent", run: r, ts: r.startedAt ?? r.createdAt });
  }
  items.sort((a, b) => a.ts.localeCompare(b.ts));
  return items;
}

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
