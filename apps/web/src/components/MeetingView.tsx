// 회의실 — 제안 하나를 참여 에이전트들에게 동시에 던지고(병렬 1라운드), 각자
// 독립 의견을 내면 의장이 합의안/실행계획으로 종합한다. run 은 백엔드가
// workflow="meeting:<id>" 로 묶어주고, 여기선 패널/의장을 카드로 스트리밍한다.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, Users, Gavel, ChevronRight, RotateCcw, Trash2 } from "lucide-react";
import type { Project } from "@loom/core";
import { api, type Meeting } from "../api/client.js";
import { AgentAvatar } from "./AgentAvatar.js";
import { AgentResultCard } from "./AgentResult.js";
import { Button } from "./ui.js";
import { useI18n } from "../context/I18nContext.js";
import { useConfirm, useAlert } from "../context/DialogContext.js";
import { cn } from "../lib/utils.js";

// 회의 상세 — 안건 → 정보(패널) → 취합(의장). 각 카드는 AgentResultCard 로
// loom-report 상세(요약·단계·결정·파일·도구·비용)까지 컴팩트하게 한눈에.
function MeetingDetail({
  meeting,
  agentAdapter,
  onRerun,
  onDelete,
  rerunPending,
  deletePending,
}: {
  meeting: Meeting;
  agentAdapter: (name: string) => string;
  onRerun: () => void;
  onDelete: () => void;
  rerunPending: boolean;
  deletePending: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex w-full max-w-5xl animate-in fade-in flex-col gap-4 pb-10 pt-1">
      {/* 액션 — 재실행(같은 안건·참석자로 새 회의) · 삭제 */}
      <div className="flex items-center justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onRerun} disabled={rerunPending}>
          {rerunPending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
          {t("meeting.rerun")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          disabled={deletePending}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          {deletePending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
          {t("meeting.delete")}
        </Button>
      </div>

      {/* 안건 */}
      <div className="rounded-xl border border-primary/20 bg-card px-3.5 py-3 shadow-sm">
        <p className="mb-1 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
          <Send className="size-3.5" />{t("meeting.proposal")}
        </p>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{meeting.proposal}</p>
      </div>

      {/* 정보 — 패널 입력(병렬) */}
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-foreground">
          <Users className="size-4 text-muted-foreground" />{t("meeting.opinions")}
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{meeting.panel.length}</span>
        </h3>
        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {meeting.panel.map((run) => (
            <AgentResultCard key={run.id} run={run} adapterOf={agentAdapter} role="panel" />
          ))}
        </div>
      </div>

      {/* 취합 — 의장 */}
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-foreground">
          <Gavel className="size-4 text-primary" />{t("meeting.synthesis")}
        </h3>
        {meeting.chair ? (
          <AgentResultCard run={meeting.chair} adapterOf={agentAdapter} role="chair" />
        ) : (
          <div className="flex items-center gap-2 rounded-xl border border-dashed border-primary/30 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-primary" />{t("meeting.awaitingSynthesis")}
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
  const [selected, setSelected] = useState<string | null>(null);
  const [composing, setComposing] = useState(true);

  // 에이전트가 로드되면 기본 참여 = 전체. 의장은 선택하지 않는다(meeting 기능이 종합).
  useEffect(() => {
    if (agents.length === 0 || participants.size > 0) return;
    setParticipants(new Set(agents.map((a) => a.name)));
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
        projectId: project.id,
      }),
    onSuccess: (r) => {
      setProposal("");
      setComposing(false);
      setSelected(r.meetingId);
      void qc.invalidateQueries({ queryKey: ["meetings", project.id] });
    },
  });

  const confirm = useConfirm();
  const alert = useAlert();
  const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

  // 재실행 = 같은 안건·참석자로 새 회의를 띄운다(원본은 그대로 둠).
  const rerun = useMutation({
    mutationFn: (m: Meeting) =>
      api.startMeeting({
        proposal: m.proposal,
        participants: [...new Set(m.panel.map((r) => r.agent))],
        projectId: project.id,
      }),
    onSuccess: (r) => {
      setComposing(false);
      setSelected(r.meetingId);
      void qc.invalidateQueries({ queryKey: ["meetings", project.id] });
    },
    onError: (e) => void alert(errMsg(e)),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.deleteMeeting(id),
    onSuccess: (_r, id) => {
      setSelected((cur) => (cur === id ? null : cur)); // 지운 게 선택돼 있었으면 다음 회의로
      setComposing(false);
      void qc.invalidateQueries({ queryKey: ["meetings", project.id] });
    },
    onError: (e) => void alert(errMsg(e)),
  });

  const confirmDelete = async (m: Meeting) => {
    if (await confirm({ body: t("meeting.deleteConfirm"), tone: "danger", confirmLabel: t("common.delete") })) {
      del.mutate(m.id);
    }
  };

  const list = meetings.data?.meetings ?? [];
  const current = list.find((m) => m.id === selected) ?? (composing ? null : list[0] ?? null);
  const canStart = proposal.trim().length > 0 && participants.size > 0 && !start.isPending;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 gap-4 p-4 sm:p-6">
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
          <div className="mx-auto flex w-full max-w-3xl animate-in fade-in slide-in-from-bottom-2 flex-col gap-4 pb-10 pt-2">
            {/* 헤더 — 컴팩트 한 줄 */}
            <div className="flex items-center gap-3">
              <div className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Users className="size-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-bold tracking-tight text-foreground">{t("meeting.title")}</h2>
                <p className="truncate text-[12.5px] text-muted-foreground">{t("meeting.subtitle")}</p>
              </div>
            </div>

            {/* 1. 안건 */}
            <div className="flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm transition-all focus-within:border-primary/50">
              <div className="flex items-center gap-2 border-b border-border/50 bg-muted/20 px-4 py-2.5">
                <Send className="size-3.5 text-primary" />
                <h3 className="text-[13px] font-bold text-foreground">{t("meeting.proposal")}</h3>
              </div>
              <textarea
                value={proposal}
                onChange={(e) => setProposal(e.target.value)}
                placeholder={t("meeting.placeholder")}
                rows={5}
                className="w-full resize-y border-0 bg-transparent px-4 py-3 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground focus:ring-0"
              />
            </div>

            {/* 2. 참석자 + 시작 — 의장은 안 고른다(오피스의 회의 기능이 종합) */}
            <div className="flex w-full flex-col rounded-2xl border border-border/50 bg-card/50 p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-[13px] font-bold text-foreground">
                  <Users className="size-3.5 text-muted-foreground" />{t("meeting.participants")}
                </h3>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
                  {participants.size} / {agents.length}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {agents.map((a) => (
                  <label
                    key={a.name}
                    className={cn(
                      "group relative flex cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-2 transition-all hover:border-primary/40",
                      participants.has(a.name)
                        ? "border-primary/40 bg-primary/5 shadow-sm"
                        : "border-border/50 bg-card/30 opacity-70 hover:opacity-100",
                    )}
                  >
                    <AgentAvatar adapter={a.adapter} size={26} className="shrink-0 rounded-lg shadow-sm" />
                    <span className={cn("min-w-0 flex-1 truncate text-[12px] transition-colors", participants.has(a.name) ? "font-bold text-foreground" : "font-medium text-muted-foreground group-hover:text-foreground")}>
                      {a.name}
                    </span>
                    {participants.has(a.name) ? (
                      <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                      </span>
                    ) : null}
                    <input
                      type="checkbox"
                      checked={participants.has(a.name)}
                      onChange={() => toggle(a.name)}
                      className="sr-only"
                    />
                  </label>
                ))}
              </div>

              <div className="mt-4 flex flex-col gap-3 border-t border-border/50 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  <Gavel className="size-3.5 shrink-0 text-primary" />{t("meeting.chairAuto")}
                </p>
                <div className="flex w-full shrink-0 flex-col sm:w-auto sm:items-end">
                  {start.isError ? (
                    <div className="mb-2 rounded-lg border border-destructive/20 bg-destructive/10 p-2.5 text-xs text-destructive">
                      {start.error instanceof Error ? start.error.message : String(start.error)}
                    </div>
                  ) : null}
                  <Button
                    onClick={() => start.mutate()}
                    disabled={!canStart}
                    className="h-11 w-full justify-center rounded-xl px-6 text-sm font-bold sm:w-[200px]"
                  >
                    {start.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                    {t("meeting.start")}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <MeetingDetail
            meeting={current}
            agentAdapter={adapterOf}
            onRerun={() => rerun.mutate(current)}
            onDelete={() => void confirmDelete(current)}
            rerunPending={rerun.isPending}
            deletePending={del.isPending}
          />
        )}
      </div>
    </div>
  );
}
