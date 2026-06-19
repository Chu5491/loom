// Talk 워크스페이스의 모달들 — 노트 편집, 워크플로우 수동 실행, run 상세.
// TalkPage 에서 분리(독립적: 공유 상태 없이 props + 자체 쿼리로 동작).

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CirclePlay, NotebookPen, X } from "lucide-react";
import type { AgentSpec, RunInfo, WorkflowSpec } from "@loom/core";
import { api } from "../../api/client.js";
import { AgentAvatar } from "../AgentAvatar.js";
import { Button } from "../ui.js";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";

export function NotesModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const notes = useQuery({ queryKey: ["notes", projectId], queryFn: () => api.getNotes(projectId) });
  const [draft, setDraft] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (text: string) => api.putNotes(projectId, text),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["notes", projectId] }); onClose(); },
  });
  const value = draft ?? notes.data?.notes ?? "";
  const empty = !notes.isLoading && notes.data?.notes == null && draft === null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-card p-4 shadow-2xl">
        <div className="mb-2 flex items-center gap-2">
          <NotebookPen className="size-4 text-primary" />
          <h2 className="font-display text-base font-semibold">{t("notes.title")}</h2>
          <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">.loom/notes.md</code>
          <button type="button" onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground" aria-label="close">
            <X className="size-4" />
          </button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">{t("notes.hint")}</p>
        {empty ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-10 text-center">
            <p className="max-w-sm text-sm text-muted-foreground">{t("notes.empty")}</p>
            <Button size="sm" onClick={() => setDraft(`# ${t("notes.title")}\n\n`)}>
              <NotebookPen className="size-3.5" />
              {t("notes.start")}
            </Button>
          </div>
        ) : (
          <>
            <textarea
              value={value}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-72 flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2.5 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={onClose}>{t("common.cancel")}</Button>
              <Button size="sm" disabled={draft === null || save.isPending} onClick={() => save.mutate(value)}>
                {save.isPending ? "…" : t("notes.save")}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function WorkflowRunModal({
  workflows, initialName, onClose, onRun,
}: {
  workflows: WorkflowSpec[];
  initialName?: string;
  onClose: () => void;
  onRun: (name: string, input: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initialName ?? workflows[0]?.name ?? "");
  const [input, setInput] = useState("");
  const wf = workflows.find((w) => w.name === name);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
            <CirclePlay className="size-4.5" />
          </span>
          <h2 className="font-display text-base font-semibold">{t("talk.workflow.run")}</h2>
        </div>
        <select
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-4 h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {workflows.map((w) => (
            <option key={w.name} value={w.name}>{w.name} · {t("talk.workflow.steps", { n: String(w.nodes.length) })}</option>
          ))}
        </select>
        {wf?.description ? <p className="mt-1.5 text-xs text-muted-foreground">{wf.description}</p> : null}
        <textarea
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("talk.workflow.inputPh")}
          className="mt-3 min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/60">
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={!name || !input.trim()}
            onClick={() => onRun(name, input.trim())}
            className="rounded-md bg-gradient-accent px-3 py-1.5 text-xs font-medium text-white shadow-[var(--shadow-glow-sm)] disabled:opacity-40"
          >
            {t("talk.workflow.go")}
          </button>
        </div>
      </div>
    </div>
  );
}

// run 상세 모달 — 메타 + [전달 프롬프트][Raw 로그] 탭. Raw 는 진실(디스크 보존본).
export function RunDetailModal({ run, agent, onClose }: { run: RunInfo; agent?: AgentSpec; onClose: () => void }) {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<"prompt" | "raw">("prompt");
  const promptQ = useQuery({ queryKey: ["runPrompt", run.id], queryFn: () => api.getRunPrompt(run.id), staleTime: Infinity });
  const rawQ = useQuery({ queryKey: ["runRaw", run.id], queryFn: () => api.getRunRaw(run.id), enabled: tab === "raw" });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(lang === "ko" ? "ko-KR" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="flex h-[80vh] w-full max-w-3xl flex-col rounded-2xl border border-border bg-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        {/* 메타 */}
        <div className="flex flex-wrap items-center gap-2">
          {agent ? <AgentAvatar adapter={agent.adapter} size={24} className="rounded-md" /> : null}
          <span className="font-display text-sm font-semibold">@{run.agent}</span>
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium",
            run.status === "succeeded" ? "bg-success/15 text-success" : run.status === "running" ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive")}>
            {run.status}
          </span>
          {run.workflow ? (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">{run.workflow} · {run.node}</span>
          ) : null}
          {run.costUsd != null ? <span className="font-mono text-[11px] text-muted-foreground" title={run.costEstimated ? t("cost.estimated") : undefined}>{run.costEstimated ? "~" : ""}${run.costUsd.toFixed(4)}</span> : null}
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">{run.id.slice(0, 8)}</span>
          <button type="button" aria-label="close" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">{fmt(run.startedAt)} → {fmt(run.endedAt)}</p>

        {/* 탭 */}
        <div className="mt-3 inline-flex w-fit rounded-lg border border-border bg-muted/40 p-0.5">
          {(["prompt", "raw"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-all", tab === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {t(`talk.detail.${k}`)}
            </button>
          ))}
        </div>

        <pre className="mt-2 min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {tab === "prompt"
            ? promptQ.data?.prompt ?? (promptQ.isLoading ? "…" : t("talk.promptPeek.missing"))
            : rawQ.data?.raw ?? (rawQ.isLoading ? "…" : t("talk.detail.rawMissing"))}
        </pre>
      </div>
    </div>
  );
}
