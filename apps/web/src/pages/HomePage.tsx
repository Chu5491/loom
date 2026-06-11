// 홈 = 프로젝트 대시보드. 채팅은 프로젝트에 "들어가서" 한다(depth 흐름).
// 프로젝트 추가는 경로 타이핑이 아니라 폴더 피커로 — 서버가 로컬 디렉토리를 탐색해준다.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ArrowUp, Check, FolderGit2, FolderOpen, House, MessagesSquare, Plus, Trash2, X } from "lucide-react";
import { api } from "../api/client.js";
import { Button } from "../components/ui.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

export function HomePage({ onOpen }: { onOpen: (projectId: string) => void }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
  const [adding, setAdding] = useState(false);
  const del = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["projects"] }),
  });

  const list = projects.data?.projects ?? [];

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">{t("home.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("home.subtitle")}</p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus className="size-4" />
          {t("home.add")}
        </Button>
      </header>

      {adding ? (
        <AddProject
          onDone={(id) => {
            setAdding(false);
            // refetch 완료 후 진입 — 새 프로젝트가 목록에 실리기 전에 열면 가드가 되돌린다.
            void qc.invalidateQueries({ queryKey: ["projects"] }).then(() => {
              if (id) onOpen(id);
            });
          }}
        />
      ) : null}

      {list.length === 0 && !adding ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-gradient-accent text-white shadow-[var(--shadow-glow)]">
            <FolderGit2 className="size-7" />
          </span>
          <h2 className="font-display text-lg font-semibold">{t("home.emptyTitle")}</h2>
          <p className="max-w-sm text-sm text-muted-foreground">{t("home.emptySub")}</p>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onOpen(p.id)}
              className="group relative flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 text-left transition-all hover:border-primary/40 hover:shadow-[var(--shadow-glow-sm)]"
            >
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl border border-border bg-background text-primary">
                  <FolderGit2 className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-base font-semibold">{p.name}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">{p.path}</span>
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <MessagesSquare className="size-3.5" />
                  {t("home.threads", { n: String(p.threadCount ?? 0) })}
                </span>
                {p.lastRunAt ? (
                  <span>{new Date(p.lastRunAt).toLocaleDateString(lang === "ko" ? "ko-KR" : "en-US", { month: "short", day: "numeric" })}</span>
                ) : null}
                <ArrowRight className="ml-auto size-4 opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <span
                role="button"
                aria-label={t("home.unregister")}
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(t("project.deleteConfirm", { name: p.name }))) del.mutate(p.id);
                }}
                className="absolute right-3 top-3 rounded p-1 text-muted-foreground/50 opacity-0 transition hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 className="size-4" />
              </span>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}

// ── 프로젝트 추가 — 폴더 피커 + 이름 ───────────────────────────────────────────
function AddProject({ onDone }: { onDone: (openedId: string | null) => void }) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api.createProject(name.trim(), picked!),
    onSuccess: (r) => onDone(r.project.id),
    onError: (e) => setErr(e instanceof Error ? e.message.replace(/^\d+ [^:]+: /, "") : String(e)),
  });

  return (
    <div className="mt-6 rounded-2xl border border-primary/30 bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold">{t("home.add")}</h2>
        <button type="button" onClick={() => onDone(null)} className="text-muted-foreground hover:text-foreground" aria-label="close">
          <X className="size-4" />
        </button>
      </div>

      {picked === null ? (
        <FolderPicker onPick={(p) => { setPicked(p); setName(p.split("/").pop() ?? ""); }} />
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
            <FolderOpen className="size-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{picked}</span>
            <button type="button" onClick={() => setPicked(null)} className="text-xs text-muted-foreground hover:text-foreground">
              {t("home.repick")}
            </button>
          </div>
          <input
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={name}
            autoFocus
            placeholder={t("project.name")}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && name.trim()) create.mutate(); }}
          />
          {err ? <p className="text-xs text-destructive">{err}</p> : null}
          <div className="flex justify-end">
            <Button size="sm" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? "…" : t("project.addBtn")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// 서버가 탐색해주는 로컬 폴더 브라우저 — 더블클릭 진입 없이 클릭=진입, 상단 줄에서 선택.
function FolderPicker({ onPick }: { onPick: (path: string) => void }) {
  const { t } = useI18n();
  const [path, setPath] = useState<string | undefined>(undefined); // undefined = 홈
  const dirs = useQuery({
    queryKey: ["fs", path ?? "~"],
    queryFn: () => api.listDirs(path),
    placeholderData: (prev) => prev,
  });
  const d = dirs.data;

  return (
    <div className="mt-4">
      {/* 현재 위치 + 선택 */}
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
        <button
          type="button"
          title={t("picker.homeDir")}
          onClick={() => setPath(d?.home)}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <House className="size-4" />
        </button>
        <button
          type="button"
          title={t("picker.up")}
          disabled={!d?.parent}
          onClick={() => d?.parent && setPath(d.parent)}
          className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <ArrowUp className="size-4" />
        </button>
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{d?.path ?? "…"}</span>
        <Button size="sm" disabled={!d} onClick={() => d && onPick(d.path)}>
          <Check className="size-3.5" />
          {t("picker.select")}
        </Button>
      </div>

      {/* 하위 폴더 */}
      <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-border">
        {(d?.dirs ?? []).map((dir) => (
          <button
            key={dir.path}
            type="button"
            onClick={() => setPath(dir.path)}
            className="flex w-full items-center gap-2 border-b border-border/50 px-3 py-2 text-left text-sm transition-colors last:border-0 hover:bg-muted/60"
          >
            <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{dir.name}</span>
            <ArrowRight className="ml-auto size-3.5 shrink-0 text-muted-foreground/50" />
          </button>
        ))}
        {d && d.dirs.length === 0 ? (
          <p className={cn("px-3 py-4 text-center text-xs text-muted-foreground")}>{t("picker.empty")}</p>
        ) : null}
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{t("picker.hint")}</p>
    </div>
  );
}
