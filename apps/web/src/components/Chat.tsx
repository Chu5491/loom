import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  CornerDownLeft,
  Forward,
  MessageSquareReply,
  Send,
  X,
} from "lucide-react";
import type { AdapterManifest, Agent, Run, RunStatus } from "@loom/core";
import { api } from "../api/client.js";
import { AdapterIcon } from "./AdapterIcon.js";
import { Avatar, AvatarFallback } from "./ui/avatar.js";
import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select.js";
import { TooltipProvider } from "./ui/tooltip.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";
import { agentColorFor, classesFor, initialFor } from "./agentColor.js";

/**
 * Group-chat view of a project, built on shadcn primitives.
 *
 * Restrained palette — neutral background with one tinted accent per
 * agent (used only on the avatar fill + a hairline left rail). Status,
 * spacing, typography come from shadcn tokens so the room reads like a
 * proper workspace rather than a multi-color demo.
 */

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
  size = "md",
}: {
  agent: Agent;
  manifest: AdapterManifest | undefined;
  working?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const cls = classesFor(agentColorFor(agent.id));
  // The avatar IS the brand mark — the adapter's logo painted on a
  // tinted disc. The agent-color tint preserves per-agent identity
  // (two Claude agents in the same room are still distinguishable by
  // their disc hue) while the logo carries the brand.
  const dim = size === "sm" ? "size-6" : size === "lg" ? "size-10" : "size-8";
  const inner = size === "sm" ? 16 : size === "lg" ? 24 : 20;

  return (
    <span className="relative inline-block shrink-0">
      <Avatar className={dim}>
        <AvatarFallback className={cn("p-0", cls.bgSoft)}>
          {manifest ? (
            <AdapterIcon manifest={manifest} size={inner} />
          ) : (
            <span className={cn("text-xs font-semibold", cls.text)}>
              {initialFor(agent.name)}
            </span>
          )}
        </AvatarFallback>
      </Avatar>
      {working ? (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-background",
            cls.dot,
          )}
        />
      ) : null}
    </span>
  );
}

function UserAvatar({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const dim = size === "sm" ? "h-7 w-7 text-[11px]" : size === "lg" ? "h-10 w-10 text-sm" : "h-8 w-8 text-xs";
  return (
    <Avatar className={dim}>
      <AvatarFallback className="bg-foreground text-background font-semibold">
        나
      </AvatarFallback>
    </Avatar>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Member panel
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
    <div className="flex items-center gap-2 overflow-x-auto border-b bg-muted/30 px-4 py-2">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t("chat.members.title")} · {agents.length}
      </span>
      {agents.map((a) => {
        const manifest = manifests.find((m) => m.kind === a.adapterKind);
        const working = workingIds.has(a.id);
        const selected = selectedAgentId === a.id;
        const cls = classesFor(agentColorFor(a.id));
        return (
          <button
            key={a.id}
            onClick={() => onPick(a.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-full pl-0.5 pr-2.5 py-0.5 text-xs font-medium transition-colors border shrink-0",
              selected
                ? "border-foreground bg-background text-foreground shadow-sm"
                : "border-border bg-background/60 text-muted-foreground hover:border-foreground/40 hover:text-foreground",
            )}
          >
            <AgentAvatar agent={a} manifest={manifest} working={working} size="sm" />
            <span>@{a.name}</span>
            {working ? (
              <span className={cn("size-1.5 rounded-full", cls.dot)} />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Messages
// ────────────────────────────────────────────────────────────────────────────

export function UserMessage({
  run,
  target,
}: {
  run: Run;
  target: Agent | undefined;
}) {
  const { t } = useI18n();
  const cls = target ? classesFor(agentColorFor(target.id)) : null;
  return (
    <Row
      avatar={<UserAvatar />}
      name={t("chat.message.you")}
      timestamp={run.createdAt}
      tag={
        target ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <CornerDownLeft className="size-3 -scale-x-100" />
            <span className={cn("font-medium", cls?.text)}>@{target.name}</span>
          </span>
        ) : undefined
      }
    >
      <div className="rounded-lg bg-card border px-3 py-2 text-sm whitespace-pre-wrap break-words shadow-sm">
        {run.prompt}
      </div>
    </Row>
  );
}

function statusVariant(s: RunStatus): "info" | "success" | "destructive" | "warning" | "secondary" {
  switch (s) {
    case "succeeded":
      return "success";
    case "failed":
      return "destructive";
    case "cancelled":
      return "warning";
    case "running":
    case "queued":
      return "info";
    default:
      return "secondary";
  }
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
  const cls = agent ? classesFor(agentColorFor(agent.id)) : null;

  // For completed runs we may have missed the SSE stream entirely (e.g.
  // we opened the page after the run already terminated). Pull the final
  // result from the log file in that case so the bubble has content.
  const restingResult = useQuery({
    queryKey: ["run", run.id, "result"],
    queryFn: () => api.getRunResult(run.id),
    enabled:
      !isActive &&
      run.status === "succeeded" &&
      events.length === 0 &&
      resultText === null,
    staleTime: 60_000,
  });
  const finalText = resultText ?? restingResult.data?.resultText ?? null;
  const hasContent = events.length > 0 || finalText !== null;

  return (
    <Row
      avatar={
        agent ? (
          <AgentAvatar agent={agent} manifest={manifest} working={isActive} />
        ) : (
          <Avatar>
            <AvatarFallback>?</AvatarFallback>
          </Avatar>
        )
      }
      name={name}
      nameClassName={cls?.text}
      timestamp={run.createdAt}
      tag={
        <Badge variant={statusVariant(run.status)} className="h-5 px-1.5 text-[10px] gap-1">
          {isActive ? <span className="size-1.5 rounded-full bg-current animate-pulse" /> : null}
          {t(`status.${run.status}`)}
        </Badge>
      }
      leftRailClass={cls?.border}
    >
      <div
        className={cn(
          "rounded-lg border px-3 py-2 text-sm transition-colors",
          isActive ? "bg-muted/40 border-foreground/15" : "bg-card",
        )}
      >
        {!hasContent ? (
          <p className="text-xs italic text-muted-foreground">
            {isActive ? t("chat.tail.waiting") : "—"}
          </p>
        ) : (
          <div className="space-y-1.5">
            {events.map((evt, i) => (
              <p key={i} className="whitespace-pre-wrap break-words leading-relaxed">
                {evt.kind === "tool" ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground mono">
                    <span aria-hidden>🛠</span>
                    <span>{evt.text}</span>
                  </span>
                ) : evt.kind === "system" ? (
                  <span className="text-xs text-muted-foreground">· {evt.text}</span>
                ) : (
                  <span>{evt.text}</span>
                )}
              </p>
            ))}
            {finalText ? (
              <p
                className={cn(
                  "whitespace-pre-wrap break-words",
                  events.length > 0 && "border-t pt-1.5",
                )}
              >
                {finalText}
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
          <Link to={`/runs/${run.id}`}>{t("chat.message.openLog")}</Link>
        </Button>
        {!isActive ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onReply(run, agent)}
            >
              <MessageSquareReply />
              {t("chat.message.reply")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onForward(run, agent)}
            >
              <Forward />
              {t("chat.message.forward")}
            </Button>
          </>
        ) : null}
        {isActive ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
            disabled={cancel.isPending}
            onClick={() => {
              if (confirm(t("chat.message.cancelConfirm"))) cancel.mutate();
            }}
          >
            <X />
            {t("chat.message.cancel")}
          </Button>
        ) : null}
      </div>
    </Row>
  );
}

function Row({
  avatar,
  name,
  nameClassName,
  timestamp,
  tag,
  leftRailClass,
  children,
}: {
  avatar: React.ReactNode;
  name: string;
  nameClassName?: string;
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
          <span className={cn("text-sm font-semibold", nameClassName)}>{name}</span>
          {tag}
          <span className="ml-auto text-[10px] text-muted-foreground/60 mono opacity-0 group-hover:opacity-100 transition-opacity">
            {new Date(timestamp).toLocaleTimeString()}
          </span>
        </div>
        <div className={cn(leftRailClass && "border-l-2 -ml-3 pl-3", leftRailClass)}>
          {children}
        </div>
      </div>
    </div>
  );
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
    <div className="flex items-center gap-3 border-t bg-muted/40 px-4 py-2">
      <AvatarStack agents={workingAgents} manifests={manifests} max={4} />
      <span className="text-xs font-medium text-foreground">{label}</span>
      <span className="ml-auto flex gap-1">
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
    <div className="flex -space-x-1.5">
      {visible.map((a) => (
        <span key={a.id} className="ring-2 ring-background rounded-full">
          <AgentAvatar
            agent={a}
            manifest={manifests.find((m) => m.kind === a.adapterKind)}
            size="sm"
          />
        </span>
      ))}
      {overflow > 0 ? (
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted ring-2 ring-background text-[10px] font-medium text-muted-foreground">
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      className="size-1.5 rounded-full bg-foreground/60 animate-bounce"
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
    <div className="border-t bg-card px-3 py-3">
      {create.error ? (
        <p className="mb-2 text-xs text-destructive px-1">{create.error.message}</p>
      ) : null}
      <div className="rounded-xl border bg-background focus-within:ring-1 focus-within:ring-ring transition-all">
        <div className="flex items-center justify-between gap-2 px-2 pt-2">
          <Select value={agentId} onValueChange={onAgentChange}>
            <SelectTrigger className="h-7 w-auto gap-2 border-0 bg-muted/60 hover:bg-muted px-2 shadow-none focus:ring-0 [&>svg]:opacity-100">
              <SelectValue>
                {target ? (
                  <span className="flex items-center gap-1.5">
                    <AgentAvatar
                      agent={target}
                      manifest={targetManifest}
                      size="sm"
                    />
                    <span className={cn("text-xs font-semibold", targetCls?.text)}>
                      @{target.name}
                    </span>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="start">
              {agents.map((a) => {
                const m = manifests.find((mm) => mm.kind === a.adapterKind);
                const c = classesFor(agentColorFor(a.id));
                return (
                  <SelectItem key={a.id} value={a.id} className="pl-8">
                    <span className="flex items-center gap-2">
                      <AgentAvatar agent={a} manifest={m} size="sm" />
                      <span className={cn("text-sm font-medium", c.text)}>
                        @{a.name}
                      </span>
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <span className="text-[10px] text-muted-foreground/70">
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
          className="w-full resize-none bg-transparent px-3 pb-2 pt-1 text-sm placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
        />
        <div className="flex justify-end px-2 pb-2">
          <Button
            size="sm"
            disabled={!agentId || !text.trim() || create.isPending}
            onClick={send}
          >
            {create.isPending ? (
              t("chat.composer.sending")
            ) : (
              <>
                <Send /> {t("chat.composer.send")}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
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

/** Wrap consumers in TooltipProvider once at the top of the chat root. */
export { TooltipProvider };
