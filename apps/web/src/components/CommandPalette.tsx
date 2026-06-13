// ⌘K 커맨드 팔레트 — 이동(탭·프로젝트)과 프로젝트 안 액션(뷰·대화·워크플로우·
// 에이전트 타겟)을 한 검색창에서. 의존성 없이 자체 구현(cmdk 미도입 — 번들 절약).
// 프로젝트 안 액션은 window CustomEvent("loom:cmd") 로 TalkPage 에 전달.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bot, CalendarClock, CirclePlay, FileText, FolderGit2, GitBranch, History, House,
  MessagesSquare, Plug, ScanSearch, Search, FolderCog,
} from "lucide-react";
import type { Project } from "@loom/core";
import { api } from "../api/client.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

/** TalkPage 가 구독하는 프로젝트 내부 명령. */
export interface LoomCmd {
  view?: "talk" | "files" | "git" | "analysis" | "schedules";
  threadId?: string;
  workflow?: string;
  agent?: string;
}
export function sendLoomCmd(cmd: LoomCmd): void {
  window.dispatchEvent(new CustomEvent<LoomCmd>("loom:cmd", { detail: cmd }));
}

interface Item {
  key: string;
  section: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
  /** 서버 검색 결과 — 클라이언트 재필터를 우회(이미 q 로 매칭됨). */
  keep?: boolean;
}

export function CommandPalette({
  open, onClose, project, projects, onTab, onProject,
}: {
  open: boolean;
  onClose: () => void;
  project: Project | null;
  projects: Project[];
  onTab: (tab: "home" | "office" | "connections") => void;
  onProject: (id: string | null) => void;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // 디바운스된 전문 검색어 — 입력 멈추면 서버에 과거 run 본문 검색을 던진다.
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 220);
    return () => clearTimeout(id);
  }, [q]);
  const search = useQuery({
    queryKey: ["runSearch", debounced],
    queryFn: () => api.searchRuns(debounced),
    enabled: open && debounced.length >= 2,
  });

  const office = useQuery({ queryKey: ["office"], queryFn: api.getOffice, enabled: open });
  const threads = useQuery({
    queryKey: ["threads", project?.id ?? null],
    queryFn: () => api.listThreads(project!.id),
    enabled: open && !!project,
  });

  useEffect(() => {
    if (open) { setQ(""); setSel(0); }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    if (!open) return [];
    const out: Item[] = [];
    const done = (fn: () => void) => () => { fn(); onClose(); };

    // 이동
    out.push(
      { key: "nav-home", section: t("cmdk.nav"), label: t("nav.company"), icon: <House className="size-4" />, run: done(() => { onProject(null); onTab("home"); }) },
      { key: "nav-office", section: t("cmdk.nav"), label: t("nav.office"), icon: <FolderCog className="size-4" />, run: done(() => onTab("office")) },
      { key: "nav-conn", section: t("cmdk.nav"), label: t("nav.connections"), icon: <Plug className="size-4" />, run: done(() => onTab("connections")) },
    );

    // 프로젝트 안 — 뷰·대화·워크플로우 실행·에이전트 타겟
    if (project) {
      const views: { v: LoomCmd["view"] & string; label: string; icon: React.ReactNode }[] = [
        { v: "talk", label: t("ws.talk"), icon: <MessagesSquare className="size-4" /> },
        { v: "files", label: t("ws.files"), icon: <FileText className="size-4" /> },
        { v: "git", label: t("ws.git"), icon: <GitBranch className="size-4" /> },
        { v: "analysis", label: t("ws.analysis"), icon: <ScanSearch className="size-4" /> },
        { v: "schedules", label: t("ws.schedules"), icon: <CalendarClock className="size-4" /> },
      ];
      for (const { v, label, icon } of views) {
        out.push({ key: `view-${v}`, section: t("cmdk.views"), label, hint: project.name, icon, run: done(() => sendLoomCmd({ view: v })) });
      }
      for (const th of threads.data?.threads ?? []) {
        out.push({ key: `thread-${th.id}`, section: t("cmdk.threads"), label: th.name, icon: <MessagesSquare className="size-4" />, run: done(() => sendLoomCmd({ view: "talk", threadId: th.id })) });
      }
      for (const w of office.data?.office.workflows ?? []) {
        out.push({ key: `wf-${w.name}`, section: t("cmdk.workflows"), label: w.name, hint: t("talk.workflow.run"), icon: <CirclePlay className="size-4" />, run: done(() => sendLoomCmd({ workflow: w.name })) });
      }
      for (const a of office.data?.office.agents ?? []) {
        out.push({ key: `agent-${a.name}`, section: t("cmdk.agents"), label: `@${a.name}`, hint: a.adapter, icon: <Bot className="size-4" />, run: done(() => sendLoomCmd({ view: "talk", agent: a.name })) });
      }
    }

    // 프로젝트 — 들어가기
    for (const p of projects) {
      if (p.id === project?.id) continue;
      out.push({ key: `proj-${p.id}`, section: t("cmdk.projects"), label: p.name, hint: p.path, icon: <FolderGit2 className="size-4" />, run: done(() => onProject(p.id)) });
    }

    // 전문 검색 결과 — 과거 run 의 prompt·결과 텍스트 매치. 클릭 시 그 대화로 이동.
    for (const hit of search.data?.hits ?? []) {
      const r = hit.run;
      const goto = () => {
        if (r.projectId && r.projectId !== project?.id) {
          onProject(r.projectId);
          if (r.threadId) setTimeout(() => sendLoomCmd({ view: "talk", threadId: r.threadId! }), 60);
        } else if (r.threadId) {
          sendLoomCmd({ view: "talk", threadId: r.threadId });
        }
      };
      out.push({
        key: `search-${r.id}`,
        section: t("cmdk.search"),
        label: hit.snippet || r.prompt.split("\n")[0]!,
        hint: `@${r.agent} · ${r.startedAt.slice(0, 10)}`,
        icon: <History className="size-4" />,
        run: done(goto),
        keep: true,
      });
    }
    return out;
  }, [open, project, projects, office.data, threads.data, search.data, t, onClose, onProject, onTab]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((i) => i.keep || `${i.label} ${i.hint ?? ""} ${i.section}`.toLowerCase().includes(needle));
  }, [items, q]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/60 pt-[18vh] backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl shadow-black/20">
        <div className="flex items-center gap-2 border-b border-border/60 px-3.5 py-2.5">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            placeholder={t("cmdk.placeholder")}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              if (e.key === "Enter") filtered[sel]?.run();
            }}
            className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">esc</kbd>
        </div>
        <div ref={listRef} className="max-h-80 overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t("cmdk.empty")}</p>
          ) : (
            filtered.map((item, i) => {
              const head = i === 0 || filtered[i - 1]!.section !== item.section;
              return (
                <div key={item.key}>
                  {head ? (
                    <p className="px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{item.section}</p>
                  ) : null}
                  <button
                    type="button"
                    data-i={i}
                    onClick={item.run}
                    onMouseEnter={() => setSel(i)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                      i === sel ? "bg-primary/15 text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <span className="shrink-0 text-primary">{item.icon}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                    {item.hint ? <span className="max-w-40 truncate text-[10px] text-muted-foreground">{item.hint}</span> : null}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
