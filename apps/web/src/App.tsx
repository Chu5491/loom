// v2 셸 — 글래스 헤더(브랜드 + 탭 + 테마/언어) + 활성 화면.
// IA: 홈 = 프로젝트 대시보드 → 프로젝트에 "들어가면" 대화(depth 흐름).
// 오피스(팀 정의)·연결(CLI)은 전역이라 어디서든 탭으로.

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronLeft, FolderGit2, House, Languages, Moon, Plug, RefreshCw, Sun, FolderCog } from "lucide-react";
import { api } from "./api/client.js";
import { CliStatus } from "./components/CliStatus.js";
import { CommandPalette } from "./components/CommandPalette.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { LoomLogo } from "./components/LoomLogo.js";
import { Button } from "./components/ui.js";
import { useI18n } from "./context/I18nContext.js";
import { useTheme } from "./context/ThemeContext.js";
import { cn } from "./lib/utils.js";
import { ConnectionsPage } from "./pages/ConnectionsPage.js";
import { HomePage } from "./pages/HomePage.js";
import { OfficePage } from "./pages/OfficePage.js";
import { ProjectsPage } from "./pages/ProjectsPage.js";
import { TalkPage } from "./pages/TalkPage.js";

type Tab = "home" | "projects" | "office" | "connections";

export function App() {
  const { t, lang, setLang } = useI18n();
  const { effective, setMode } = useTheme();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("home");
  // 헤더 프로젝트 칩 → 프로젝트 전환 메뉴(미션 컨트롤).
  const [switcherOpen, setSwitcherOpen] = useState(false);
  // 전환 확인 모달 — 드롭다운에서 다른 프로젝트를 고르면 여기 담고 묻는다.
  const [pendingSwitch, setPendingSwitch] = useState<{ id: string; name: string } | null>(null);
  const switcherRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!switcherOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!switcherRef.current?.contains(e.target as Node)) setSwitcherOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSwitcherOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [switcherOpen]);
  // ⌘K / Ctrl+K — 커맨드 팔레트.
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const [projectId, setProjectId] = useState<string | null>(() => localStorage.getItem("loom.project") || null);
  const setProject = (id: string | null) => {
    setProjectId(id);
    if (id) {
      localStorage.setItem("loom.project", id);
      setTab("home"); // 프로젝트 진입은 항상 홈 탭(대화)에서
    } else {
      localStorage.removeItem("loom.project");
    }
  };

  const projects = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
  const project = projects.data?.projects.find((p) => p.id === projectId) ?? null;
  // 등록 해제된 프로젝트가 localStorage 에 남아있으면 홈으로.
  // refetch 중엔 판단 보류 — 막 등록한 프로젝트가 옛 캐시에 없다고 되돌리는 레이스 방지.
  useEffect(() => {
    if (projects.isFetching || !projects.data) return;
    if (projectId && !projects.data.projects.some((p) => p.id === projectId)) {
      setProject(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.data, projects.isFetching, projectId]);

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "home", label: t("nav.home"), icon: <House className="size-4" /> },
    { key: "projects", label: t("nav.projects"), icon: <FolderGit2 className="size-4" /> },
    { key: "office", label: t("nav.office"), icon: <FolderCog className="size-4" /> },
    { key: "connections", label: t("nav.connections"), icon: <Plug className="size-4" /> },
  ];

  return (
    <div className="min-h-full bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-card/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <LoomLogo className="size-6 dark:invert" />
          <span className="font-display text-base font-semibold">{t("app.title")}</span>

          {/* 프로젝트 안 = 일터 — 회사 탭 대신 "회사 / 프로젝트" 브레드크럼. */}
          {project && tab === "home" ? (
            <div className="ml-3 flex min-w-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setProject(null)}
                className="rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-all hover:bg-muted/70 hover:text-foreground"
              >
                {t("nav.company")}
              </button>
              <span className="select-none text-muted-foreground/40">/</span>
            </div>
          ) : (
            <nav className="ml-3 flex items-center gap-1">
              {tabs.map((tb) => (
                <button
                  key={tb.key}
                  type="button"
                  onClick={() => setTab(tb.key)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-all",
                    tab === tb.key
                      ? "bg-primary/15 text-foreground shadow-[var(--shadow-glow-sm)]"
                      : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                  )}
                >
                  {tb.icon}
                  {tb.label}
                </button>
              ))}
            </nav>
          )}

          {/* 프로젝트 안일 때 — 현재 위치 칩(누르면 프로젝트 전환 메뉴) */}
          {project && tab === "home" ? (
            <div ref={switcherRef} className="relative">
              <button
                type="button"
                onClick={() => setSwitcherOpen((o) => !o)}
                title={t("nav.missionControl")}
                className="flex min-w-0 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 py-1 pl-2.5 pr-3 text-sm shadow-[var(--shadow-glow-sm)] transition-colors hover:bg-primary/15"
              >
                <FolderGit2 className="size-3.5 shrink-0 text-primary" />
                <span className="max-w-44 truncate font-medium">{project.name}</span>
                <ChevronDown className={cn("size-3.5 shrink-0 text-primary transition-transform", switcherOpen && "rotate-180")} />
              </button>
              {switcherOpen ? (
                <div className="absolute left-0 top-full z-30 mt-1.5 w-72 rounded-xl border border-border bg-card p-1.5 shadow-lg">
                  <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("nav.projects")}</p>
                  {(projects.data?.projects ?? []).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setSwitcherOpen(false);
                        if (p.id !== project.id) setPendingSwitch({ id: p.id, name: p.name });
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                        p.id === project.id ? "bg-primary/10" : "hover:bg-muted/60",
                      )}
                    >
                      <FolderGit2 className="size-3.5 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{p.name}</span>
                        <span className="block truncate font-mono text-[10px] text-muted-foreground">{p.path}</span>
                      </span>
                      {p.id === project.id ? <Check className="size-3.5 shrink-0 text-primary" /> : null}
                    </button>
                  ))}
                  <div className="mt-1 border-t border-border/60 pt-1">
                    <button
                      type="button"
                      onClick={() => { setSwitcherOpen(false); setProject(null); }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                    >
                      <ChevronLeft className="size-3.5 shrink-0" />
                      {t("nav.backHome")}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              title={t("cmdk.placeholder")}
              className="hidden items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground sm:flex"
            >
              <span>{t("cmdk.button")}</span>
              <kbd className="rounded border border-border px-1 font-mono text-[10px]">⌘K</kbd>
            </button>
            <CliStatus onOpenConnections={() => setTab("connections")} />
            <Button variant="ghost" size="sm" aria-label="theme"
              onClick={() => setMode(effective === "dark" ? "light" : "dark")}>
              {effective === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
            <Button variant="ghost" size="sm" aria-label="language"
              onClick={() => setLang(lang === "ko" ? "en" : "ko")}>
              <Languages className="size-4" />
              <span className="text-xs uppercase">{lang}</span>
            </Button>
            <Button variant="secondary" size="sm" onClick={() => qc.invalidateQueries()}>
              <RefreshCw className="size-3.5" />
              {t("conn.refreshAll")}
            </Button>
          </div>
        </div>
      </header>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        project={project}
        projects={projects.data?.projects ?? []}
        onTab={setTab}
        onProject={setProject}
      />

      {/* 프로젝트 전환 확인 모달 */}
      {pendingSwitch ? (
        <ConfirmDialog
          icon={<FolderGit2 className="size-4.5" />}
          title={t("nav.switchTitle")}
          body={t("nav.switchConfirm", { name: pendingSwitch.name })}
          confirmLabel={t("nav.switchGo")}
          onConfirm={() => { setProject(pendingSwitch.id); setPendingSwitch(null); }}
          onCancel={() => setPendingSwitch(null)}
        />
      ) : null}

      <ErrorBoundary label={t("err.page")} retryLabel={t("err.retry")}>
        {tab === "office" ? (
          <OfficePage />
        ) : tab === "connections" ? (
          <ConnectionsPage />
        ) : tab === "projects" ? (
          <ProjectsPage onOpen={setProject} />
        ) : project ? (
          <TalkPage project={project} />
        ) : (
          <HomePage onOpen={setProject} onOpenTab={(tb) => setTab(tb)} />
        )}
      </ErrorBoundary>
    </div>
  );
}
