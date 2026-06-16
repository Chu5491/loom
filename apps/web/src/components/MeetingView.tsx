// 회의실 — 제안 하나를 참여 에이전트들에게 동시에 던지고(병렬 1라운드), 각자
// 독립 의견을 내면 의장이 합의안/실행계획으로 종합한다. run 은 백엔드가
// workflow="meeting:<id>" 로 묶어주고, 여기선 패널/의장을 카드로 스트리밍한다.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, Users, Gavel, ChevronRight } from "lucide-react";
import type { AdapterKind, OfficeEvent, Project, RunInfo } from "@loom/core";
import { api, type Meeting } from "../api/client.js";
import { AgentAvatar } from "./AgentAvatar.js";
import { Markdown } from "./Markdown.js";
import { Button } from "./ui.js";
import { useI18n } from "../context/I18nContext.js";
import { useRunStream } from "../hooks/useRunStream.js";
import { cn } from "../lib/utils.js";

/** 이벤트에서 표시 텍스트 — 최종 result 우선, 없으면 text 이벤트 이어붙임. */
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

function RunCard({
  run,
  adapter,
  tone,
}: {
  run: RunInfo;
  adapter: string;
  tone: "panel" | "chair";
}) {
  const { t } = useI18n();
  const stream = useRunStream(run.id);
  const running = stream.status === "running" && run.status === "running";
  const text = streamText(stream.events);
  const failed = stream.status === "failed" || run.status === "failed";

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border bg-card p-4",
        tone === "chair" ? "border-primary/40 shadow-[var(--shadow-glow-sm)]" : "border-border",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <AgentAvatar adapter={adapter as AdapterKind} size={22} className="rounded-md" />
        <span className="text-sm font-semibold text-foreground">@{run.agent}</span>
        {tone === "chair" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
            <Gavel className="size-3" />
            {t("meeting.chair")}
          </span>
        ) : null}
        {running ? (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            {t("meeting.thinking")}
          </span>
        ) : null}
      </div>
      {failed ? (
        <p className="text-sm text-destructive">{t("meeting.failed")}</p>
      ) : text ? (
        <div className="md max-w-none text-sm">
          <Markdown>{text}</Markdown>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{running ? t("meeting.thinking") : "…"}</p>
      )}
    </div>
  );
}

function MeetingDetail({ meeting, agentAdapter }: { meeting: Meeting; agentAdapter: (name: string) => string }) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("meeting.proposal")}
        </p>
        <p className="whitespace-pre-wrap text-sm text-foreground">{meeting.proposal}</p>
      </div>

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("meeting.opinions")} ({meeting.panel.length})
        </p>
        <div className="grid gap-3 lg:grid-cols-2">
          {meeting.panel.map((run) => (
            <RunCard key={run.id} run={run} adapter={agentAdapter(run.agent)} tone="panel" />
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-primary">
          {t("meeting.synthesis")}
        </p>
        {meeting.chair ? (
          <RunCard run={meeting.chair} adapter={agentAdapter(meeting.chair.agent)} tone="chair" />
        ) : (
          <div className="flex items-center gap-2 rounded-xl border border-dashed border-border/60 bg-card/50 p-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("meeting.awaitingSynthesis")}
          </div>
        )}
      </div>
    </div>
  );
}

export function MeetingView({ project }: { project: Project }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const office = useQuery({ queryKey: ["office"], queryFn: api.getOffice });
  const agents = useMemo(() => office.data?.office.agents ?? [], [office.data]);
  const adapterOf = (name: string) => agents.find((a) => a.name === name)?.adapter ?? "claude-code";

  const meetings = useQuery({
    queryKey: ["meetings", project.id],
    queryFn: () => api.listMeetings(project.id),
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });

  const [proposal, setProposal] = useState("");
  const [participants, setParticipants] = useState<Set<string>>(new Set());
  const [chair, setChair] = useState<string>("");
  const [selected, setSelected] = useState<string | null>(null);
  const [composing, setComposing] = useState(true);

  // 에이전트가 로드되면 기본값 — 참여=전체, 의장=첫 에이전트.
  useEffect(() => {
    if (agents.length === 0 || participants.size > 0) return;
    setParticipants(new Set(agents.map((a) => a.name)));
    setChair((c) => c || agents[0]!.name);
  }, [agents, participants.size]);

  const toggle = (name: string) =>
    setParticipants((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const start = useMutation({
    mutationFn: () =>
      api.startMeeting({
        proposal: proposal.trim(),
        participants: [...participants],
        chair,
        projectId: project.id,
      }),
    onSuccess: (r) => {
      setProposal("");
      setComposing(false);
      setSelected(r.meetingId);
      void qc.invalidateQueries({ queryKey: ["meetings", project.id] });
    },
  });

  const list = meetings.data?.meetings ?? [];
  const current = list.find((m) => m.id === selected) ?? (composing ? null : list[0] ?? null);
  const canStart = proposal.trim().length > 0 && participants.size > 0 && !!chair && !start.isPending;

  return (
    <div className="flex h-full min-h-0 gap-4 p-4 sm:p-6">
      {/* 좌측 — 새 회의 + 지난 회의 목록 */}
      <div className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto">
        <Button onClick={() => { setComposing(true); setSelected(null); }} className="justify-center">
          <Users className="size-4" />
          {t("meeting.new")}
        </Button>
        <div className="space-y-1.5">
          {list.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => { setComposing(false); setSelected(m.id); }}
              className={cn(
                "flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left transition-all",
                current?.id === m.id && !composing
                  ? "border-primary/40 bg-primary/10"
                  : "border-border/50 hover:bg-muted/50",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{m.proposal || t("meeting.untitled")}</p>
                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Users className="size-3" />
                  {m.panel.length}
                  {m.chair ? <Gavel className="ml-1 size-3 text-primary" /> : null}
                </p>
              </div>
              <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/40" />
            </button>
          ))}
        </div>
      </div>

      {/* 우측 — 작성 폼 또는 선택한 회의 상세 */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        {composing || !current ? (
          <div className="mx-auto max-w-2xl space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">{t("meeting.title")}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{t("meeting.subtitle")}</p>
            </div>
            <textarea
              value={proposal}
              onChange={(e) => setProposal(e.target.value)}
              placeholder={t("meeting.placeholder")}
              rows={5}
              className="w-full resize-y rounded-xl border border-border bg-card px-3.5 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
            />

            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("meeting.participants")} ({participants.size})
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {agents.map((a) => (
                  <label
                    key={a.name}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition-all",
                      participants.has(a.name) ? "border-primary/40 bg-primary/10" : "border-border/50 hover:bg-muted/50",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={participants.has(a.name)}
                      onChange={() => toggle(a.name)}
                      className="accent-primary"
                    />
                    <AgentAvatar adapter={a.adapter} size={18} className="rounded" />
                    <span className="truncate text-foreground">{a.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Gavel className="size-3.5" />
                {t("meeting.chairLabel")}
              </span>
              <select
                value={chair}
                onChange={(e) => setChair(e.target.value)}
                className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary/50"
              >
                {agents.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            {start.isError ? (
              <p className="text-sm text-destructive">
                {start.error instanceof Error ? start.error.message : String(start.error)}
              </p>
            ) : null}

            <Button onClick={() => start.mutate()} disabled={!canStart} className="w-full justify-center">
              {start.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {t("meeting.start")}
            </Button>
          </div>
        ) : (
          <MeetingDetail meeting={current} agentAdapter={adapterOf} />
        )}
      </div>
    </div>
  );
}
