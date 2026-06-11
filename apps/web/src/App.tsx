// v2 셸 — 글래스 헤더(브랜드 + 탭 + 테마/언어) + 활성 화면.
// IA: 홈 = 프로젝트 대시보드 → 프로젝트에 "들어가면" 대화(depth 흐름).
// 오피스(팀 정의)·연결(CLI)은 전역이라 어디서든 탭으로.

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, FolderGit2, House, Languages, Moon, Plug, RefreshCw, Sun, FolderCog } from "lucide-react";
import { api } from "./api/client.js";
import { CliStatus } from "./components/CliStatus.js";
import { LoomLogo } from "./components/LoomLogo.js";
import { Button } from "./components/ui.js";
import { useI18n } from "./context/I18nContext.js";
import { useTheme } from "./context/ThemeContext.js";
import { cn } from "./lib/utils.js";
import { ConnectionsPage } from "./pages/ConnectionsPage.js";
import { HomePage } from "./pages/HomePage.js";
import { OfficePage } from "./pages/OfficePage.js";
import { TalkPage } from "./pages/TalkPage.js";

type Tab = "home" | "office" | "connections";

export function App() {
  const { t, lang, setLang } = useI18n();
  const { effective, setMode } = useTheme();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("home");
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
    { key: "office", label: t("nav.office"), icon: <FolderCog className="size-4" /> },
    { key: "connections", label: t("nav.connections"), icon: <Plug className="size-4" /> },
  ];

  return (
    <div className="min-h-full bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-card/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <LoomLogo className="size-6 dark:invert" />
          <span className="font-display text-base font-semibold">{t("app.title")}</span>

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

          {/* 프로젝트 안일 때 — 현재 위치 칩(← 누르면 대시보드로) */}
          {project && tab === "home" ? (
            <button
              type="button"
              onClick={() => setProject(null)}
              title={t("nav.backHome")}
              className="flex min-w-0 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 py-1 pl-1.5 pr-3 text-sm transition-colors hover:bg-primary/15"
            >
              <ChevronLeft className="size-4 shrink-0 text-primary" />
              <FolderGit2 className="size-3.5 shrink-0 text-primary" />
              <span className="max-w-44 truncate font-medium">{project.name}</span>
            </button>
          ) : null}

          <div className="ml-auto flex items-center gap-2">
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

      {tab === "office" ? (
        <OfficePage />
      ) : tab === "connections" ? (
        <ConnectionsPage />
      ) : project ? (
        <TalkPage projectId={project.id} />
      ) : (
        <HomePage onOpen={setProject} />
      )}
    </div>
  );
}
