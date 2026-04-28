import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { AdapterManifest, Agent, Run, RunStatus } from "@loom/core";
import { api } from "../api/client.js";
import { Badge, Button } from "./ui.js";
import { AdapterIcon } from "./AdapterIcon.js";
import { useI18n } from "../context/I18nContext.js";

/**
 * Right-rail "chat" for the project Room. Each run becomes one user→agent
 * message pair: the prompt the user typed (or the delegation packet) on the
 * right, the agent's live tail / final result on the left. Delegation lives
 * inline at the foot of a completed agent message.
 */
export function MissionPane({
  projectId,
  selectedAgentId,
  agents,
  runs,
  onClose,
}: {
  projectId: string;
  selectedAgentId: string | null;
  agents: Agent[];
  runs: Run[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const adapters = useQuery({
    queryKey: ["adapters"],
    queryFn: api.listAdapters,
  });
  const manifests = adapters.data?.adapters ?? [];

  const selected = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );
  const thread = useMemo(
    () => buildThread(selected?.id, runs),
    [selected, runs],
  );

  // Auto-scroll to the bottom whenever the thread grows. Don't fight the user
  // if they scrolled up — only force scroll when they were already at bottom.
  const bodyRef = useRef<HTMLDivElement>(null);
  const stickyBottomRef = useRef(true);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickyBottomRef.current = dist < 80;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (stickyBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [thread.length, selectedAgentId]);

  if (!selected) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50/40 dark:bg-zinc-900/30 p-8">
        <div className="text-center">
          <p className="text-3xl">👋</p>
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
            {t("mission.pickAgent")}
          </p>
        </div>
      </div>
    );
  }

  const selectedManifest = manifests.find(
    (m) => m.kind === selected.adapterKind,
  );

  return (
    <div className="flex h-full flex-col rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 overflow-hidden">
      <ChatHeader
        agent={selected}
        manifest={selectedManifest}
        onClose={onClose}
      />
      <div
        ref={bodyRef}
        className="flex-1 overflow-y-auto px-3 py-4 space-y-4 bg-zinc-50/40 dark:bg-zinc-900/40"
      >
        {thread.length === 0 ? (
          <div className="text-center pt-6">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {t("mission.empty")}
            </p>
          </div>
        ) : (
          thread.map((node) => (
            <MessageGroup
              key={node.run.id}
              run={node.run}
              depth={node.depth}
              agents={agents}
              manifests={manifests}
              projectId={projectId}
              isLast={node === thread[thread.length - 1]}
            />
          ))
        )}
      </div>
      <Composer agent={selected} />
    </div>
  );
}

interface ThreadNode {
  run: Run;
  depth: number;
}

function buildThread(
  agentId: string | undefined,
  runs: Run[],
): ThreadNode[] {
  if (!agentId) return [];
  const latest = runs
    .filter((r) => r.agentId === agentId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!latest) return [];

  const byId = new Map(runs.map((r) => [r.id, r]));
  let root = latest;
  const seenUp = new Set<string>([latest.id]);
  while (root.parentRunId) {
    const next = byId.get(root.parentRunId);
    if (!next || seenUp.has(next.id)) break;
    seenUp.add(next.id);
    root = next;
  }

  const out: ThreadNode[] = [];
  const queue: ThreadNode[] = [{ run: root, depth: 0 }];
  const visited = new Set<string>();
  while (queue.length) {
    const cur = queue.shift()!;
    if (visited.has(cur.run.id)) continue;
    visited.add(cur.run.id);
    out.push(cur);
    const kids = runs
      .filter((r) => r.parentRunId === cur.run.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const k of kids) queue.push({ run: k, depth: cur.depth + 1 });
  }
  return out;
}

function ChatHeader({
  agent,
  manifest,
  onClose,
}: {
  agent: Agent;
  manifest: AdapterManifest | undefined;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2.5">
      {manifest ? <AdapterIcon manifest={manifest} size={26} /> : null}
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm truncate leading-tight">
          {agent.name}
        </p>
        <p className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate">
          {agent.role ? `${agent.role} · ` : ""}
          {manifest?.displayName ?? agent.adapterKind}
        </p>
      </div>
      <button
        onClick={onClose}
        title={t("mission.close")}
        className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        aria-label={t("mission.close")}
      >
        ✕
      </button>
    </div>
  );
}

function Composer({ agent }: { agent: Agent }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const create = useMutation({
    mutationFn: api.createRun,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["runs"] });
      setPrompt("");
    },
  });

  const send = () => {
    if (!prompt || create.isPending) return;
    create.mutate({ agentId: agent.id, prompt });
  };

  // Reset draft when switching to a different agent.
  useEffect(() => {
    setPrompt("");
  }, [agent.id]);

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2.5">
      {create.error ? (
        <p className="mb-2 text-xs text-red-500 dark:text-red-400">
          {create.error.message}
        </p>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={t("mission.composer.placeholder", { agent: agent.name })}
          className="flex-1 resize-none rounded-2xl border px-3 py-2 text-sm border-zinc-300 bg-zinc-50 text-zinc-900 placeholder-zinc-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:bg-zinc-900"
        />
        <Button
          size="sm"
          disabled={!prompt || create.isPending}
          onClick={send}
        >
          {create.isPending ? "…" : t("mission.composer.start")}
        </Button>
      </div>
      <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-600">
        {t("mission.composer.hint")}
      </p>
    </div>
  );
}

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

function MessageGroup({
  run,
  depth,
  agents,
  manifests,
  projectId,
  isLast,
}: {
  run: Run;
  depth: number;
  agents: Agent[];
  manifests: AdapterManifest[];
  projectId: string;
  isLast: boolean;
}) {
  const agent = agents.find((a) => a.id === run.agentId);
  const manifest = manifests.find((m) => m.kind === agent?.adapterKind);
  const isActive = run.status === "queued" || run.status === "running";
  const { events, resultText } = useRunTail(run.id, isActive);

  // Other agents in this project — every teammate is a possible delegation
  // target. The user picks one; manager hierarchy doesn't constrain.
  const teammates = useMemo(
    () =>
      agents.filter(
        (a) =>
          a.id !== run.agentId &&
          a.projectId === agent?.projectId,
      ),
    [agents, agent, run.agentId],
  );

  // Visualize parentRunId as the start of a delegation: the user's text was
  // sent to a *different* agent, so render the prompt with a "delegated to"
  // label instead of plain user message.
  const isDelegated = depth > 0;

  return (
    <div className="space-y-2" data-depth={depth}>
      {/* User / delegate bubble */}
      <UserBubble
        prompt={run.prompt}
        isDelegated={isDelegated}
        targetName={agent?.name}
      />

      {/* Agent reply bubble */}
      <AgentBubble
        agent={agent}
        manifest={manifest}
        run={run}
        events={events}
        resultText={resultText}
        isActive={isActive}
        projectId={projectId}
      />

      {/* Inline action row for delegation — only on the leaf, on success. */}
      {isLast && run.status === "succeeded" && teammates.length > 0 ? (
        <DelegateRow
          parentRun={run}
          teammates={teammates}
          parentResultText={resultText}
        />
      ) : null}
    </div>
  );
}

function UserBubble({
  prompt,
  isDelegated,
  targetName,
}: {
  prompt: string;
  isDelegated: boolean;
  targetName?: string;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const limit = 320;
  const long = prompt.length > limit;
  const display = expanded || !long ? prompt : `${prompt.slice(0, limit)}…`;
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] space-y-1">
        <p className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500 text-right pr-1">
          {isDelegated && targetName
            ? t("mission.role.delegated", { agent: targetName })
            : t("mission.role.you")}
        </p>
        <div className="rounded-2xl rounded-tr-sm bg-sky-500 px-3 py-2 text-sm text-white whitespace-pre-wrap break-words shadow-sm dark:bg-sky-600">
          {display}
          {long ? (
            <button
              className="ml-2 text-[11px] underline text-sky-100/90"
              onClick={() => setExpanded((s) => !s)}
            >
              {expanded ? t("mission.bubble.showLess") : t("mission.bubble.showMore")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AgentBubble({
  agent,
  manifest,
  run,
  events,
  resultText,
  isActive,
  projectId,
}: {
  agent: Agent | undefined;
  manifest: AdapterManifest | undefined;
  run: Run;
  events: TailEvent[];
  resultText: string | null;
  isActive: boolean;
  projectId: string;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-start gap-2">
      <div className="shrink-0 mt-0.5">
        {manifest ? (
          <AdapterIcon manifest={manifest} size={28} />
        ) : (
          <div className="w-7 h-7 rounded-full bg-zinc-200 dark:bg-zinc-800" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-zinc-500">
          <span className="font-medium normal-case text-xs text-zinc-700 dark:text-zinc-300 truncate">
            {agent?.name ?? run.agentId.slice(0, 8)}
          </span>
          <Badge tone={statusTone(run.status)}>{t(`status.${run.status}`)}</Badge>
        </div>

        <div
          className={
            "rounded-2xl rounded-tl-sm border px-3 py-2 text-sm shadow-sm transition-colors " +
            (isActive
              ? "border-sky-300 bg-white ring-2 ring-sky-100 dark:border-sky-800 dark:bg-zinc-900 dark:ring-sky-950"
              : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900")
          }
        >
          {events.length === 0 && !resultText ? (
            <p className="text-xs italic text-zinc-400">
              {isActive ? t("mission.tail.empty") : "—"}
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

        <div className="flex justify-end">
          <Link
            to={`/projects/${projectId}/runs/${run.id}`}
            className="text-[10px] text-zinc-400 hover:text-sky-600 hover:underline dark:hover:text-sky-300"
          >
            {t("mission.openFull")}
          </Link>
        </div>
      </div>
    </div>
  );
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
          // non-JSON line — skip in chat view
        }
      }
      if (next.length) {
        setEvents((prev) => [...prev, ...next].slice(-20));
      }
      if (pickedResult !== null) setResultText(pickedResult);
    };

    ev.addEventListener("chunk", onChunk);
    ev.addEventListener("done", () => ev.close());
    ev.onerror = () => ev.close();
    return () => ev.close();
  }, [runId, active]);

  return { events, resultText };
}

function DelegateRow({
  parentRun,
  teammates,
  parentResultText,
}: {
  parentRun: Run;
  teammates: Agent[];
  parentResultText: string | null;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [target, setTarget] = useState<Agent | null>(null);
  const [includeParent, setIncludeParent] = useState(true);
  const [prompt, setPrompt] = useState("");

  const create = useMutation({
    mutationFn: api.createRun,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["runs"] });
      setTarget(null);
      setPrompt("");
    },
  });

  // Few teammates → chips. Many → dropdown so the row stays compact.
  const useDropdown = teammates.length > 4;

  if (target) {
    const composedPrompt =
      includeParent && parentResultText
        ? `[parent output]\n${parentResultText}\n\n---\n\n${prompt}`
        : prompt;
    return (
      <div className="ml-9 rounded-2xl border border-sky-300 bg-sky-50/60 px-3 py-2.5 space-y-2 dark:border-sky-900/50 dark:bg-sky-950/30">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-sky-900 dark:text-sky-200">
            → {target.name}
          </p>
          <button
            className="text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            onClick={() => setTarget(null)}
          >
            ✕
          </button>
        </div>
        {parentResultText ? (
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={includeParent}
              onChange={(e) => setIncludeParent(e.target.checked)}
            />
            {t("mission.delegate.includeParent")}
          </label>
        ) : null}
        <textarea
          rows={3}
          autoFocus
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && prompt) {
              e.preventDefault();
              create.mutate({
                agentId: target.id,
                prompt: composedPrompt,
                parentRunId: parentRun.id,
              });
            }
          }}
          placeholder={t("mission.delegate.promptPlaceholder")}
          className="w-full resize-none rounded-xl border px-2.5 py-1.5 text-sm border-zinc-300 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-sky-300"
        />
        {create.error ? (
          <p className="text-xs text-red-500 dark:text-red-400">
            {create.error.message}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={!prompt || create.isPending}
            onClick={() =>
              create.mutate({
                agentId: target.id,
                prompt: composedPrompt,
                parentRunId: parentRun.id,
              })
            }
          >
            {create.isPending ? "…" : t("mission.delegate.send")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="ml-9 flex flex-wrap items-center gap-1.5 pt-0.5">
      <span className="text-[11px] text-zinc-500">
        {t("mission.delegate.label")}
      </span>
      {useDropdown ? (
        <select
          className="h-6 rounded-md border px-1.5 text-xs border-zinc-300 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          value=""
          onChange={(e) => {
            const t = teammates.find((a) => a.id === e.target.value);
            if (t) setTarget(t);
          }}
        >
          <option value="">{t("mission.delegate.placeholder")}</option>
          {teammates.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.role ? ` (${a.role})` : ""}
            </option>
          ))}
        </select>
      ) : (
        teammates.map((a) => (
          <button
            key={a.id}
            onClick={() => setTarget(a)}
            className="rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs text-sky-700 transition-colors hover:bg-sky-100 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-300 dark:hover:bg-sky-950/60"
          >
            @{a.name}
          </button>
        ))
      )}
    </div>
  );
}
