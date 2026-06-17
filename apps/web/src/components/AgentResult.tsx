// 에이전트 결과 카드 — 한 run(에이전트의 한 작업)을 loom-report 에서 최대한 뽑아
// 컴팩트하게 보여준다: 요약 + 단계·결정·막힌점·파일·질문 + 작업량(도구·파일·비용·시간)
// + 받은 지시/원문. childrenOf 를 주면 위임 트리로 재귀(마스터→팀원 플로우).
// 작업 상세(OrgTree)와 회의실(패널·의장)이 같은 카드로 통일 — 한눈에 보이게.

import { useMemo, useState } from "react";
import {
  Loader2, Check, ChevronDown, ChevronRight, Crown, Gavel, CornerDownRight, MessageSquare,
  Wrench, FilePen, FileText, ListChecks, Sparkles, AlertTriangle, HelpCircle,
} from "lucide-react";
import type { AdapterKind, OfficeEvent, RunInfo } from "@loom/core";
import { AgentAvatar } from "./AgentAvatar.js";
import { Markdown } from "./Markdown.js";
import { useI18n } from "../context/I18nContext.js";
import { useRunStream } from "../hooks/useRunStream.js";
import { extractReport } from "../lib/report.js";
import { cn } from "../lib/utils.js";

export type AgentRole = "master" | "chair" | "panel" | "team";

function streamText(events: OfficeEvent[]): string {
  const result = [...events].reverse().find(
    (e): e is Extract<OfficeEvent, { kind: "result" }> => e.kind === "result",
  );
  if (result?.text) return result.text;
  return events.filter((e): e is Extract<OfficeEvent, { kind: "text" }> => e.kind === "text").map((e) => e.text).join("");
}

function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

// 구조 섹션(단계·결정·막힌점) — 작은 헤더 + 빽빽한 리스트.
function Section({ icon, label, items, tone }: { icon: React.ReactNode; label: string; items: string[]; tone?: "warn" }) {
  if (!items.length) return null;
  return (
    <div className="mt-2">
      <p className={cn("mb-0.5 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide", tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
        {icon}{label}<span className="opacity-50">{items.length}</span>
      </p>
      <ul className="space-y-0.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-1.5 text-[12px] leading-snug text-foreground/85">
            <span className={cn("mt-[5px] size-1 shrink-0 rounded-full", tone === "warn" ? "bg-amber-500" : "bg-primary/50")} />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AgentResultCard({
  run,
  adapterOf,
  role = "team",
  reason,
  depth = 0,
  showPrompt = false,
  childrenOf,
}: {
  run: RunInfo;
  adapterOf: (name: string) => string;
  role?: AgentRole;
  /** 부모가 이 에이전트에게 위임한 사유(흐름 추적). */
  reason?: string;
  depth?: number;
  /** 받은 지시(위임 프롬프트 = run.prompt)를 접이식으로 노출. */
  showPrompt?: boolean;
  /** 주면 위임 트리 모드 — 자식 run 을 재귀로 렌더(단일 스트림으로 자식 사유까지 계산). */
  childrenOf?: (id: string) => RunInfo[];
}) {
  const { t } = useI18n();
  const stream = useRunStream(run.id);
  const { body, report } = extractReport(streamText(stream.events));
  const status = stream.status === "running" && run.status === "running" ? "running" : run.status;
  const running = status === "running";
  const failed = status === "failed";
  const [promptOpen, setPromptOpen] = useState(false);
  const [proseOpen, setProseOpen] = useState(false);

  const toolCount = useMemo(() => stream.events.filter((e) => e.kind === "tool").length, [stream.events]);
  const evFileCount = useMemo(
    () => new Set(stream.events.filter((e): e is Extract<OfficeEvent, { kind: "file" }> => e.kind === "file").map((e) => e.path)).size,
    [stream.events],
  );
  const fileCount = report?.files?.length || evFileCount;
  const durationMs = run.startedAt && run.endedAt ? Math.max(0, new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime()) : null;
  // 이 에이전트가 자식에게 위임한 사유 — handoff 이벤트로 자식 카드에 흐름을 잇는다.
  const reasonFor = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of stream.events) if (e.kind === "handoff" && e.reason) m.set(e.toAgent, e.reason);
    return (name: string) => m.get(name);
  }, [stream.events]);
  const kids = childrenOf?.(run.id) ?? [];

  const summary = report?.summary || (body ? body.split("\n").find((l) => l.trim()) ?? "" : "");
  const proseDistinct = !!body && !!report; // 리포트와 별개의 산문이 있으면 토글로
  const lead = role === "master" || role === "chair";

  return (
    <div>
      <div className={cn("rounded-xl border p-3 transition-colors", lead ? "border-primary/30 bg-primary/[0.04]" : "border-border bg-card")}>
        {/* 헤더 — 아바타·이름·역할·상태 + 작업량(우측) 한 줄 */}
        <div className="flex items-center gap-2">
          <AgentAvatar adapter={adapterOf(run.agent) as AdapterKind} size={24} className="shrink-0 rounded-lg" />
          <span className="truncate text-sm font-semibold text-foreground">@{run.agent}</span>
          {role === "master" ? (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400"><Crown className="size-2.5" />{t("talk.target.master")}</span>
          ) : role === "chair" ? (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary"><Gavel className="size-2.5" />{t("meeting.chair")}</span>
          ) : depth > 0 ? (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{t("org.depth", { n: String(depth) })}</span>
          ) : null}
          {running ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"><Loader2 className="size-2.5 animate-spin" />{t("org.working")}</span>
          ) : failed ? (
            <span className="shrink-0 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">{t("org.failed")}</span>
          ) : status === "cancelled" ? (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{t("org.cancelled")}</span>
          ) : (
            <Check className="size-3.5 shrink-0 text-emerald-500" />
          )}
          {/* 작업량 — 우측 정렬 칩 */}
          <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px] font-medium text-muted-foreground">
            {toolCount > 0 ? <span className="inline-flex items-center gap-0.5" title={t("org.tools")}><Wrench className="size-3" />{toolCount}</span> : null}
            {fileCount > 0 ? <span className="inline-flex items-center gap-0.5" title={t("org.files")}><FilePen className="size-3" />{fileCount}</span> : null}
            {durationMs != null ? <span className="tabular-nums">{fmtDur(durationMs)}</span> : null}
            {(run.costUsd ?? 0) > 0 ? <span className="tabular-nums">${run.costUsd!.toFixed(4)}</span> : null}
          </span>
        </div>

        {/* 위임 사유 — 부모가 왜 이 에이전트에게 넘겼나 */}
        {reason ? (
          <p className="mt-1.5 flex items-start gap-1 text-[11px] italic text-muted-foreground">
            <MessageSquare className="mt-0.5 size-3 shrink-0" />{reason}
          </p>
        ) : null}

        {/* 내용 */}
        {failed ? (
          <p className="mt-2 text-[12px] text-destructive">{t("meeting.failed")}</p>
        ) : (
          <>
            {summary ? <p className="mt-2 text-[13px] font-medium leading-snug text-foreground">{summary}</p> : null}
            {!summary && running ? <p className="mt-2 text-[12px] text-muted-foreground">{t("org.working")}…</p> : null}
            {!summary && !running && !body ? <p className="mt-2 text-[12px] text-muted-foreground">{t("org.noOutput")}</p> : null}

            {report?.steps?.length ? <Section icon={<ListChecks className="size-3" />} label={t("tasks.d.steps")} items={report.steps} /> : null}
            {report?.decisions?.length ? <Section icon={<Sparkles className="size-3" />} label={t("tasks.d.decisions")} items={report.decisions} /> : null}
            {report?.blockers?.length ? <Section icon={<AlertTriangle className="size-3" />} label={t("tasks.d.blockers")} items={report.blockers} tone="warn" /> : null}

            {report?.files?.length ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {report.files.map((f, i) => (
                  <span key={i} title={f.path} className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">
                    <FileText className="size-2.5 shrink-0" />{f.path.split("/").pop()}{f.action ? <span className="not-italic opacity-60">·{f.action}</span> : null}
                  </span>
                ))}
              </div>
            ) : null}

            {report?.question ? (
              <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5">
                <p className="mb-0.5 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-primary"><HelpCircle className="size-3" />{t("tasks.d.question")}</p>
                <p className="text-[12.5px] text-foreground/90">{report.question}</p>
              </div>
            ) : null}

            {/* 리포트 없이 산문만(예: 회의 패널 의견) → 본문 그대로 */}
            {!report && body ? (
              <div className="mt-2 max-w-none text-[13px] leading-relaxed text-foreground/90"><Markdown>{body}</Markdown></div>
            ) : null}

            {/* 받은 지시(위임 프롬프트) */}
            {showPrompt && run.prompt ? (
              <div className="mt-2">
                <button type="button" onClick={() => setPromptOpen((v) => !v)} className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground">
                  <CornerDownRight className="size-3" />{t("org.received")}{promptOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                </button>
                {promptOpen ? <p className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-background p-2 text-[12px] leading-relaxed text-foreground/80">{run.prompt}</p> : null}
              </div>
            ) : null}

            {/* 원문(리포트와 별개) 토글 */}
            {proseDistinct ? (
              <div className="mt-2">
                <button type="button" onClick={() => setProseOpen((v) => !v)} className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground">
                  {proseOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}{t("talk.report.showProse")}
                </button>
                {proseOpen ? <div className="mt-1 max-w-none rounded-md border border-border/60 bg-muted/20 p-2 text-[12.5px] leading-relaxed text-foreground/85"><Markdown>{body}</Markdown></div> : null}
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* 위임 트리 — 자식 카드를 연결선과 함께 재귀 */}
      {kids.length ? (
        <div className="ml-4 mt-2 space-y-2 border-l-2 border-border/60 pl-3">
          {kids.map((c) => (
            <AgentResultCard key={c.id} run={c} adapterOf={adapterOf} role="team" depth={depth + 1} reason={reasonFor(c.agent)} showPrompt childrenOf={childrenOf} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
