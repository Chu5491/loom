// 프로젝트 관리 — 등록·통계·라이브 상태를 운영자 시점으로. 홈(관제센터)이 요약이라면
// 여긴 프로젝트 하나하나의 행정: 누적 run·비용·대화, 지금 도는 작업, 등록/해제.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CircleDollarSign, FolderGit2, MessagesSquare, Plus, Terminal, Trash2 } from "lucide-react";
import type { Project, RunInfo } from "@loom/core";
import { api } from "../api/client.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { Button, PageShell, Panel, StatusDot } from "../components/ui.js";
import { useI18n } from "../context/I18nContext.js";
import { AddProject } from "./HomePage.js";

export function ProjectsPage({ onOpen }: { onOpen: (projectId: string) => void }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
  const runsQ = useQuery({
    queryKey: ["runs", "all"],
    queryFn: api.listRunsAll,
    refetchInterval: 5_000,
    refetchIntervalInBackground: true,
  });
  const running = (runsQ.data?.runs ?? []).filter((r) => r.status === "running");

  const [adding, setAdding] = useState(false);
  const [pendingDel, setPendingDel] = useState<{ id: string; name: string } | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["projects"] }),
  });

  const list = projects.data?.projects ?? [];
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString(lang === "ko" ? "ko-KR" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <PageShell
      title={t("projects.title")}
      subtitle={t("projects.subtitle")}
      actions={
        <Button onClick={() => setAdding(true)}>
          <Plus className="size-4" />
          {t("home.add")}
        </Button>
      }
    >
      {adding ? (
        <AddProject
          onDone={(id) => {
            setAdding(false);
            void qc.invalidateQueries({ queryKey: ["projects"] }).then(() => { if (id) onOpen(id); });
          }}
        />
      ) : null}

      <div className="mt-1 space-y-3">
        {list.map((p) => (
          <ProjectRow
            key={p.id}
            project={p}
            live={running.filter((r) => r.projectId === p.id)}
            fmtDate={fmtDate}
            onOpen={() => onOpen(p.id)}
            onDelete={() => setPendingDel({ id: p.id, name: p.name })}
          />
        ))}
        {list.length === 0 && !adding ? (
          <div className="mt-16 flex flex-col items-center gap-3 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-gradient-accent text-white shadow-[var(--shadow-glow)]">
              <FolderGit2 className="size-7" />
            </span>
            <h2 className="font-display text-lg font-semibold">{t("home.emptyTitle")}</h2>
            <p className="max-w-sm text-sm text-muted-foreground">{t("home.emptySub")}</p>
          </div>
        ) : null}
      </div>

      {pendingDel ? (
        <ConfirmDialog
          icon={<Trash2 className="size-4.5" />}
          tone="danger"
          title={t("home.unregister")}
          body={t("project.deleteConfirm", { name: pendingDel.name })}
          confirmLabel={t("home.unregister")}
          onConfirm={() => { del.mutate(pendingDel.id); setPendingDel(null); }}
          onCancel={() => setPendingDel(null)}
        />
      ) : null}
    </PageShell>
  );
}

function ProjectRow({
  project: p, live, fmtDate, onOpen, onDelete,
}: {
  project: Project;
  live: RunInfo[];
  fmtDate: (iso: string) => string;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const busy = live.length > 0;
  return (
    <Panel glow={busy} className="group">
      <div className="flex flex-wrap items-center gap-4">
        <span className="relative flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-primary">
          <FolderGit2 className="size-5" />
          {busy ? <StatusDot tone="busy" className="absolute -right-0.5 -top-0.5 ring-2 ring-card" /> : null}
        </span>
        <span className="min-w-0 flex-1 basis-52">
          <span className="block truncate font-display text-base font-semibold">{p.name}</span>
          <span className="block truncate font-mono text-[11px] text-muted-foreground">{p.path}</span>
        </span>

        {/* 메트릭 — 대화 · run · 누적 비용 · 마지막 활동 */}
        <span className="flex shrink-0 items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><MessagesSquare className="size-3.5" />{p.threadCount ?? 0}</span>
          <span className="inline-flex items-center gap-1"><Terminal className="size-3.5" />{p.runCount ?? 0}</span>
          <span className="inline-flex items-center gap-1 font-mono tabular-nums"><CircleDollarSign className="size-3.5" />${(p.costUsd ?? 0).toFixed(2)}</span>
          {p.lastRunAt ? <span className="font-mono text-[10px]">{fmtDate(p.lastRunAt)}</span> : null}
        </span>

        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            aria-label={t("home.unregister")}
            onClick={onDelete}
            className="rounded p-1.5 text-muted-foreground/50 opacity-0 transition hover:text-destructive group-hover:opacity-100"
          >
            <Trash2 className="size-4" />
          </button>
          <Button size="sm" onClick={onOpen}>
            {t("projects.enter")}
            <ArrowRight className="size-3.5" />
          </Button>
        </span>
      </div>

      {/* 지금 도는 작업 — 라이브 */}
      {busy ? (
        <div className="mt-3 space-y-1 border-t border-border/50 pt-2.5">
          {live.map((r) => (
            <div key={r.id} className="flex items-center gap-2 text-xs">
              <StatusDot tone="busy" />
              <span className="shrink-0 font-medium">@{r.agent}</span>
              {r.workflow ? <span className="shrink-0 rounded-full bg-primary/10 px-1.5 text-[10px] text-primary">{r.workflow}</span> : null}
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.prompt.split("\n")[0]}</span>
            </div>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}
