// 헤더 프로젝트 셀렉터 — run/스레드가 돌 작업 디렉토리 선택.
// null = 오피스 홈(프로젝트 없음). 등록/삭제도 여기서.

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, FolderGit2, House, Plus, Trash2 } from "lucide-react";
import { api } from "../api/client.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

export function ProjectSelector({ activeId, onChange }: { activeId: string | null; onChange: (id: string | null) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const projects = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
  const list = projects.data?.projects ?? [];
  const active = list.find((p) => p.id === activeId);

  const create = useMutation({
    mutationFn: () => api.createProject(name.trim(), path.trim()),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      onChange(r.project.id);
      setAdding(false); setName(""); setPath(""); setErr(null);
    },
    onError: (e) => setErr(e instanceof Error ? e.message.replace(/^\d+ [^:]+: /, "") : String(e)),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: (_r, id) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      if (activeId === id) onChange(null);
    },
  });

  // 바깥 클릭 닫기.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md border border-border bg-card/60 px-2.5 py-1.5 text-sm transition-colors hover:bg-muted/60"
      >
        {active ? <FolderGit2 className="size-3.5 text-primary" /> : <House className="size-3.5 text-muted-foreground" />}
        <span className="max-w-40 truncate">{active ? active.name : t("project.home")}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </button>

      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-72 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
          <Row icon={<House className="size-4" />} label={t("project.home")} active={!activeId} onClick={() => { onChange(null); setOpen(false); }} />
          {list.map((p) => (
            <Row
              key={p.id}
              icon={<FolderGit2 className="size-4 text-primary" />}
              label={p.name}
              sub={p.path}
              active={p.id === activeId}
              onClick={() => { onChange(p.id); setOpen(false); }}
              onDelete={() => confirm(t("project.deleteConfirm", { name: p.name })) && del.mutate(p.id)}
            />
          ))}

          <div className="border-t border-border p-2">
            {adding ? (
              <div className="space-y-1.5">
                <input className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder={t("project.name")} value={name} autoFocus onChange={(e) => setName(e.target.value)} />
                <input className="w-full rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring" placeholder={t("project.path")} value={path} onChange={(e) => setPath(e.target.value)} />
                {err ? <p className="text-[11px] text-destructive">{err}</p> : null}
                <div className="flex gap-1.5">
                  <button type="button" disabled={!name.trim() || !path.trim() || create.isPending} onClick={() => create.mutate()} className="flex-1 rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
                    {create.isPending ? "…" : t("project.addBtn")}
                  </button>
                  <button type="button" onClick={() => { setAdding(false); setErr(null); }} className="rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground">×</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setAdding(true)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground">
                <Plus className="size-4" />
                {t("project.add")}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Row({ icon, label, sub, active, onClick, onDelete }: { icon: React.ReactNode; label: string; sub?: string; active: boolean; onClick: () => void; onDelete?: () => void }) {
  return (
    <div className={cn("group flex items-center gap-2 px-3 py-2 transition-colors hover:bg-muted/60", active && "bg-primary/10")}>
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{label}</span>
          {sub ? <span className="block truncate font-mono text-[11px] text-muted-foreground">{sub}</span> : null}
        </span>
        {active ? <Check className="size-3.5 shrink-0 text-primary" /> : null}
      </button>
      {onDelete ? (
        <button type="button" onClick={onDelete} className="shrink-0 text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100" aria-label="delete">
          <Trash2 className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
