import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { AdapterManifest, Agent, Run, RunStatus } from "@loom/core";
import { api } from "../api/client.js";
import { Badge, Button } from "./ui.js";
import { AdapterIcon } from "./AdapterIcon.js";
import { useI18n } from "../context/I18nContext.js";

/**
 * Chat-style view of a project. Each run becomes a user→agent message pair:
 * the prompt the user typed on the right, the agent's live tail / final
 * result on the left. No multi-turn memory — each message is an independent
 * one-shot run; users quote earlier messages explicitly when they want
 * context to flow forward.
 */

function statusTone(s: RunStatus) {
  switch (s) {
    case "succeeded":
      return "success" as const;
    case "failed":
      return "danger" as const;
    case "cancelled":
      return "warn" as const;
    case "running":
      return "info" as const;
    default:
      return "neutral" as const;
  }
}

interface TailEvent {
  kind: "text" | "tool" | "system";
  text: string;
}

/**
 * SSE-driven tail for an active run. Pulls human-readable bits — assistant
 * text, tool calls, system events — from stream-json so the bubble shows
 * real-time progress without a full log viewer.
 */
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
          // non-JSON line — skip in chat view (full log page renders raw)
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

export function MessagePair({
  run,
  agent,
  manifest,
  onReply,
}: {
  run: Run;
  agent: Agent | undefined;
  manifest: AdapterManifest | undefined;
  onReply: (run: Run, agent: Agent | undefined) => void;
}) {
  const isActive = run.status === "queued" || run.status === "running";

  return (
    <div className="space-y-2">
      <UserBubble run={run} />
      <AgentBubble
        run={run}
        agent={agent}
        manifest={manifest}
        isActive={isActive}
        onReply={onReply}
      />
    </div>
  );
}

function UserBubble({ run }: { run: Run }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const limit = 320;
  const long = run.prompt.length > limit;
  const display = expanded || !long ? run.prompt : `${run.prompt.slice(0, limit)}…`;

  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] space-y-1">
        <p className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500 text-right pr-1">
          {t("chat.message.you")} · {new Date(run.createdAt).toLocaleTimeString()}
        </p>
        <div className="rounded-2xl rounded-tr-sm bg-sky-500 px-3.5 py-2 text-sm text-white whitespace-pre-wrap break-words shadow-sm dark:bg-sky-600">
          {display}
          {long ? (
            <button
              className="ml-2 text-[11px] underline text-sky-100/90"
              onClick={() => setExpanded((s) => !s)}
            >
              {expanded ? "less" : "more"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AgentBubble({
  run,
  agent,
  manifest,
  isActive,
  onReply,
}: {
  run: Run;
  agent: Agent | undefined;
  manifest: AdapterManifest | undefined;
  isActive: boolean;
  onReply: (run: Run, agent: Agent | undefined) => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { events, resultText } = useRunTail(run.id, isActive);

  const cancel = useMutation({
    mutationFn: () => api.cancelRun(run.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["runs"] }),
  });

  const name = agent?.name ?? run.agentId.slice(0, 8);
  const hasContent = events.length > 0 || resultText !== null;

  return (
    <div className="flex items-start gap-2.5">
      <div className="shrink-0 mt-0.5">
        {manifest ? (
          <AdapterIcon manifest={manifest} size={28} />
        ) : (
          <div className="w-7 h-7 rounded-full bg-zinc-200 dark:bg-zinc-800" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-xs text-zinc-700 dark:text-zinc-300 truncate">
            {name}
          </span>
          <Badge tone={statusTone(run.status)}>{t(`status.${run.status}`)}</Badge>
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500 mono">
            {new Date(run.createdAt).toLocaleTimeString()}
          </span>
        </div>

        <div
          className={
            "rounded-2xl rounded-tl-sm border px-3.5 py-2 text-sm shadow-sm transition-colors " +
            (isActive
              ? "border-sky-300 bg-white ring-2 ring-sky-100 dark:border-sky-800 dark:bg-zinc-900 dark:ring-sky-950/40"
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
                <p className="whitespace-pre-wrap break-words text-zinc-900 dark:text-zinc-100 border-t border-zinc-100 dark:border-zinc-800 pt-1.5">
                  {resultText}
                </p>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 text-[11px] text-zinc-400 dark:text-zinc-500">
          <Link
            to={`/runs/${run.id}`}
            className="hover:text-sky-600 hover:underline dark:hover:text-sky-300"
          >
            {t("chat.message.openLog")}
          </Link>
          {!isActive ? (
            <button
              onClick={() => onReply(run, agent)}
              className="hover:text-sky-600 hover:underline dark:hover:text-sky-300"
            >
              {t("chat.message.reply")}
            </button>
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
      </div>
    </div>
  );
}

export function Composer({
  agents,
  manifests,
  initialAgentId,
  initialDraft,
  draftKey,
  onSent,
}: {
  agents: Agent[];
  manifests: AdapterManifest[];
  initialAgentId?: string;
  initialDraft?: string;
  /** Bumped by the parent when a quote is injected — we sync the draft. */
  draftKey?: string | number;
  onSent: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [agentId, setAgentId] = useState<string>(
    initialAgentId ?? agents[0]?.id ?? "",
  );
  const [text, setText] = useState(initialDraft ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Parent passes a fresh draftKey when the quote button is clicked. We
  // accept the draft and focus so the user can keep typing immediately.
  useEffect(() => {
    if (initialDraft !== undefined) {
      setText(initialDraft);
      textareaRef.current?.focus();
      // Move caret to the end after the quote block.
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) el.setSelectionRange(el.value.length, el.value.length);
      });
    }
    if (initialAgentId !== undefined) setAgentId(initialAgentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  // If the picker's selection becomes stale (agent deleted), reset.
  useEffect(() => {
    if (agentId && !agents.some((a) => a.id === agentId)) {
      setAgentId(agents[0]?.id ?? "");
    }
  }, [agents, agentId]);

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
  const placeholder = target
    ? t("chat.composer.placeholder", { agent: target.name })
    : t("chat.composer.placeholderNoAgent");

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2.5">
      {create.error ? (
        <p className="mb-2 text-xs text-red-500 dark:text-red-400">
          {create.error.message}
        </p>
      ) : null}
      <div className="flex items-end gap-2">
        <AgentPicker agents={agents} manifests={manifests} value={agentId} onChange={setAgentId} />
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
          className="flex-1 resize-none rounded-2xl border px-3 py-2 text-sm border-zinc-300 bg-zinc-50 text-zinc-900 placeholder-zinc-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:bg-zinc-900 disabled:opacity-50"
        />
        <Button
          size="sm"
          disabled={!agentId || !text.trim() || create.isPending}
          onClick={send}
        >
          {create.isPending ? t("chat.composer.sending") : t("chat.composer.send")}
        </Button>
      </div>
      <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-600 text-right">
        {t("chat.composer.hint")}
      </p>
    </div>
  );
}

function AgentPicker({
  agents,
  manifests,
  value,
  onChange,
}: {
  agents: Agent[];
  manifests: AdapterManifest[];
  value: string;
  onChange: (id: string) => void;
}) {
  const target = agents.find((a) => a.id === value);
  const targetManifest = target
    ? manifests.find((m) => m.kind === target.adapterKind)
    : undefined;

  return (
    <div className="relative shrink-0">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 appearance-none rounded-full border pl-9 pr-7 text-xs font-medium border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-sky-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-600"
      >
        {agents.length === 0 ? (
          <option value="">—</option>
        ) : null}
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            @{a.name}
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2">
        {targetManifest ? (
          <AdapterIcon manifest={targetManifest} size={20} />
        ) : (
          <div className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-800" />
        )}
      </div>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400">
        ▾
      </span>
    </div>
  );
}
