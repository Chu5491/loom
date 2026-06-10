// Talk 화면 — office 에이전트와 대화. 한 턴 = 한 run.
// 입력 → POST /api/runs → useRunStream 으로 SSE 이벤트를 버블에 흘린다.
// @mention 으로 대상 에이전트를 바꾼다(자동주입 없음: 보낸 프롬프트는 적은 그대로).

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, Bot } from "lucide-react";
import type { AgentSpec, OfficeEvent } from "@loom/core";
import { api } from "../api/client.js";
import { useI18n } from "../context/I18nContext.js";
import { useRunStream } from "../hooks/useRunStream.js";
import { cn } from "../lib/utils.js";

const AVATAR = [
  "from-sky-500/80 to-indigo-500/80",
  "from-emerald-500/80 to-teal-500/80",
  "from-fuchsia-500/80 to-purple-500/80",
  "from-amber-500/80 to-orange-500/80",
  "from-rose-500/80 to-pink-500/80",
  "from-cyan-500/80 to-blue-500/80",
];
function avatarFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR[h % AVATAR.length]!;
}

interface UserMsg { id: string; role: "user"; agent: string; text: string }
interface AgentMsg { id: string; role: "agent"; agent: string; runId: string; fromAgent?: string }
type Msg = UserMsg | AgentMsg;

export function TalkPage({ projectId }: { projectId: string | null }) {
  const { t } = useI18n();
  const office = useQuery({ queryKey: ["office"], queryFn: api.getOffice });
  const runs = useQuery({ queryKey: ["runs", projectId], queryFn: () => api.listRuns(projectId) });
  const agents = office.data?.office.agents ?? [];

  const [active, setActive] = useState<string>("");
  const [pending, setPending] = useState<{ agent: string; text: string } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 첫 에이전트를 기본 대상으로.
  useEffect(() => {
    if (!active && agents.length) setActive(agents[0]!.name);
  }, [agents, active]);

  // 스레드 = runs.data 단일 진실에서 파생(이중 경로 제거 — 중복 버블 방지).
  // 부모 run = user+agent 버블, 하네스 자식(parentRunId) = 핸드오프 agent 버블만.
  // runs 쿼리는 projectId 로 키잉돼 있어 프로젝트 전환도 자동 반영.
  const byId = useMemo(() => new Map((runs.data?.runs ?? []).map((r) => [r.id, r])), [runs.data]);
  const messages = useMemo<Msg[]>(
    () =>
      [...(runs.data?.runs ?? [])]
        .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1))
        .flatMap((r): Msg[] =>
          r.parentRunId
            ? [{ id: `a-${r.id}`, role: "agent", agent: r.agent, runId: r.id, fromAgent: byId.get(r.parentRunId)?.agent }]
            : [
                { id: `u-${r.id}`, role: "user", agent: r.agent, text: r.prompt },
                { id: `a-${r.id}`, role: "agent", agent: r.agent, runId: r.id },
              ],
        ),
    [runs.data, byId],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  async function send(rawText: string) {
    const text = rawText.trim();
    if (!text) return;
    // 선행 @mention 이 있으면 대상 에이전트 결정 + 토큰 제거(에이전트엔 안 보냄).
    let agent = active;
    let prompt = text;
    const m = text.match(/^@([a-zA-Z0-9_-]+)\s*/);
    if (m && agents.some((a) => a.name === m[1])) {
      agent = m[1]!;
      prompt = text.slice(m[0].length).trim();
      setActive(agent);
    }
    if (!agent || !prompt) return;

    // 낙관적 user 버블 하나만(pending). run 이 runs.data 에 들어오면 실제 버블이 대체.
    setSendError(null);
    setPending({ agent, text: prompt });
    try {
      await api.startRun({ agent, prompt, projectId });
      await runs.refetch();
      setPending(null);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e));
      // pending 유지 → 사용자 메시지 + 에러를 같이 보여줌
    }
  }

  if (!office.data || !runs.data) {
    return <Centered>{t("common.checking")}</Centered>;
  }
  if (agents.length === 0) {
    return <Centered>{t("talk.noAgents")}</Centered>;
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-3.5rem)] max-w-3xl flex-col px-4 sm:px-6">
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-6">
        {messages.length === 0 && !pending ? (
          <Welcome activeAgent={agents.find((a) => a.name === active)} />
        ) : (
          <div className="space-y-5">
            {messages.map((msg) =>
              msg.role === "user" ? (
                <UserBubble key={msg.id} text={msg.text} />
              ) : (
                <AgentBubble
                  key={msg.id}
                  agent={agents.find((a) => a.name === msg.agent)}
                  fromAgent={msg.fromAgent}
                  runId={msg.runId}
                  onDone={() => void runs.refetch()}
                />
              ),
            )}
            {pending ? <UserBubble key="pending" text={pending.text} /> : null}
            {sendError ? <ErrorLine text={sendError} /> : null}
          </div>
        )}
      </div>

      <Composer agents={agents} active={active} onActive={setActive} onSend={send} />
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex h-[calc(100vh-3.5rem)] max-w-3xl items-center justify-center px-6">
      <p className="text-center text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function Avatar({ name, size = "size-8" }: { name: string; size?: string }) {
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br font-display font-semibold text-white shadow-sm", size, avatarFor(name))}>
      {(name.charAt(0) || "?").toUpperCase()}
    </span>
  );
}

function Welcome({ activeAgent }: { activeAgent?: AgentSpec }) {
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-accent text-white shadow-[var(--shadow-glow)]">
        <Bot className="size-6" />
      </span>
      <h2 className="font-display text-xl font-semibold">{t("talk.welcomeTitle")}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        {activeAgent ? t("talk.welcomeWith", { name: activeAgent.label || activeAgent.name }) : t("talk.welcomeSub")}
      </p>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary/15 px-4 py-2.5 text-sm leading-relaxed">
        {text}
      </div>
    </div>
  );
}

// ── 에이전트 버블 — runId 의 SSE 를 구독해 이벤트를 렌더 ─────────────────────────
function AgentBubble({ agent, fromAgent, runId, onDone }: { agent?: AgentSpec; fromAgent?: string; runId: string; onDone?: () => void }) {
  const { t } = useI18n();
  const isStartError = runId.startsWith("err:");
  const stream = useRunStream(isStartError ? null : runId);

  const name = agent?.label || agent?.name || "?";
  const view = useMemo(() => deriveView(stream.events), [stream.events]);
  const running = !isStartError && stream.status === "running";

  // run 이 끝나면 부모에 알림 → runs 재조회로 하네스 자동발화 자식을 끌어온다.
  useEffect(() => {
    if (!isStartError && stream.status !== "running") onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.status, isStartError]);

  return (
    <div className="flex gap-3">
      <Avatar name={agent?.name || "?"} />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="font-display text-sm font-semibold">{name}</span>
          {agent ? <span className="text-[11px] text-muted-foreground">{agent.adapter}</span> : null}
          {fromAgent ? <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">↳ @{fromAgent}</span> : null}
          {running ? <span className="size-1.5 animate-pulse rounded-full bg-primary" /> : null}
        </div>

        {/* 도구·파일·핸드오프 트레이스 */}
        {view.trace.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {view.trace.map((tr, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {tr}
              </span>
            ))}
          </div>
        ) : null}

        {/* 본문 텍스트 */}
        {isStartError ? (
          <ErrorLine text={runId.slice(4)} />
        ) : view.errors.length > 0 ? (
          view.errors.map((m, i) => <ErrorLine key={i} text={m} />)
        ) : view.body ? (
          <div className="whitespace-pre-wrap rounded-2xl rounded-bl-md bg-card border border-border px-4 py-2.5 text-sm leading-relaxed">
            {view.body}
            {running ? <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-primary/70" /> : null}
          </div>
        ) : running ? (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("talk.noOutput")}</p>
        )}

        {/* 결과 메타(비용·취소·실패) */}
        {view.result?.costUsd != null ? (
          <p className="mt-1 text-[11px] text-muted-foreground">${view.result.costUsd.toFixed(4)}</p>
        ) : null}
        {!isStartError && (stream.status === "failed" || stream.status === "cancelled") ? (
          <p className="mt-1 text-[11px] text-muted-foreground">{t(`talk.status.${stream.status}`)}</p>
        ) : null}
      </div>
    </div>
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap rounded-2xl rounded-bl-md border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm leading-relaxed text-destructive">
      {text}
    </div>
  );
}

interface DerivedView {
  trace: string[];
  body: string;
  result?: Extract<OfficeEvent, { kind: "result" }>;
  errors: string[];
}
function deriveView(events: OfficeEvent[]): DerivedView {
  const trace: string[] = [];
  const texts: string[] = [];
  const errors: string[] = [];
  let result: Extract<OfficeEvent, { kind: "result" }> | undefined;
  for (const e of events) {
    if (e.kind === "text") texts.push(e.text);
    else if (e.kind === "tool") trace.push(`⚙ ${e.name}${e.target ? ` ${e.target}` : ""}`);
    else if (e.kind === "file") trace.push(`${e.action === "edit" ? "✎" : "+"} ${e.path}`);
    else if (e.kind === "handoff") trace.push(`→ @${e.toAgent}`);
    else if (e.kind === "result") result = e;
    else if (e.kind === "error") errors.push(e.message);
  }
  // result 가 오면 그게 최종 전체 텍스트 — 누적 text 보다 우선.
  const body = result?.text ?? texts.join("");
  return { trace, body, result, errors };
}

// ── Composer — 에이전트 칩 + @mention 자동완성 + 입력 ──────────────────────────
function Composer({
  agents,
  active,
  onActive,
  onSend,
}: {
  agents: AgentSpec[];
  active: string;
  onActive: (name: string) => void;
  onSend: (text: string) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 커서 앞 텍스트의 끝이 "@partial" 이면 멘션 후보를 띄운다.
  const mention = useMemo(() => {
    const m = text.match(/(?:^|\s)@([a-zA-Z0-9_-]*)$/);
    if (!m) return null;
    const q = m[1]!.toLowerCase();
    const hits = agents.filter((a) => a.name.toLowerCase().startsWith(q));
    return hits.length ? { hits, token: m[0].trimStart() } : null;
  }, [text, agents]);

  function pickMention(name: string) {
    setText((prev) => prev.replace(/@[a-zA-Z0-9_-]*$/, `@${name} `));
    onActive(name);
    taRef.current?.focus();
  }

  function submit() {
    if (!text.trim()) return;
    onSend(text);
    setText("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // IME(한글/일본어/중국어) 조합 중 Enter 는 글자 확정용 — 전송하면 안 됨.
    // 안 막으면 조합 완료 Enter + 실제 Enter 가 둘 다 발화해 마지막 글자가 또 전송됨.
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (mention) {
        pickMention(mention.hits[0]!.name);
        return;
      }
      submit();
    }
  }

  return (
    <div className="relative pb-5">
      {/* 멘션 자동완성 */}
      {mention ? (
        <div className="absolute bottom-full left-0 z-10 mb-2 w-56 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
          {mention.hits.map((a) => (
            <button
              key={a.name}
              type="button"
              onClick={() => pickMention(a.name)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60"
            >
              <Avatar name={a.name} size="size-6" />
              <span className="font-medium">{a.label || a.name}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">{a.adapter}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* 대상 에이전트 칩 */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">{t("talk.talkingTo")}</span>
        {agents.map((a) => {
          const on = a.name === active;
          return (
            <button
              key={a.name}
              type="button"
              onClick={() => onActive(a.name)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs font-medium transition-colors",
                on ? "border-primary/50 bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:bg-muted/60",
              )}
            >
              <Avatar name={a.name} size="size-5" />
              {a.label || a.name}
            </button>
          );
        })}
      </div>

      {/* 입력 */}
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring">
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={t("talk.placeholder")}
          className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed outline-none"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          aria-label={t("talk.send")}
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl text-white transition-all",
            text.trim() ? "bg-gradient-accent shadow-[var(--shadow-glow-sm)]" : "bg-muted text-muted-foreground",
          )}
        >
          <ArrowUp className="size-4" />
        </button>
      </div>
    </div>
  );
}
