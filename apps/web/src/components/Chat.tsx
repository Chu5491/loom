import {useEffect, useMemo, useRef, useState} from "react";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {Link} from "react-router-dom";
import {marked} from "marked";
import {AnimatePresence, motion} from "motion/react";
import NumberFlow from "@number-flow/react";
import {
    ArrowRight,
    CornerDownLeft,
    Forward,
    MessageSquareReply,
    MoreHorizontal,
    Paperclip,
    Quote,
    Send,
    User,
    X,
} from "lucide-react";
import type {AdapterManifest, Agent, Run, RunStatus} from "@loom/core";
import {api} from "../api/client.js";
import {AdapterIcon} from "./AdapterIcon.js";
import {ChangedFiles} from "./ChangedFiles.js";
import {Badge} from "./ui/badge.js";
import {Button} from "./ui/button.js";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "./ui/select.js";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "./ui/dropdown-menu.js";
import {TooltipProvider} from "./ui/tooltip.js";
import {useI18n} from "../context/I18nContext.js";
import {useTheme} from "../context/ThemeContext.js";
import {cn} from "../lib/utils.js";
import {getHighlighter, isSupportedLang} from "../lib/codeHighlighter.js";
import {agentColorOf, classesFor} from "./agentColor.js";

marked.setOptions({breaks: true, gfm: true});

/** Quick-action prefixes the composer suggests when the user types `/`
 *  at the start of the buffer. Each command is just a text prefix —
 *  the CLI side doesn't parse them, but they label the user's intent
 *  for the agent and for anyone reading the thread later. */
interface SlashCommand {
    cmd: string;
    i18nLabel: string;
    i18nHint: string;
}
const SLASH_COMMANDS: SlashCommand[] = [
    {
        cmd: "/ask",
        i18nLabel: "chat.slash.ask.label",
        i18nHint: "chat.slash.ask.hint",
    },
    {
        cmd: "/fix",
        i18nLabel: "chat.slash.fix.label",
        i18nHint: "chat.slash.fix.hint",
    },
    {
        cmd: "/review",
        i18nLabel: "chat.slash.review.label",
        i18nHint: "chat.slash.review.hint",
    },
    {
        cmd: "/explain",
        i18nLabel: "chat.slash.explain.label",
        i18nHint: "chat.slash.explain.hint",
    },
    {
        cmd: "/test",
        i18nLabel: "chat.slash.test.label",
        i18nHint: "chat.slash.test.hint",
    },
];

/** Markdown view for an agent reply. CLI output is local-trusted in
 *  this tool; a hosted version would route this through DOMPurify.
 *
 *  코드 블록은 marked로 평문 렌더 후 useEffect에서 shiki 결과로 교체 —
 *  첫 페인트는 즉시, 신택스는 점진적 적용. shiki 모듈은 동적 import. */
function MarkdownView({text, streaming}: {text: string; streaming?: boolean}) {
    const html = useMemo(() => marked.parse(text) as string, [text]);
    const ref = useRef<HTMLDivElement>(null);
    const {effective} = useTheme();

    useEffect(() => {
        const root = ref.current;
        if (!root) return;
        const codes = root.querySelectorAll("pre > code");
        if (codes.length === 0) return;

        let cancelled = false;
        const theme = effective === "dark" ? "github-dark" : "github-light";

        void getHighlighter().then((hl) => {
            if (cancelled) return;
            codes.forEach((node) => {
                const code = node.textContent ?? "";
                const langClass = Array.from(node.classList).find((c) =>
                    c.startsWith("language-"),
                );
                const rawLang = langClass?.slice("language-".length) ?? "text";
                const lang = isSupportedLang(rawLang) ? rawLang : "text";
                try {
                    const highlighted = hl.codeToHtml(code, {lang, theme});
                    const pre = node.parentElement;
                    if (pre) pre.outerHTML = highlighted;
                } catch {
                    // 지원되지 않는 언어 — 평문 유지
                }
            });
        });

        return () => {
            cancelled = true;
        };
    }, [html, effective]);

    return (
        <div
            ref={ref}
            className="prose-loom max-w-none relative"
            dangerouslySetInnerHTML={{__html: html + (streaming ? STREAMING_CURSOR : "")}}
        />
    );
}

// 본문 끝에 깜빡이는 커서 — "에이전트가 지금 입력 중" 신호.
// dangerouslySetInnerHTML 안에 들어가야 해서 inline html로 — Tailwind 클래스 + CSS animate-pulse.
const STREAMING_CURSOR = `<span class="inline-block w-1.5 h-4 ml-0.5 -mb-0.5 bg-foreground/70 align-middle animate-pulse rounded-sm"></span>`;

/** Inline timeline (no bubbles). Consecutive messages from the same
 *  sender within `CONTINUATION_WINDOW_MS` fold into one group; only
 *  the first row in the group shows avatar + name + timestamp. */
const CONTINUATION_WINDOW_MS = 5 * 60 * 1000;

interface TailEvent {
    kind: "text" | "tool";
    text: string;
    /** For tool events with a file_path / notebook_path / pattern input —
     *  surfaced in the active-progress indicator so the user sees what
     *  file is being touched right now. */
    detail?: string;
}

/** Pull a short "what is this acting on?" string out of a tool_use's
 *  input. Mirrors the server-side path extractor but adds a few
 *  read-only tools so the user sees Reads/Bash/Globs too — those are
 *  useful as live progress signals even if they don't modify files. */
function summarizeToolInput(
    name: string,
    input: Record<string, unknown> | undefined
): string | undefined {
    if (!input) return undefined;
    const v = (k: string): string | undefined => {
        const x = input[k];
        return typeof x === "string" && x.length > 0 ? x : undefined;
    };
    switch (name) {
        case "Write":
        case "Edit":
        case "MultiEdit":
        case "Read":
            return v("file_path");
        case "NotebookEdit":
        case "NotebookRead":
            return v("notebook_path");
        case "Bash":
            return v("command");
        case "Glob":
            return v("pattern");
        case "Grep":
            return v("pattern");
        default:
            return undefined;
    }
}

function useRunTail(
    runId: string,
    active: boolean
): {events: TailEvent[]; resultText: string | null} {
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
                            content?: Array<{
                                type: string;
                                text?: string;
                                name?: string;
                                input?: Record<string, unknown>;
                            }>;
                        };
                        result?: string;
                    };
                    if (j.type === "assistant" && j.message?.content) {
                        for (const c of j.message.content) {
                            if (c.type === "text" && c.text) {
                                next.push({kind: "text", text: c.text});
                            } else if (c.type === "tool_use" && c.name) {
                                next.push({
                                    kind: "tool",
                                    text: c.name,
                                    detail: summarizeToolInput(c.name, c.input),
                                });
                            }
                        }
                    } else if (
                        j.type === "result" &&
                        typeof j.result === "string"
                    ) {
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

    return {events, resultText};
}

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
    const cls = classesFor(agentColorOf(agent));
    const dim = size === "sm" ? "size-6" : size === "lg" ? "size-10" : "size-9";
    // The lobehub icons already carry brand color, so the avatar wrapper
    // is intentionally bare — no tinted disc, no ring. Working state is a
    // small color dot at the bottom-right for presence convention.
    const inner = size === "sm" ? 20 : size === "lg" ? 36 : 32;

    return (
        <span
            className={cn(
                "relative inline-flex shrink-0 items-center justify-center",
                dim
            )}
        >
            {/* working 시 두 겹의 ping ring — 협업 화면에서 "이 사람 작동 중"이 한눈에. */}
            {working ? (
                <>
                    <motion.span
                        aria-hidden
                        className={cn(
                            "absolute inset-0 rounded-full",
                            cls.ringPulse,
                        )}
                        initial={{ opacity: 0.45, scale: 1 }}
                        animate={{ opacity: 0, scale: 1.55 }}
                        transition={{
                            duration: 1.4,
                            repeat: Infinity,
                            ease: "easeOut",
                        }}
                    />
                    <motion.span
                        aria-hidden
                        className={cn(
                            "absolute inset-0 rounded-full",
                            cls.ringPulse,
                        )}
                        initial={{ opacity: 0.35, scale: 1 }}
                        animate={{ opacity: 0, scale: 1.55 }}
                        transition={{
                            duration: 1.4,
                            repeat: Infinity,
                            ease: "easeOut",
                            delay: 0.7,
                        }}
                    />
                </>
            ) : null}
            <span className="relative inline-flex items-center justify-center">
                {manifest ? (
                    <AdapterIcon manifest={manifest} size={inner} />
                ) : (
                    <span className={cn("text-xs font-semibold", cls.text)}>?</span>
                )}
            </span>
            {working ? (
                <span
                    className={cn(
                        "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-background",
                        cls.dot
                    )}
                />
            ) : null}
        </span>
    );
}

function UserAvatar({size = "md"}: {size?: "sm" | "md" | "lg"}) {
    const dim = size === "sm" ? "size-6" : size === "lg" ? "size-10" : "size-9";
    const inner =
        size === "sm" ? "size-3.5" : size === "lg" ? "size-5" : "size-4";
    // The avatar can't be the literal character "나" — it would visually
    // duplicate the message header name (also "나"), reading as a glitch.
    // A muted person glyph keeps the position clear without doubling text.
    return (
        <span
            className={cn(
                "inline-flex shrink-0 items-center justify-center text-muted-foreground",
                dim
            )}
        >
            <User className={inner} />
        </span>
    );
}

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

function DaySeparator({ts}: {ts: string}) {
    const {t} = useI18n();
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
    runId,
    children,
}: {
    avatar: React.ReactNode;
    name: string;
    nameClassName?: string;
    timestamp: string;
    tag?: React.ReactNode;
    isContinuation: boolean;
    actions?: React.ReactNode;
    /** Stamped on the row so `↳ from @prev` badges elsewhere can scroll
     *  to this exact message via [data-run-id="…"][data-msg-kind="agent"]. */
    runId?: {id: string; kind: "user" | "agent"};
    children: React.ReactNode;
}) {
    return (
        <div
            data-run-id={runId?.id}
            data-msg-kind={runId?.kind}
            className={cn(
                "group relative flex items-start gap-3 px-5 py-0.5 hover:bg-foreground/[0.03]",
                !isContinuation && "mt-2 pt-1.5 msg-in"
            )}
        >
            <div className="w-9 shrink-0 mt-0.5 relative">
                {isContinuation ? (
                    <>
                        {/* Faint vertical connector tying continuation rows back to
                         *  their group's avatar. Keeps the eye moving down a single
                         *  thread without each row re-introducing the speaker. */}
                        <span
                            aria-hidden
                            className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-px bg-foreground/[0.08] group-hover:bg-foreground/[0.15] transition-colors"
                        />
                        <span className="invisible group-hover:visible block text-right text-[10px] text-muted-foreground/70 mono leading-9 -mt-2 relative">
                            {fmtTime(timestamp)}
                        </span>
                    </>
                ) : (
                    avatar
                )}
            </div>
            <div className="min-w-0 flex-1">
                {!isContinuation ? (
                    <div className="flex items-baseline gap-2 mb-0.5">
                        <span
                            className={cn(
                                "text-sm font-semibold",
                                nameClassName
                            )}
                        >
                            {name}
                        </span>
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

/**
 * Visit a parent message — smoothly scroll it into view, briefly flash
 * its background, and dim the link if the target isn't on the page yet
 * (e.g. the parent was pruned or filtered).
 */
function jumpToParent(parentRunId: string) {
    const el = document.querySelector(
        `[data-run-id="${parentRunId}"][data-msg-kind="agent"]`
    ) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({behavior: "smooth", block: "center"});
    // Restart the flash animation cleanly even on rapid re-clicks.
    el.classList.remove("flash-target");
    void el.offsetWidth;
    el.classList.add("flash-target");
    window.setTimeout(() => el.classList.remove("flash-target"), 1500);
}

function setHoverTarget(parentRunId: string, on: boolean) {
    const el = document.querySelector(
        `[data-run-id="${parentRunId}"][data-msg-kind="agent"]`
    );
    if (!el) return;
    el.classList.toggle("hover-target", on);
}

function ParentReference({
    parentAgent,
    parentRunId,
}: {
    parentAgent: Agent;
    parentRunId: string;
}) {
    const cls = classesFor(agentColorOf(parentAgent));
    return (
        <button
            type="button"
            onClick={() => jumpToParent(parentRunId)}
            onMouseEnter={() => setHoverTarget(parentRunId, true)}
            onMouseLeave={() => setHoverTarget(parentRunId, false)}
            className={cn(
                "group/parent inline-flex items-center gap-1.5 mb-1.5 rounded-md border bg-muted/40",
                "px-2 py-0.5 text-[11px] hover:bg-muted hover:border-foreground/30",
                "transition-colors cursor-pointer"
            )}
            title="Jump to parent message"
        >
            <CornerDownLeft className="size-3 -scale-x-100 opacity-60 group-hover/parent:opacity-100" />
            <span className="text-muted-foreground">from</span>
            <span className={cn("font-medium", cls.text)}>
                @{parentAgent.name}
            </span>
        </button>
    );
}

function HoverActions({children}: {children: React.ReactNode}) {
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
     *  agent that produced that parent's output. We surface a clickable
     *  "↳ from @prev" pill above the prompt so the hand-off is explicit
     *  AND the user can jump back to where the chain came from. */
    parentAgent?: Agent;
    isContinuation: boolean;
}) {
    const {t} = useI18n();
    const cls = target ? classesFor(agentColorOf(target)) : null;
    return (
        <MessageRow
            avatar={<UserAvatar />}
            name={t("chat.message.you")}
            timestamp={run.createdAt}
            isContinuation={isContinuation}
            runId={{id: run.id, kind: "user"}}
            tag={
                target ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <ArrowRight className="size-3" />
                        <span className={cn("font-medium", cls?.text)}>
                            @{target.name}
                        </span>
                    </span>
                ) : undefined
            }
        >
            {parentAgent && run.parentRunId ? (
                <ParentReference
                    parentAgent={parentAgent}
                    parentRunId={run.parentRunId}
                />
            ) : null}
            <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                {run.prompt}
            </p>
        </MessageRow>
    );
}

/**
 * Compact USD formatter for chat-density displays. Shows fractional
 * cents for tiny costs (typical claude-code runs land in the $0.001 –
 * $0.05 range), and rounds to two decimals once you hit the dollar
 * level. The full precision is preserved in the title attribute.
 */
function statusVariant(
    s: RunStatus
): "info" | "success" | "destructive" | "warning" | "secondary" {
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
    allAgents,
    allManifests,
    onReply,
    onHandoff,
    onQuoteSelection,
}: {
    run: Run;
    agent: Agent | undefined;
    manifest: AdapterManifest | undefined;
    isContinuation: boolean;
    /** Every agent in the room — used to populate the hand-off menu so the
     *  user can pick *who* picks this up next without leaving the message. */
    allAgents: Agent[];
    allManifests: AdapterManifest[];
    onReply: (run: Run, agent: Agent | undefined) => void;
    onHandoff: (run: Run, fromAgent: Agent | undefined, toAgent: Agent) => void;
    /** Phase D — quote a portion of this message into the composer. The
     *  parent owns composer state so we just bubble the selected text up. */
    onQuoteSelection: (
        selection: string,
        run: Run,
        agent: Agent | undefined
    ) => void;
}) {
    const {t} = useI18n();
    const qc = useQueryClient();
    const isActive = run.status === "queued" || run.status === "running";
    const {events, resultText} = useRunTail(run.id, isActive);

    const cancel = useMutation({
        mutationFn: () => api.cancelRun(run.id),
        onSuccess: () => qc.invalidateQueries({queryKey: ["runs"]}),
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
    const cls = agent ? classesFor(agentColorOf(agent)) : null;
    const finalText = resultText ?? restingResult.data?.resultText ?? null;
    const hasContent = events.length > 0 || finalText !== null;

    return (
        <div className="relative">
            {/* 활성 run 그라디언트 보더 — "이 에이전트 지금 작동 중" 강한 시각 신호.
             *  배경 좌측에 살짝 깔리는 컬러 라인 + 미세한 글로우 펄스. */}
            <AnimatePresence>
                {isActive && cls ? (
                    <>
                        <motion.div
                            key="active-rail"
                            aria-hidden
                            initial={{opacity: 0}}
                            animate={{opacity: 1}}
                            exit={{opacity: 0}}
                            transition={{duration: 0.25}}
                            className={cn(
                                "pointer-events-none absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-gradient-to-b",
                                cls.gradientFrom,
                                cls.gradientVia,
                                cls.gradientTo,
                            )}
                        />
                        <motion.div
                            key="active-glow"
                            aria-hidden
                            initial={{opacity: 0}}
                            animate={{opacity: [0.0, 0.55, 0.0]}}
                            exit={{opacity: 0}}
                            transition={{
                                duration: 2.4,
                                repeat: Infinity,
                                ease: "easeInOut",
                            }}
                            className={cn(
                                "pointer-events-none absolute left-0 top-1 bottom-1 w-12 blur-xl bg-gradient-to-r",
                                cls.gradientFrom,
                            )}
                        />
                    </>
                ) : null}
            </AnimatePresence>
        <MessageRow
            avatar={
                agent ? (
                    <AgentAvatar
                        agent={agent}
                        manifest={manifest}
                        working={isActive}
                    />
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
            runId={{id: run.id, kind: "agent"}}
            tag={
                <span className="inline-flex items-center gap-1.5">
                    <Badge
                        variant={statusVariant(run.status)}
                        className="h-4 px-1.5 text-[9px] gap-1"
                    >
                        {isActive ? (
                            <span className="size-1 rounded-full bg-current animate-pulse" />
                        ) : null}
                        {t(`status.${run.status}`)}
                    </Badge>
                    {run.costUsd !== null && run.costUsd !== undefined ? (
                        <span
                            className="text-[10px] text-muted-foreground/70 mono inline-flex items-baseline"
                            title={`$${run.costUsd.toFixed(4)}`}
                        >
                            {/* NumberFlow로 부드러운 자릿수 전환 — run 종료 시 cost가
                             *  툭 튀어나오는 게 아니라 흘러서 자리잡음. */}
                            <NumberFlow
                                value={run.costUsd}
                                format={costFormat(run.costUsd)}
                                prefix="$"
                            />
                        </span>
                    ) : null}
                </span>
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
                            <HandoffMenu
                                speaker={agent}
                                agents={allAgents}
                                manifests={allManifests}
                                onPick={(to) => onHandoff(run, agent, to)}
                            />
                        </>
                    ) : (
                        <HoverButton
                            onClick={() => {
                                if (confirm(t("chat.message.cancelConfirm")))
                                    cancel.mutate();
                            }}
                            icon={<X />}
                            label={t("chat.message.cancel")}
                        />
                    )}
                    <Button
                        asChild
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground hover:text-foreground"
                    >
                        <Link
                            to={`/runs/${run.id}`}
                            aria-label={t("chat.message.openLog")}
                        >
                            <MoreHorizontal />
                        </Link>
                    </Button>
                </HoverActions>
            }
        >
            {!hasContent ? (
                // Use a div so ActiveProgress (which wraps in flex divs) doesn't
                // nest inside a <p> — that throws DOM warnings and breaks the
                // computed line height on Safari.
                <div className="text-sm italic text-muted-foreground">
                    {isActive ? (
                        <ActiveProgress run={run} events={events} />
                    ) : (
                        <FailedReason runId={run.id} status={run.status} />
                    )}
                </div>
            ) : (
                <SelectionQuoteScope
                    onQuote={(text) => onQuoteSelection(text, run, agent)}
                >
                    <div className="space-y-1.5">
                        {/*
                         * Order matters: the agent's *answer* comes first, the
                         * "how it got there" (tool calls) follows as a quiet
                         * footer. Reading order = "what they said, then how they
                         * worked." Streaming text is only shown while finalText
                         * is missing; once result.result lands, finalText is the
                         * canonical answer and partials drop out.
                         */}
                        {finalText === null
                            ? (() => {
                                  const textEvents = events.filter(
                                      (e) => e.kind === "text",
                                  );
                                  return textEvents.map((evt, i) => (
                                      <MarkdownView
                                          key={i}
                                          text={evt.text}
                                          // 마지막 텍스트 청크에만 active 시 커서 표시.
                                          streaming={
                                              isActive && i === textEvents.length - 1
                                          }
                                      />
                                  ));
                              })()
                            : null}
                        {finalText ? <MarkdownView text={finalText} /> : null}
                        <ToolStrip events={events} />
                        {isActive ? (
                            <ActiveProgress run={run} events={events} />
                        ) : null}
                    </div>
                </SelectionQuoteScope>
            )}
            {/*
             * "What did this run change?" panel. Self-hides when there are no
             * changes (or the cwd isn't a git repo), so it doesn't clutter
             * pure-conversation runs. Only fetched once the run is finished —
             * mid-run the diff is a moving target.
             */}
            <ChangedFiles runId={run.id} enabled={!isActive} />
        </MessageRow>
        </div>
    );
}

// NumberFlow에 줄 자리수. 비용 크기에 따라 적응 — 매우 작은 비용은 4자리.
function costFormat(usd: number) {
    if (usd < 0.01) return {minimumFractionDigits: 4, maximumFractionDigits: 4};
    if (usd < 1) return {minimumFractionDigits: 3, maximumFractionDigits: 3};
    return {minimumFractionDigits: 2, maximumFractionDigits: 2};
}

/** When a run lands in `failed` / `cancelled` and produced no result
 *  text, surface the tail of stderr so the user understands *why*. We
 *  fetch lazily so the SSE-tail path stays cheap; cached at the query
 *  level so re-renders don't re-fire. */
function FailedReason({runId, status}: {runId: string; status: RunStatus}) {
    const {t} = useI18n();
    const enabled = status === "failed" || status === "cancelled";
    const q = useQuery({
        queryKey: ["run", runId, "error"],
        queryFn: () => api.getRunError(runId),
        enabled,
        staleTime: 5 * 60_000,
    });
    if (!enabled) return <>—</>;
    const stderr = q.data?.stderr ?? "";
    if (!stderr) {
        return (
            <span className="not-italic">
                <Badge variant="destructive" className="h-4 px-1.5 text-[9px]">
                    {t(`status.${status}`)}
                </Badge>
                <Link
                    to={`/runs/${runId}`}
                    className="ml-2 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                    {t("chat.message.openLog")}
                </Link>
            </span>
        );
    }
    return (
        <div className="not-italic space-y-1">
            <Badge variant="destructive" className="h-4 px-1.5 text-[9px]">
                {t(`status.${status}`)}
            </Badge>
            <pre className="mt-1 max-h-32 overflow-auto rounded border border-border/60 bg-muted/40 px-2 py-1.5 mono text-[11px] leading-snug whitespace-pre-wrap break-words text-destructive">
                {stderr}
            </pre>
            <Link
                to={`/runs/${runId}`}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
                {t("chat.message.openLog")}
            </Link>
        </div>
    );
}

/**
 * Live progress strip beneath an active run. Three signals in one row:
 *
 *   ⏱  12s · Edit  src/auth.ts
 *
 * The clock keeps the run from feeling stuck. The tool name + path
 * answers "what is the agent doing right *now*" — sourced from the
 * tool_use stream so the user doesn't have to switch panels.
 */
function ActiveProgress({run, events}: {run: Run; events: TailEvent[]}) {
    const [elapsed, setElapsed] = useState(() => elapsedSecs(run));
    useEffect(() => {
        // 1Hz tick is enough — we're showing seconds, not milliseconds.
        const id = window.setInterval(() => setElapsed(elapsedSecs(run)), 1000);
        return () => window.clearInterval(id);
    }, [run]);

    const lastTool = [...events].reverse().find((e) => e.kind === "tool");

    return (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground mono min-w-0">
            <span className="inline-flex size-1.5 rounded-full bg-foreground/40 animate-pulse shrink-0" />
            <span className="shrink-0">{formatElapsed(elapsed)}</span>
            {lastTool ? (
                <>
                    <span className="text-muted-foreground/40 shrink-0">·</span>
                    <span className="text-foreground/80 font-medium shrink-0">
                        {lastTool.text}
                    </span>
                    {lastTool.detail ? (
                        <span
                            className="truncate text-muted-foreground"
                            title={lastTool.detail}
                        >
                            {lastTool.detail}
                        </span>
                    ) : null}
                </>
            ) : null}
        </div>
    );
}

function elapsedSecs(run: Run): number {
    const start = run.startedAt ?? run.createdAt;
    return Math.max(
        0,
        Math.floor((Date.now() - new Date(start).getTime()) / 1000)
    );
}

function formatElapsed(s: number): string {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}m ${rem}s`;
}

/**
 * Renders an agent's tool activity as a single muted line:
 *
 *   🔧  Read·8  Edit·4  Bash·2  Glob  Write
 *
 * Counting per kind keeps the message compact even when the agent ran
 * the same tool dozens of times. Hidden when the agent didn't call any
 * tools (most pure-conversation runs). Order is by first-use so it
 * mirrors the actual flow rather than alphabetizing the noise.
 */
function ToolStrip({events}: {events: TailEvent[]}) {
    const order: string[] = [];
    const counts = new Map<string, number>();
    for (const ev of events) {
        if (ev.kind !== "tool") continue;
        if (!counts.has(ev.text)) order.push(ev.text);
        counts.set(ev.text, (counts.get(ev.text) ?? 0) + 1);
    }
    if (order.length === 0) return null;
    return (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground mono">
            <span aria-hidden className="opacity-70">
                🔧
            </span>
            {order.map((name) => {
                const n = counts.get(name)!;
                return (
                    <span
                        key={name}
                        className="inline-flex items-baseline gap-0.5"
                    >
                        <span>{name}</span>
                        {n > 1 ? (
                            <span className="text-muted-foreground/60">
                                ·{n}
                            </span>
                        ) : null}
                    </span>
                );
            })}
        </div>
    );
}

/**
 * Replaces the old "Forward" hover action. Forward used to dump a quote
 * into the composer and leave it to the user to manually swap the target
 * chip — which hid the actual delegation step. Now clicking the icon
 * pops a Slack-style member menu, and picking an agent does both: swap
 * the composer target AND seed the quoted draft. Hand-off is a single,
 * obvious gesture instead of two implicit steps.
 */
function HandoffMenu({
    speaker,
    agents,
    manifests,
    onPick,
}: {
    speaker: Agent | undefined;
    agents: Agent[];
    manifests: AdapterManifest[];
    onPick: (to: Agent) => void;
}) {
    const {t} = useI18n();
    // Hand-off only makes sense to *another* agent — replying to the same
    // speaker is what the Reply button is for.
    const others = speaker ? agents.filter((a) => a.id !== speaker.id) : agents;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-foreground"
                    title={t("chat.message.handoff")}
                    aria-label={t("chat.message.handoff")}
                >
                    <Forward />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[12rem]">
                <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("chat.message.handoff.title")}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {others.length === 0 ? (
                    <div className="px-2 py-2 text-xs text-muted-foreground">
                        {t("chat.message.handoff.empty")}
                    </div>
                ) : (
                    others.map((a) => {
                        const m = manifests.find(
                            (mm) => mm.kind === a.adapterKind
                        );
                        const cls = classesFor(agentColorOf(a));
                        return (
                            <DropdownMenuItem
                                key={a.id}
                                onSelect={() => onPick(a)}
                                className="gap-2"
                            >
                                <AgentAvatar agent={a} manifest={m} size="sm" />
                                <span
                                    className={cn(
                                        "text-sm font-medium",
                                        cls.text
                                    )}
                                >
                                    @{a.name}
                                </span>
                                {a.role ? (
                                    <span className="ml-auto text-[10px] text-muted-foreground/70">
                                        {a.role}
                                    </span>
                                ) : null}
                            </DropdownMenuItem>
                        );
                    })
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

/**
 * Wraps an agent message body. When the user drags a text selection
 * inside this region a small "Quote selection" pill floats just above
 * the selection. Clicking it bubbles the selected text up so the parent
 * can drop it (as a `> blockquote`) into the composer. Selection is
 * cleared after the quote is taken so the pill disappears cleanly.
 */
function SelectionQuoteScope({
    children,
    onQuote,
}: {
    children: React.ReactNode;
    onQuote: (text: string) => void;
}) {
    const {t} = useI18n();
    const ref = useRef<HTMLDivElement>(null);
    const [pill, setPill] = useState<{
        text: string;
        top: number;
        left: number;
    } | null>(null);

    useEffect(() => {
        const root = ref.current;
        if (!root) return;
        const handler = () => {
            // Defer one tick — the browser updates the selection AFTER mouseup
            // fires, so reading it synchronously gives stale data.
            setTimeout(() => {
                const sel = window.getSelection();
                if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
                    setPill(null);
                    return;
                }
                const range = sel.getRangeAt(0);
                // Only honor selections fully inside this message — otherwise the
                // pill would appear when text is selected across two messages.
                if (
                    !root.contains(range.startContainer) ||
                    !root.contains(range.endContainer)
                ) {
                    setPill(null);
                    return;
                }
                const text = sel.toString().trim();
                if (!text) {
                    setPill(null);
                    return;
                }
                const rect = range.getBoundingClientRect();
                const rootRect = root.getBoundingClientRect();
                setPill({
                    text,
                    top: rect.top - rootRect.top - 32,
                    left: rect.left - rootRect.left + rect.width / 2,
                });
            }, 0);
        };
        document.addEventListener("mouseup", handler);
        document.addEventListener("selectionchange", handler);
        return () => {
            document.removeEventListener("mouseup", handler);
            document.removeEventListener("selectionchange", handler);
        };
    }, []);

    return (
        <div ref={ref} className="relative">
            {children}
            {pill ? (
                <button
                    type="button"
                    onMouseDown={(e) => {
                        // Prevent the click from collapsing the selection before the
                        // handler runs — we read pill.text from state, not the live
                        // selection, but we want the click to feel snappy.
                        e.preventDefault();
                    }}
                    onClick={() => {
                        onQuote(pill.text);
                        window.getSelection()?.removeAllRanges();
                        setPill(null);
                    }}
                    style={{
                        position: "absolute",
                        top: pill.top,
                        left: pill.left,
                        transform: "translateX(-50%)",
                    }}
                    className="z-20 inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-medium shadow-md hover:bg-muted"
                >
                    <Quote className="size-3" />
                    {t("chat.message.quoteSelection")}
                </button>
            ) : null}
        </div>
    );
}

export function WorkingIndicator({workingAgents}: {workingAgents: Agent[]}) {
    const {t} = useI18n();
    if (workingAgents.length === 0) return null;
    const label =
        workingAgents.length === 1
            ? t("chat.working.singular", {agent: workingAgents[0]!.name})
            : t("chat.working.plural", {count: workingAgents.length});
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

function Dot({delay}: {delay: number}) {
    return (
        <span
            className="size-1 rounded-full bg-foreground/50 animate-bounce"
            style={{animationDelay: `${delay}ms`, animationDuration: "1.1s"}}
        />
    );
}

export function Composer({
    agents,
    manifests,
    agentIds,
    onAgentIdsChange,
    threadId,
    threadHasContext,
    onThreadCreated,
    initialDraft,
    draftKey,
    onSent,
}: {
    agents: Agent[];
    manifests: AdapterManifest[];
    /** Selected target. The array is single-element by design — multi-
     *  agent broadcast was removed (one room, one teammate at a time). */
    agentIds: string[];
    onAgentIdsChange: (ids: string[]) => void;
    /** null = the next send creates a fresh thread; the parent adopts
     *  the returned id via `onThreadCreated`. */
    threadId?: string | null;
    threadHasContext?: boolean;
    onThreadCreated?: (id: string) => void;
    initialDraft?: string;
    draftKey?: number;
    onSent: () => void;
}) {
    const {t} = useI18n();
    const qc = useQueryClient();
    const [text, setText] = useState(initialDraft ?? "");
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Slash-command palette. Active when text starts with `/` and no
    // space has been typed yet — once the user starts adding the actual
    // prompt, the menu folds away.
    const slashMatch = /^\/([a-z]*)$/i.exec(text);
    const slashOpen = !!slashMatch;
    const slashQuery = slashMatch?.[1] ?? "";
    const slashMatches = slashOpen
        ? SLASH_COMMANDS.filter((c) =>
              c.cmd.slice(1).toLowerCase().startsWith(slashQuery.toLowerCase())
          )
        : [];
    const [slashIndex, setSlashIndex] = useState(0);
    useEffect(() => {
        setSlashIndex(0);
    }, [slashQuery]);

    const commitSlash = (cmd: SlashCommand) => {
        const next = `${cmd.cmd} `;
        setText(next);
        requestAnimationFrame(() => {
            const el = textareaRef.current;
            if (el) {
                el.focus();
                el.setSelectionRange(next.length, next.length);
            }
        });
    };

    useEffect(() => {
        if (initialDraft !== undefined) {
            setText(initialDraft);
            const el = textareaRef.current;
            if (el) {
                el.focus();
                requestAnimationFrame(() =>
                    el.setSelectionRange(el.value.length, el.value.length)
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

    // Synchronous latch — protects against IME-driven double-fire and the
    // (rare) race where React hasn't yet flushed isSending=true.
    const sendingRef = useRef(false);

    // "Attach context" toggle. Per-thread, persisted in localStorage so
    // a thread the user typically wants context for stays toggled across
    // sessions. Default ON when context exists (the obvious choice given
    // they bothered writing one), OFF when there's nothing to attach.
    const attachKey = threadId ? `loom:thread:${threadId}:attachContext` : null;
    const [attachContext, setAttachContext] = useState<boolean>(() => {
        if (!attachKey || typeof window === "undefined") {
            return !!threadHasContext;
        }
        const stored = window.localStorage.getItem(attachKey);
        if (stored === "1") return true;
        if (stored === "0") return false;
        return !!threadHasContext;
    });
    // Reset when thread / context-availability changes. We also persist
    // the active value so the next session restores it.
    useEffect(() => {
        if (!attachKey) return;
        const stored = window.localStorage.getItem(attachKey);
        if (stored === "1") setAttachContext(true);
        else if (stored === "0") setAttachContext(false);
        else setAttachContext(!!threadHasContext);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [attachKey]);
    useEffect(() => {
        if (!attachKey) return;
        try {
            window.localStorage.setItem(attachKey, attachContext ? "1" : "0");
        } catch {
            // private mode / quota — silently skip
        }
    }, [attachKey, attachContext]);

    const setTarget = (id: string) => onAgentIdsChange([id]);

    const target = agents.find((a) => a.id === agentIds[0]) ?? null;

    const placeholder = target
        ? t("chat.composer.placeholder", {agent: target.name})
        : t("chat.composer.placeholderNoAgent");

    const send = async () => {
        if (sendingRef.current || !target || !text.trim() || isSending) return;
        sendingRef.current = true;
        setIsSending(true);
        setError(null);
        try {
            const r = await api.createRun({
                agentId: target.id,
                prompt: text,
                threadId: threadId ?? null,
                includeContext: attachContext && threadHasContext,
            });
            const newId = r.run.threadId;
            if (newId && newId !== threadId) onThreadCreated?.(newId);
            qc.invalidateQueries({queryKey: ["runs"]});
            qc.invalidateQueries({queryKey: ["threads"]});
            setText("");
            onSent();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            sendingRef.current = false;
            setIsSending(false);
        }
    };

    const canSend = !!target && text.trim().length > 0 && !isSending;

    return (
        <div className="px-5 pb-4 pt-1 bg-background shrink-0">
            {error ? (
                <p className="mb-2 text-xs text-destructive">{error}</p>
            ) : null}
            <div className="relative rounded-lg border bg-background focus-within:ring-1 focus-within:ring-ring transition-shadow">
                {slashOpen && slashMatches.length > 0 ? (
                    <SlashMenu
                        matches={slashMatches}
                        highlight={slashIndex}
                        onPick={commitSlash}
                    />
                ) : null}
                <textarea
                    ref={textareaRef}
                    rows={1}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                        // Slash-menu navigation takes priority while open.
                        if (slashOpen && slashMatches.length > 0) {
                            if (e.key === "ArrowDown") {
                                e.preventDefault();
                                setSlashIndex(
                                    (i) => (i + 1) % slashMatches.length
                                );
                                return;
                            }
                            if (e.key === "ArrowUp") {
                                e.preventDefault();
                                setSlashIndex(
                                    (i) =>
                                        (i - 1 + slashMatches.length) %
                                        slashMatches.length
                                );
                                return;
                            }
                            if (
                                (e.key === "Enter" || e.key === "Tab") &&
                                !e.shiftKey &&
                                !e.nativeEvent.isComposing &&
                                e.nativeEvent.keyCode !== 229
                            ) {
                                e.preventDefault();
                                commitSlash(slashMatches[slashIndex]!);
                                return;
                            }
                            if (e.key === "Escape") {
                                e.preventDefault();
                                setText("");
                                return;
                            }
                        }
                        if (
                            e.key === "Enter" &&
                            !e.shiftKey &&
                            !e.nativeEvent.isComposing &&
                            e.nativeEvent.keyCode !== 229
                        ) {
                            e.preventDefault();
                            send();
                        }
                    }}
                    placeholder={placeholder}
                    disabled={!target}
                    className="w-full resize-none bg-transparent px-3.5 py-3 text-sm placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
                    style={{minHeight: "40px"}}
                />
                <div className="flex items-center justify-between gap-2 border-t px-2 py-1.5">
                    <Select
                        value={target?.id ?? ""}
                        onValueChange={(id) => {
                            if (id) setTarget(id);
                        }}
                    >
                        <SelectTrigger className="h-7 w-auto gap-1 border-0 bg-transparent hover:bg-muted px-2 shadow-none focus:ring-0">
                            <SelectValue>
                                {target ? (
                                    <span className="inline-flex items-center gap-1.5">
                                        <AgentAvatar
                                            agent={target}
                                            manifest={manifests.find(
                                                (m) =>
                                                    m.kind ===
                                                    target.adapterKind
                                            )}
                                            size="sm"
                                        />
                                        <span
                                            className={cn(
                                                "text-xs font-medium",
                                                classesFor(agentColorOf(target))
                                                    .text
                                            )}
                                        >
                                            @{target.name}
                                        </span>
                                    </span>
                                ) : (
                                    <span className="text-xs text-muted-foreground">
                                        {t("chat.composer.placeholderNoAgent")}
                                    </span>
                                )}
                            </SelectValue>
                        </SelectTrigger>
                        <SelectContent align="start">
                            {agents.map((a) => {
                                const m = manifests.find(
                                    (mm) => mm.kind === a.adapterKind
                                );
                                const c = classesFor(agentColorOf(a));
                                return (
                                    <SelectItem
                                        key={a.id}
                                        value={a.id}
                                        className="pl-8"
                                    >
                                        <span className="flex items-center gap-2">
                                            <AgentAvatar
                                                agent={a}
                                                manifest={m}
                                                size="sm"
                                            />
                                            <span
                                                className={cn(
                                                    "text-sm font-medium",
                                                    c.text
                                                )}
                                            >
                                                @{a.name}
                                            </span>
                                        </span>
                                    </SelectItem>
                                );
                            })}
                        </SelectContent>
                    </Select>
                    <div className="flex items-center gap-2 shrink-0">
                        {threadHasContext ? (
                            <button
                                type="button"
                                onClick={() => setAttachContext((v) => !v)}
                                title={
                                    attachContext
                                        ? t("chat.composer.contextOn")
                                        : t("chat.composer.contextOff")
                                }
                                aria-pressed={attachContext}
                                className={cn(
                                    "inline-flex items-center gap-1 px-2 h-6 rounded text-[11px] transition-colors",
                                    attachContext
                                        ? "text-sky-700 dark:text-sky-400 bg-sky-500/10 hover:bg-sky-500/20"
                                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                                )}
                            >
                                <Paperclip className="size-3" />
                                <span className="hidden sm:inline">
                                    {t("chat.composer.context")}
                                </span>
                            </button>
                        ) : null}
                        <span className="text-[10px] text-muted-foreground/70 hidden md:inline">
                            {t("chat.composer.hint")}
                        </span>
                        <Button
                            size="icon"
                            className="size-7"
                            disabled={!canSend}
                            onClick={send}
                            aria-label={t("chat.composer.send")}
                        >
                            <Send />
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function buildReplyQuote(
    run: Run,
    agent: Agent | undefined,
    t: (key: string, vars?: Record<string, string | number>) => string
): string {
    const name = agent?.name ?? run.agentId.slice(0, 8);
    const heading = t("chat.message.quoteHeading", {agent: name});
    const lines = run.prompt.split("\n").map((l) => `> ${l}`);
    return `${heading}\n${lines.join("\n")}\n\n`;
}

export async function buildForwardQuote(
    run: Run,
    agent: Agent | undefined,
    t: (key: string, vars?: Record<string, string | number>) => string
): Promise<string> {
    const name = agent?.name ?? run.agentId.slice(0, 8);
    const heading = t("chat.message.quoteHeading", {agent: name});
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

/** Quote only what the user dragged (Phase D). Same shape as the full
 *  quote so a follow-up message reads consistently no matter how it was
 *  composed. */
export function buildSelectionQuote(
    selection: string,
    agent: Agent | undefined,
    agentIdFallback: string,
    t: (key: string, vars?: Record<string, string | number>) => string
): string {
    const name = agent?.name ?? agentIdFallback.slice(0, 8);
    const heading = t("chat.message.quoteHeading", {agent: name});
    const lines = selection.split("\n").map((l) => `> ${l}`);
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
        // Prefer the explicit thread id when set — that's the new canonical
        // container. Fall back to root-of-parent-chain for legacy runs that
        // pre-date the threads table (or somehow ended up thread-less).
        const key = r.threadId ?? rootRunId(r, byId);
        const arr = groups.get(key) ?? [];
        arr.push(r);
        groups.set(key, arr);
    }
    const threads: ThreadGroup[] = [];
    for (const [rootId, ofThread] of groups) {
        const sorted = [...ofThread].sort((a, b) =>
            a.createdAt.localeCompare(b.createdAt)
        );
        const items: FeedItem[] = [];
        for (const r of sorted) {
            items.push({
                kind: "user",
                run: r,
                ts: r.createdAt,
                senderId: "user",
            });
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
    agents: Agent[]
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
export function isContinuation(
    curr: FeedItem,
    prev: FeedItem | undefined
): boolean {
    if (!prev) return false;
    if (prev.senderId !== curr.senderId) return false;
    if (dayKey(prev.ts) !== dayKey(curr.ts)) return false;
    const delta = new Date(curr.ts).getTime() - new Date(prev.ts).getTime();
    return delta < CONTINUATION_WINDOW_MS;
}

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
                isMulti &&
                    "relative pl-3 ml-3 border-l-2 border-foreground/[0.08] my-2"
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
    agents: Agent[]
): Agent | undefined {
    if (!run.parentRunId) return undefined;
    const parent = thread.runs.find((r) => r.id === run.parentRunId);
    if (!parent) return undefined;
    return agents.find((a) => a.id === parent.agentId);
}

/** Floating menu for slash commands. Anchored above the textarea so it
 *  doesn't collide with the placeholder while the user is still typing. */
function SlashMenu({
    matches,
    highlight,
    onPick,
}: {
    matches: SlashCommand[];
    highlight: number;
    onPick: (cmd: SlashCommand) => void;
}) {
    const {t} = useI18n();
    return (
        <div className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border bg-popover shadow-lg overflow-hidden z-30">
            <ul className="max-h-56 overflow-y-auto py-1">
                {matches.map((c, i) => (
                    <li key={c.cmd}>
                        <button
                            type="button"
                            onMouseDown={(e) => {
                                // Prevent textarea blur — onMouseDown fires before
                                // onClick, and a blur would close the menu.
                                e.preventDefault();
                            }}
                            onClick={() => onPick(c)}
                            className={cn(
                                "flex w-full items-baseline gap-2 px-3 py-1.5 text-left",
                                i === highlight
                                    ? "bg-muted"
                                    : "hover:bg-muted/60"
                            )}
                        >
                            <span className="mono text-sm font-semibold text-foreground shrink-0">
                                {c.cmd}
                            </span>
                            <span className="text-sm text-foreground/80">
                                {t(c.i18nLabel)}
                            </span>
                            <span className="ml-auto text-[10px] text-muted-foreground/70 truncate">
                                {t(c.i18nHint)}
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}

export {dayKey, DaySeparator, TooltipProvider};
