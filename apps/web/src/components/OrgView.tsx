// 조직 라이브 뷰 — 당신은 대표. 리드 한 명에게만 지시하면, 리드가 팀원에게 위임하고
// 그 위임 트리(당신 → 리드 → 팀원 → …)가 실시간 그래프로 자란다. 노드 클릭 = 그
// 에이전트의 작업 조회. 위임 백엔드(parentRunId 트리)를 그대로 시각화 — UI만 새로.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, Network, Check, ChevronDown, ChevronRight, Crown, CornerDownRight, MessageSquare } from "lucide-react";
import type { AdapterKind, OfficeEvent, Project, RunInfo } from "@loom/core";
import { api } from "../api/client.js";
import { AgentAvatar } from "./AgentAvatar.js";
import { Markdown } from "./Markdown.js";
import { Button } from "./ui.js";
import { useI18n } from "../context/I18nContext.js";
import { useRunStream } from "../hooks/useRunStream.js";
import { extractReport } from "../lib/report.js";
import { cn } from "../lib/utils.js";

function streamText(events: OfficeEvent[]): string {
  const result = [...events].reverse().find(
    (e): e is Extract<OfficeEvent, { kind: "result" }> => e.kind === "result",
  );
  if (result?.text) return result.text;
  return events
    .filter((e): e is Extract<OfficeEvent, { kind: "text" }> => e.kind === "text")
    .map((e) => e.text)
    .join("");
}

interface OrgSession {
  threadId: string;
  title: string; // 리드에게 준 지시
  lead: RunInfo; // 루트 run(당신이 지시한 한 명)
  latestAt: string; // 트리 내 최신 활동 시각
  size: number; // 트리 전체 run 수(리드+위임)
}

/** 프로젝트 run 들을 "조직 세션"으로 묶는다 = 스레드별 루트(parentRunId 없는) 리드 run. */
function groupSessions(runs: RunInfo[]): OrgSession[] {
  const byThread = new Map<string, RunInfo[]>();
  for (const r of runs) {
    if (!r.threadId || r.workflow) continue; // 워크플로우/회의 run 제외
    const g = byThread.get(r.threadId);
    if (g) g.push(r);
    else byThread.set(r.threadId, [r]);
  }
  const sessions: OrgSession[] = [];
  for (const [threadId, group] of byThread) {
    const root = group.find((r) => !r.parentRunId) ?? [...group].sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
    if (!root) continue;
    const latestAt = group.reduce((m, r) => (r.startedAt > m ? r.startedAt : m), root.startedAt);
    sessions.push({ threadId, title: root.prompt, lead: root, latestAt, size: group.length });
  }
  return sessions.sort((a, b) => b.latestAt.localeCompare(a.latestAt));
}

const statusTone = (s: RunInfo["status"]) =>
  s === "running" ? "running" : s === "failed" ? "failed" : s === "cancelled" ? "cancelled" : "done";

// 조직 노드 — 한 에이전트의 작업. 한 스트림으로 상태 + 위임 사유 + 결과를 모두 본다.
// reason = 부모가 이 노드에게 위임한 이유(흐름 추적의 핵심). 자식은 아래로 재귀(연결선).
function OrgNode({
  run,
  childrenOf,
  adapterOf,
  depth,
  reason,
}: {
  run: RunInfo;
  childrenOf: (id: string) => RunInfo[];
  adapterOf: (name: string) => string;
  depth: number;
  reason?: string;
}) {
  const { t } = useI18n();
  const stream = useRunStream(run.id);
  const status = statusTone(stream.status === "running" && run.status === "running" ? "running" : run.status);
  const running = status === "running";
  const [open, setOpen] = useState(depth === 0); // 리드는 기본 펼침
  const kids = childrenOf(run.id);

  // 이 노드가 자식에게 위임한 사유 — handoff 이벤트(toAgent → reason)로 흐름을 잇는다.
  const reasonFor = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of stream.events) {
      if (e.kind === "handoff" && e.reason) m.set(e.toAgent, e.reason);
    }
    return (agentName: string) => m.get(agentName);
  }, [stream.events]);

  const { body, report } = extractReport(streamText(stream.events));
  const resultText = report?.summary || body;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-all",
          depth === 0 ? "border-primary/40 bg-primary/5 shadow-[var(--shadow-glow-sm)]" : "border-border bg-card",
        )}
      >
        <span className="relative shrink-0">
          <AgentAvatar adapter={adapterOf(run.agent) as AdapterKind} size={26} className="rounded-lg" />
          {depth === 0 ? <Crown className="absolute -right-1.5 -top-1.5 size-3.5 text-amber-500" /> : null}
        </span>
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="truncate text-sm font-semibold text-foreground">@{run.agent}</span>
          {depth === 0 ? (
            <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">{t("org.lead")}</span>
          ) : (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{t("org.depth", { n: String(depth) })}</span>
          )}
          {kids.length ? (
            <span className="shrink-0 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
              <CornerDownRight className="size-3" />{kids.length}
            </span>
          ) : null}
          <span className="ml-auto shrink-0">
            {running ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                <Loader2 className="size-3 animate-spin" />{t("org.working")}
              </span>
            ) : status === "failed" ? (
              <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">{t("org.failed")}</span>
            ) : status === "cancelled" ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{t("org.cancelled")}</span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                <Check className="size-3" />{t("org.done")}
              </span>
            )}
          </span>
          {open ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
        </button>
      </div>

      {/* 위임 사유 — 부모가 왜 이 팀원에게 넘겼나(흐름 추적) */}
      {reason ? (
        <p className="ml-9 mt-1 flex items-start gap-1 text-[11px] italic text-muted-foreground">
          <MessageSquare className="mt-0.5 size-3 shrink-0" />{reason}
        </p>
      ) : null}

      {/* 결과 */}
      {open ? (
        resultText ? (
          <div className="mb-2 ml-9 mt-1 rounded-lg border border-border/50 bg-muted/20 p-3 text-[13px] text-foreground/90">
            {report?.summary ? (
              <p className="font-medium leading-relaxed">{report.summary}</p>
            ) : (
              <div className="max-w-none"><Markdown>{body.length > 500 ? body.slice(0, 500) + "…" : body}</Markdown></div>
            )}
          </div>
        ) : (
          <p className="mb-2 ml-9 mt-1 text-[12px] text-muted-foreground">{running ? `${t("org.working")}…` : t("org.noOutput")}</p>
        )
      ) : null}

      {kids.length ? (
        <div className="ml-5 mt-2 space-y-2 border-l-2 border-border/60 pl-4">
          {kids.map((c) => (
            <OrgNode key={c.id} run={c} childrenOf={childrenOf} adapterOf={adapterOf} depth={depth + 1} reason={reasonFor(c.agent)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function OrgTree({ threadId, request, adapterOf }: { threadId: string; request: string; adapterOf: (name: string) => string }) {
  const { t } = useI18n();
  const runsQ = useQuery({
    queryKey: ["runs", threadId],
    queryFn: () => api.listRuns(threadId),
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  });
  const runs = runsQ.data?.runs ?? [];
  const childrenOf = useMemo(() => {
    const map = new Map<string, RunInfo[]>();
    for (const r of runs) {
      if (!r.parentRunId) continue;
      const g = map.get(r.parentRunId);
      if (g) g.push(r);
      else map.set(r.parentRunId, [r]);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    return (id: string) => map.get(id) ?? [];
  }, [runs]);
  const roots = useMemo(
    () => runs.filter((r) => !r.parentRunId || !runs.some((x) => x.id === r.parentRunId)).sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    [runs],
  );

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* 당신의 지시 — 조직의 출발점 */}
      <div className="relative mb-3 rounded-xl border border-border bg-muted/30 p-3.5">
        <p className="mb-1 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Crown className="size-3.5 text-amber-500" />{t("org.youSaid")}
        </p>
        <p className="whitespace-pre-wrap text-sm text-foreground">{request}</p>
      </div>
      <div className="ml-5 mb-2 h-4 w-px bg-gradient-to-b from-primary/40 to-border" />

      {roots.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("org.starting")}…</p>
      ) : (
        <div className="space-y-2">
          {roots.map((r) => (
            <OrgNode key={r.id} run={r} childrenOf={childrenOf} adapterOf={adapterOf} depth={0} />
          ))}
        </div>
      )}
    </div>
  );
}

export function OrgView({ project }: { project: Project }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const office = useQuery({ queryKey: ["office"], queryFn: api.getOffice });
  const agents = useMemo(() => office.data?.office.agents ?? [], [office.data]);
  const leads = useMemo(() => agents.filter((a) => a.delegate), [agents]);
  const adapterOf = (name: string) => agents.find((a) => a.name === name)?.adapter ?? "claude-code";

  const runsQ = useQuery({
    queryKey: ["runs", "project", project.id],
    queryFn: () => api.listProjectRuns(project.id),
    refetchInterval: 4000,
    refetchIntervalInBackground: true,
  });
  const sessions = useMemo(() => groupSessions(runsQ.data?.runs ?? []), [runsQ.data]);

  const [lead, setLead] = useState("");
  const [input, setInput] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [composing, setComposing] = useState(true);

  // 리드 기본값 — delegate 가능한 첫 에이전트(없으면 첫 에이전트).
  const leadValue = lead || leads[0]?.name || agents[0]?.name || "";

  const refetch = () => void qc.invalidateQueries({ queryKey: ["runs", "project", project.id] });

  const assign = useMutation({
    mutationFn: async () => {
      const prompt = input.trim();
      const { thread } = await api.createThread(prompt.slice(0, 60), project.id);
      await api.startRun({ agent: leadValue, prompt, projectId: project.id, threadId: thread.id });
      return thread.id;
    },
    onSuccess: (threadId) => { setInput(""); setComposing(false); setSelected(threadId); refetch(); },
  });

  const current = sessions.find((s) => s.threadId === selected) ?? (composing ? null : sessions[0] ?? null);
  const canAssign = input.trim().length > 0 && !!leadValue && !assign.isPending;
  const leadNoDelegate = !!leadValue && !leads.some((l) => l.name === leadValue);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 gap-4 p-4 sm:p-6">
      {/* 좌측 — 새 지시 + 지난 지시 */}
      <div className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto">
        <Button onClick={() => { setComposing(true); setSelected(null); }} className="justify-center">
          <Network className="size-4" />{t("org.new")}
        </Button>
        <div className="space-y-1.5">
          {sessions.map((s) => (
            <button
              key={s.threadId}
              type="button"
              onClick={() => { setComposing(false); setSelected(s.threadId); }}
              className={cn(
                "flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left transition-all",
                current?.threadId === s.threadId && !composing ? "border-primary/40 bg-primary/10" : "border-border/50 hover:bg-muted/50",
              )}
            >
              <AgentAvatar adapter={adapterOf(s.lead.agent) as AdapterKind} size={20} className="mt-0.5 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{s.title || t("org.untitled")}</p>
                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Network className="size-3" />{s.size}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 우측 — 새 지시 폼 또는 조직 트리 */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        {composing || !current ? (
          <div className="mx-auto w-full max-w-2xl pt-2">
            <div className="mb-6 text-center">
              <div className="mx-auto mb-3 inline-flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Network className="size-6" /></div>
              <h2 className="text-2xl font-bold tracking-tight text-foreground">{t("org.title")}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{t("org.subtitle")}</p>
            </div>

            <div className="rounded-2xl border border-border bg-card p-3 shadow-sm transition-all focus-within:border-primary/50">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canAssign) assign.mutate(); }}
                placeholder={t("org.placeholder")}
                rows={4}
                className="w-full resize-y bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
              />
              <div className="mt-2 flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground"><Crown className="size-3.5 text-amber-500" />{t("org.leadLabel")}</span>
                <select
                  value={leadValue}
                  onChange={(e) => setLead(e.target.value)}
                  className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
                >
                  {agents.map((a) => (
                    <option key={a.name} value={a.name}>{a.name}{a.delegate ? " ★" : ""}</option>
                  ))}
                </select>
                <Button onClick={() => assign.mutate()} disabled={!canAssign} className="ml-auto">
                  {assign.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  {t("org.assign")}
                </Button>
              </div>
            </div>
            {leadNoDelegate ? (
              <p className="mt-2 text-[12px] text-amber-600 dark:text-amber-400">{t("org.noDelegateHint")}</p>
            ) : null}
            {assign.isError ? (
              <p className="mt-2 text-sm text-destructive">{assign.error instanceof Error ? assign.error.message : String(assign.error)}</p>
            ) : null}
          </div>
        ) : (
          <OrgTree threadId={current.threadId} request={current.title} adapterOf={adapterOf} />
        )}
      </div>
    </div>
  );
}
