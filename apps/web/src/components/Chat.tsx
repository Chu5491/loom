import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { marked } from "marked";
import {
  ArrowRight,
  CornerDownLeft,
  Forward,
  MessageSquareReply,
  MoreHorizontal,
  Plus,
  Send,
  X,
} from "lucide-react";
import type { AdapterManifest, Agent, Run, RunStatus } from "@loom/core";
import { api } from "../api/client.js";
import { AdapterIcon } from "./AdapterIcon.js";
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
import { agentColorFor, classesFor } from "./agentColor.js";

marked.setOptions({ breaks: true, gfm: true });

/**
 * Render an agent's markdown reply. The text comes from the CLI which is
 * effectively LLM output — we render it as markdown for code blocks /
 * lists / headings, and ride the existing `prose-loom` typography rules
 * (already used by the spec preview).
 *
 * For commercial / hosted use we'd add DOMPurify here; for the current
 * single-user local tool we trust the local CLI output.
 */
function MarkdownView({ text }: { text: string }) {
  const html = useMemo(() => marked.parse(text) as string, [text]);
  return (
    <div
      className="prose-loom max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * Slack/Discord-style chat for a project room.
 *
 * Messages flow as a single timeline of inline text rows (no bubbles).
 * Consecutive messages from the same sender within a short window
 * collapse — only the first row in a group shows avatar + name + ts.
 * Date separators ("Today", "Yesterday") group the timeline. Hover on
 * a row reveals timestamps and action buttons (reply / forward) like
 * Slack's hover toolbar.
 */

const CONTINUATION_WINDOW_MS = 5 * 60 * 1000;

// ────────────────────────────────────────────────────────────────────────────
// SSE tail
// ────────────────────────────────────────────────────────────────────────────

interface TailEvent {
  kind: "text" | "tool";
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
          }
          // System events (init, hook_started, hook_response, compact_boundary,
          // …) are CLI lifecycle metadata — useful in the full log page but
          // pure noise in the conversation view, so we skip them here.
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
// Avatars (size: sm 24, md 36, lg 40)
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
  const dim = size === "sm" ? "size-6" : size === "lg" ? "size-10" : "size-9";
  // The lobehub icons already carry brand color, so the avatar wrapper
  // is intentionally bare — no tinted disc, no ring. Working state is a
  // small color dot at the bottom-right for presence convention.
  const inner = size === "sm" ? 20 : size === "lg" ? 36 : 32;

  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", dim)}>
      {manifest ? (
        <AdapterIcon manifest={manifest} size={inner} />
      ) : (
        <span className={cn("text-xs font-semibold", cls.text)}>?</span>
      )}
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
  const dim = size === "sm" ? "size-6 text-[11px]" : size === "lg" ? "size-10 text-base" : "size-9 text-sm";
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center font-semibold text-foreground", dim)}>
      나
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Member rail (right side, always vertical)
// ────────────────────────────────────────────────────────────────────────────

export function MemberRail({
  agents,
  manifests,
  workingIds,
  selectedAgentId,
  onPick,
  projectId,
}: {
  agents: Agent[];
  manifests: AdapterManifest[];
  workingIds: Set<string>;
  selectedAgentId?: string;
  onPick: (agentId: string) => void;
  projectId: string;
}) {
  const { t } = useI18n();
  const working = agents.filter((a) => workingIds.has(a.id));
  const idle = agents.filter((a) => !workingIds.has(a.id));

  return (
    <aside className="hidden xl:flex h-full w-64 shrink-0 flex-col border-l bg-muted/20">
      <div className="flex items-center justify-between px-4 h-14 border-b shrink-0">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("chat.members.title")} · {agents.length}
        </h2>
        <Button asChild variant="ghost" size="icon" className="size-7 text-muted-foreground">
          <Link
            to={`/agents?projectId=${projectId}`}
            aria-label={t("chat.manageAgents")}
          >
            <Plus />
          </Link>
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {working.length > 0 ? (
          <MemberSection
            label={`— ${t("chat.members.working")} — ${working.length}`}
            agents={working}
            manifests={manifests}
            workingIds={workingIds}
            selectedAgentId={selectedAgentId}
            onPick={onPick}
          />
        ) : null}
        {idle.length > 0 ? (
          <MemberSection
            label={`— ${t("chat.members.idle")} — ${idle.length}`}
            agents={idle}
            manifests={manifests}
            workingIds={workingIds}
            selectedAgentId={selectedAgentId}
            onPick={onPick}
          />
        ) : null}
      </div>
    </aside>
  );
}

function MemberSection({
  label,
  agents,
  manifests,
  workingIds,
  selectedAgentId,
  onPick,
}: {
  label: string;
  agents: Agent[];
  manifests: AdapterManifest[];
  workingIds: Set<string>;
  selectedAgentId?: string;
  onPick: (agentId: string) => void;
}) {
  return (
    <div className="mb-3">
      <div className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <ul className="space-y-px">
        {agents.map((a) => {
          const m = manifests.find((mm) => mm.kind === a.adapterKind);
          const cls = classesFor(agentColorFor(a.id));
          const selected = selectedAgentId === a.id;
          return (
            <li key={a.id}>
              <button
                onClick={() => onPick(a.id)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors",
                  selected
                    ? "bg-foreground/5"
                    : "hover:bg-foreground/5",
                )}
              >
                <AgentAvatar
                  agent={a}
                  manifest={m}
                  working={workingIds.has(a.id)}
                  size="sm"
                />
                <span className={cn("flex-1 truncate text-sm", cls.text, "font-medium")}>
                  {a.name}
                </span>
                {a.role ? (
                  <span className="text-[10px] text-muted-foreground/70">
                    {a.role}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Date separators
// ────────────────────────────────────────────────────────────────────────────

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string, t: (key: string) => string): string {
  const d = new Date(iso);
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yKey = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`;
  const k = dayKey(iso);
  if (k === todayKey) return t("chat.today");
  if (k === yKey) return t("chat.yesterday");
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function DaySeparator({ ts }: { ts: string }) {
  const { t } = useI18n();
  return (
    <div className="sticky top-0 z-10 my-3 flex items-center gap-3 px-1">
      <div className="flex-1 border-t" />
      <span className="rounded-full border bg-background px-3 py-0.5 text-[11px] font-medium text-muted-foreground shadow-sm">
        {dayLabel(ts, t)}
      </span>
      <div className="flex-1 border-t" />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Messages (Slack-style — no bubbles, continuation grouping)
// ────────────────────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MessageRow({
  avatar,
  name,
  nameClassName,
  timestamp,
  tag,
  isContinuation,
  actions,
  children,
}: {
  avatar: React.ReactNode;
  name: string;
  nameClassName?: string;
  timestamp: string;
  tag?: React.ReactNode;
  isContinuation: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "group relative flex items-start gap-3 px-5 py-0.5 hover:bg-foreground/[0.03]",
        !isContinuation && "mt-2 pt-1.5",
      )}
    >
      <div className="w-9 shrink-0 mt-0.5">
        {isContinuation ? (
          <span className="invisible group-hover:visible block text-right text-[10px] text-muted-foreground/70 mono leading-9 -mt-2">
            {fmtTime(timestamp)}
          </span>
        ) : (
          avatar
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!isContinuation ? (
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className={cn("text-sm font-semibold", nameClassName)}>{name}</span>
            <span className="text-[11px] text-muted-foreground mono">
              {fmtTime(timestamp)}
            </span>
            {tag}
          </div>
        ) : null}
        {children}
      </div>
      {actions ? (
        <div className="absolute right-4 -top-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

function HoverActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border bg-background shadow-sm px-1 py-0.5">
      {children}
    </div>
  );
}

function HoverButton({
  onClick,
  icon,
  label,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 text-muted-foreground hover:text-foreground"
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {icon}
    </Button>
  );
}

export function UserMessage({
  run,
  target,
  parentAgent,
  isContinuation,
}: {
  run: Run;
  target: Agent | undefined;
  /** When the run continues from a previous run in the same thread, the
   *  agent that produced that parent's output. We surface a small
   *  "↳ from @prev" line above the prompt so the hand-off is explicit. */
  parentAgent?: Agent;
  isContinuation: boolean;
}) {
  const { t } = useI18n();
  const cls = target ? classesFor(agentColorFor(target.id)) : null;
  const parentCls = parentAgent
    ? classesFor(agentColorFor(parentAgent.id))
    : null;
  return (
    <MessageRow
      avatar={<UserAvatar />}
      name={t("chat.message.you")}
      timestamp={run.createdAt}
      isContinuation={isContinuation}
      tag={
        target ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <ArrowRight className="size-3" />
            <span className={cn("font-medium", cls?.text)}>@{target.name}</span>
          </span>
        ) : undefined
      }
    >
      {parentAgent ? (
        <p className="text-[11px] text-muted-foreground mb-1 inline-flex items-center gap-1">
          <CornerDownLeft className="size-3 -scale-x-100" />
          {t("chat.thread.fromAgent", { agent: "" })}
          <span className={cn("font-medium", parentCls?.text)}>
            @{parentAgent.name}
          </span>
        </p>
      ) : null}
      <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
        {run.prompt}
      </p>
    </MessageRow>
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
  isContinuation,
  onReply,
  onForward,
}: {
  run: Run;
  agent: Agent | undefined;
  manifest: AdapterManifest | undefined;
  isContinuation: boolean;
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

  const name = agent?.name ?? run.agentId.slice(0, 8);
  const cls = agent ? classesFor(agentColorFor(agent.id)) : null;
  const finalText = resultText ?? restingResult.data?.resultText ?? null;
  const hasContent = events.length > 0 || finalText !== null;

  return (
    <MessageRow
      avatar={
        agent ? (
          <AgentAvatar agent={agent} manifest={manifest} working={isActive} />
        ) : (
          <span className="size-9 inline-flex items-center justify-center text-xs text-muted-foreground">
            ?
          </span>
        )
      }
      name={name}
      nameClassName={cls?.text}
      timestamp={run.createdAt}
      isContinuation={isContinuation}
      tag={
        <Badge variant={statusVariant(run.status)} className="h-4 px-1.5 text-[9px] gap-1">
          {isActive ? <span className="size-1 rounded-full bg-current animate-pulse" /> : null}
          {t(`status.${run.status}`)}
        </Badge>
      }
      actions={
        <HoverActions>
          {!isActive ? (
            <>
              <HoverButton
                onClick={() => onReply(run, agent)}
                icon={<MessageSquareReply />}
                label={t("chat.message.reply")}
              />
              <HoverButton
                onClick={() => onForward(run, agent)}
                icon={<Forward />}
                label={t("chat.message.forward")}
              />
            </>
          ) : (
            <HoverButton
              onClick={() => {
                if (confirm(t("chat.message.cancelConfirm"))) cancel.mutate();
              }}
              icon={<X />}
              label={t("chat.message.cancel")}
            />
          )}
          <Button asChild variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-foreground">
            <Link to={`/runs/${run.id}`} aria-label={t("chat.message.openLog")}>
              <MoreHorizontal />
            </Link>
          </Button>
        </HoverActions>
      }
    >
      {!hasContent ? (
        <p className="text-sm italic text-muted-foreground">
          {isActive ? t("chat.tail.waiting") : "—"}
        </p>
      ) : (
        <div className="space-y-1.5">
          {/*
           * Tool calls + system events are metadata about how the agent
           * worked — always shown, in compact mono form. Streaming text
           * is only shown while finalText is missing; once the run's
           * result.result lands it replaces the partial text so we don't
           * render the same answer twice.
           */}
          {events.map((evt, i) => {
            if (evt.kind === "tool") {
              return (
                <p
                  key={i}
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground mono"
                >
                  <span aria-hidden>🛠</span>
                  <span>{evt.text}</span>
                </p>
              );
            }
            // text — only while we're still streaming. Once result lands,
            // finalText is the canonical answer and we drop the partials.
            if (finalText !== null) return null;
            return <MarkdownView key={i} text={evt.text} />;
          })}
          {finalText ? <MarkdownView text={finalText} /> : null}
        </div>
      )}
    </MessageRow>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Working indicator (small strip above composer)
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
    <div className="flex items-center gap-2 px-5 py-1.5 text-xs text-muted-foreground bg-background">
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
      className="size-1 rounded-full bg-foreground/50 animate-bounce"
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

  // Auto-grow textarea up to 8 rows.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = 8 * 20; // ~8 lines at 20px line-height
    el.style.height = Math.min(el.scrollHeight, max) + "px";
  }, [text]);

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
    <div className="px-5 pb-4 pt-1 bg-background shrink-0">
      {create.error ? (
        <p className="mb-2 text-xs text-destructive">{create.error.message}</p>
      ) : null}
      <div className="rounded-lg border bg-background focus-within:ring-1 focus-within:ring-ring transition-shadow">
        <textarea
          ref={textareaRef}
          rows={1}
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
          className="w-full resize-none bg-transparent px-3.5 py-3 text-sm placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
          style={{ minHeight: "40px" }}
        />
        <div className="flex items-center justify-between gap-2 border-t px-2 py-1.5">
          <Select value={agentId} onValueChange={onAgentChange}>
            <SelectTrigger className="h-7 w-auto gap-1.5 border-0 bg-transparent hover:bg-muted px-2 shadow-none focus:ring-0 [&>svg]:opacity-50">
              <SelectValue>
                {target ? (
                  <span className="flex items-center gap-1.5">
                    <AgentAvatar agent={target} manifest={targetManifest} size="sm" />
                    <span className={cn("text-xs font-medium", targetCls?.text)}>
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
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground/70">
              {t("chat.composer.hint")}
            </span>
            <Button
              size="icon"
              className="size-7"
              disabled={!agentId || !text.trim() || create.isPending}
              onClick={send}
            >
              <Send />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers (quote builders, feed derivation)
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
  /** Sender id for continuation grouping ("user" or agent.id). */
  senderId: string;
}

/**
 * A thread is a chain of related runs — root + every run that descends
 * from it via parentRunId. We render each thread as a visual unit so
 * a multi-step "ask → answer → forward → answer → forward …" sequence
 * reads as one collaboration rather than scattered messages.
 */
export interface ThreadGroup {
  rootId: string;
  runs: Run[];
  items: FeedItem[];
  firstTs: string;
  lastTs: string;
}

function rootRunId(run: Run, byId: Map<string, Run>): string {
  let cur = run;
  let depth = 0;
  while (cur.parentRunId && depth < 50) {
    const parent = byId.get(cur.parentRunId);
    if (!parent) break;
    cur = parent;
    depth++;
  }
  return cur.id;
}

function buildThreadGroups(runs: Run[]): ThreadGroup[] {
  const byId = new Map(runs.map((r) => [r.id, r]));
  const groups = new Map<string, Run[]>();
  for (const r of runs) {
    const root = rootRunId(r, byId);
    const arr = groups.get(root) ?? [];
    arr.push(r);
    groups.set(root, arr);
  }
  const threads: ThreadGroup[] = [];
  for (const [rootId, ofThread] of groups) {
    const sorted = [...ofThread].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    const items: FeedItem[] = [];
    for (const r of sorted) {
      items.push({ kind: "user", run: r, ts: r.createdAt, senderId: "user" });
      items.push({
        kind: "agent",
        run: r,
        ts: r.startedAt ?? r.createdAt,
        senderId: r.agentId,
      });
    }
    items.sort((a, b) => a.ts.localeCompare(b.ts));
    threads.push({
      rootId,
      runs: sorted,
      items,
      firstTs: items[0]!.ts,
      // Use the *latest* event in the thread, not just createdAt — an
      // active run that's still streaming should keep the thread "fresh".
      lastTs: items[items.length - 1]!.ts,
    });
  }
  // Oldest activity first → newest at the bottom (chat convention).
  threads.sort((a, b) => a.lastTs.localeCompare(b.lastTs));
  return threads;
}

export function useRoomDerived(
  runs: Run[],
  agents: Agent[],
): {
  threads: ThreadGroup[];
  working: Agent[];
  workingIds: Set<string>;
} {
  return useMemo(() => {
    const workingIds = workingAgentIdsFromRuns(runs);
    return {
      threads: buildThreadGroups(runs),
      working: agents.filter((a) => workingIds.has(a.id)),
      workingIds,
    };
  }, [runs, agents]);
}

/**
 * Within a thread, fold consecutive same-sender messages (≤5 min apart)
 * so we don't repeat avatar+name on every line. Continuation grouping is
 * always thread-local — across threads the same agent always re-introduces.
 */
export function isContinuation(curr: FeedItem, prev: FeedItem | undefined): boolean {
  if (!prev) return false;
  if (prev.senderId !== curr.senderId) return false;
  if (dayKey(prev.ts) !== dayKey(curr.ts)) return false;
  const delta = new Date(curr.ts).getTime() - new Date(prev.ts).getTime();
  return delta < CONTINUATION_WINDOW_MS;
}

// ────────────────────────────────────────────────────────────────────────────
// Thread frame
// ────────────────────────────────────────────────────────────────────────────

export function ThreadFrame({
  thread,
  children,
}: {
  thread: ThreadGroup;
  children: React.ReactNode;
}) {
  const isMulti = thread.runs.length > 1;
  return (
    <div
      className={cn(
        "py-1",
        isMulti && "relative pl-3 ml-3 border-l-2 border-foreground/[0.08] my-2",
      )}
    >
      {children}
    </div>
  );
}

/** Returns the agent that produced the parent run, if any. */
export function findParentAgent(
  run: Run,
  thread: ThreadGroup,
  agents: Agent[],
): Agent | undefined {
  if (!run.parentRunId) return undefined;
  const parent = thread.runs.find((r) => r.id === run.parentRunId);
  if (!parent) return undefined;
  return agents.find((a) => a.id === parent.agentId);
}

export { dayKey, DaySeparator, TooltipProvider };
