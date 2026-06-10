// v2 셸 — 글래스 헤더(브랜드 + 탭 + 테마/언어) + 활성 화면.
// 화면 둘: Connections(CLI 발견·연결), Office(규약·스킬·MCP·에이전트 정의).

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Languages, MessagesSquare, Moon, Plug, RefreshCw, Sun, FolderCog } from "lucide-react";
import { CliStatus } from "./components/CliStatus.js";
import { LoomLogo } from "./components/LoomLogo.js";
import { ProjectSelector } from "./components/ProjectSelector.js";
import { Button } from "./components/ui.js";
import { useI18n } from "./context/I18nContext.js";
import { useTheme } from "./context/ThemeContext.js";
import { cn } from "./lib/utils.js";
import { ConnectionsPage } from "./pages/ConnectionsPage.js";
import { OfficePage } from "./pages/OfficePage.js";
import { TalkPage } from "./pages/TalkPage.js";

type Tab = "talk" | "office" | "connections";

export function App() {
  const { t, lang, setLang } = useI18n();
  const { effective, setMode } = useTheme();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("talk");
  const [projectId, setProjectId] = useState<string | null>(() => localStorage.getItem("loom.project") || null);
  const setProject = (id: string | null) => {
    setProjectId(id);
    if (id) localStorage.setItem("loom.project", id);
    else localStorage.removeItem("loom.project");
  };

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "talk", label: t("nav.talk"), icon: <MessagesSquare className="size-4" /> },
    { key: "office", label: t("nav.office"), icon: <FolderCog className="size-4" /> },
    { key: "connections", label: t("nav.connections"), icon: <Plug className="size-4" /> },
  ];

  return (
    <div className="min-h-full bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-card/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
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

          <div className="ml-auto flex items-center gap-2">
            <CliStatus onOpenConnections={() => setTab("connections")} />
            <ProjectSelector activeId={projectId} onChange={setProject} />
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

      {tab === "talk" ? <TalkPage projectId={projectId} /> : tab === "office" ? <OfficePage /> : <ConnectionsPage />}
    </div>
  );
}
