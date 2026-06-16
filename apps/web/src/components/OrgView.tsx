// 위임 흐름 트리 — 당신 → 마스터 → 팀원. 마스터가 받은 요청을 팀원에게 위임하면
// 그 트리(parentRunId)가 실시간으로 자란다. 노드를 펼치면 그 위임의 프롬프트·답변·
// 작업량(비용·도구·파일)까지 본다. 작업 상세(TaskDetail)에서 재사용. UI만, 백엔드 그대로.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Check, ChevronDown, ChevronRight, Crown, CornerDownRight, MessageSquare, Wrench, FilePen } from "lucide-react";
import type { AdapterKind, OfficeEvent, RunInfo } from "@loom/core";
import { api } from "../api/client.js";
import { AgentAvatar } from "./AgentAvatar.js";
import { Markdown } from "./Markdown.js";
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
  // 이 에이전트가 쓴 비용·도구·파일 — 위임별 "무슨 일을 했는지"의 근거(req 5).
  const toolCount = useMemo(() => stream.events.filter((e) => e.kind === "tool").length, [stream.events]);
  const fileCount = useMemo(
    () => new Set(stream.events.filter((e): e is Extract<OfficeEvent, { kind: "file" }> => e.kind === "file").map((e) => e.path)).size,
    [stream.events],
  );
  const durationMs = run.startedAt && run.endedAt ? Math.max(0, new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime()) : null;
  const fmtDur = (ms: number) => { const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };

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
            <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">{t("talk.target.master")}</span>
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

      {/* 펼침 — 받은 지시(위임 프롬프트) + 답변 + 작업량(비용·도구·파일). req 5. */}
      {open ? (
        <div className="mb-2 ml-9 mt-1 space-y-2">
          {/* 받은 지시 — 부모(마스터)가 이 에이전트에게 보낸 프롬프트. 루트는 위 '당신의 지시'가 곧 이것. */}
          {depth > 0 && run.prompt ? (
            <div className="rounded-lg border border-border/50 bg-background p-2.5">
              <p className="mb-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <CornerDownRight className="size-3" />{t("org.received")}
              </p>
              <p className="max-h-32 overflow-auto whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/80">{run.prompt}</p>
            </div>
          ) : null}

          {/* 답변 */}
          {resultText ? (
            <div className="rounded-lg border border-border/50 bg-muted/20 p-3 text-[13px] text-foreground/90">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("org.answer")}</p>
              {report?.summary ? (
                <p className="font-medium leading-relaxed">{report.summary}</p>
              ) : (
                <div className="max-w-none"><Markdown>{body.length > 600 ? body.slice(0, 600) + "…" : body}</Markdown></div>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-muted-foreground">{running ? `${t("org.working")}…` : t("org.noOutput")}</p>
          )}

          {/* 작업량 — 비용·도구·파일·시간 */}
          {(toolCount > 0 || fileCount > 0 || durationMs != null || (run.costUsd ?? 0) > 0) ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-muted-foreground">
              {toolCount > 0 ? <span className="inline-flex items-center gap-1"><Wrench className="size-3" />{toolCount} {t("org.tools")}</span> : null}
              {fileCount > 0 ? <span className="inline-flex items-center gap-1"><FilePen className="size-3" />{fileCount} {t("org.files")}</span> : null}
              {durationMs != null ? <span className="tabular-nums">{fmtDur(durationMs)}</span> : null}
              {(run.costUsd ?? 0) > 0 ? <span className="tabular-nums">${run.costUsd!.toFixed(4)}</span> : null}
            </div>
          ) : null}
        </div>
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

export function OrgTree({ threadId, request, adapterOf }: { threadId: string; request: string; adapterOf: (name: string) => string }) {
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
