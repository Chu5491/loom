import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation, useMatch } from "react-router-dom";
import { ActivityBar, type ActivityKind } from "./ActivityBar.js";
import { ActivityPanel } from "./ActivityPanel.js";
import { MainSidebar } from "./MainSidebar.js";
import { SearchDialog } from "./SearchDialog.js";
import { TooltipProvider } from "./ui/tooltip.js";

const ACTIVITY_KEY = "loom:layout:activity";
const PANEL_WIDTH_KEY = "loom:layout:activityPanelWidth";

/** Forwarded to nested routes via `<Outlet context>`. 워크스페이스가 자체적으로
 *  포커스 모드 (canvas 접기) 를 관리하므로 따로 전달할 게 없음. */
export interface LayoutOutletContext {
  /* empty — kept for future shared state. */
}

/**
 * 라우트에 따라 사이드바 자체가 바뀜:
 *
 *   /  /projects  /skills  /mcps  →  MainSidebar  (200px, labeled, lobby 톤)
 *   /projects/:id/*                 →  ActivityBar (48px icon rail, IDE 톤)
 *
 * lobby 의 페이지들은 풀 너비로 자기 콘텐츠를 다 그리므로 보조 ActivityPanel 이
 * 따라붙지 않음. project 모드에선 기존처럼 rail + panel 동시.
 *
 * 채팅/캔버스 포커스 모드는 워크스페이스 자체에서 관리 — Layout 은 항상
 * 사이드바 + ActivityPanel 을 변동 없이 보여주고, "채팅 집중" 모드는 워크스페이스
 * 안에서만 칸을 재배분 (canvasCollapsed). ⌘⇧L 핸들링도 WorkspacePage 로 이동.
 */
export function Layout() {
  const projectMatch = useMatch("/projects/:id/*");
  const inProject = !!projectMatch?.params?.id;

  const [activity, setActivity] = useState<ActivityKind>(() => {
    if (typeof window === "undefined") return "projects";
    const raw = window.localStorage.getItem(ACTIVITY_KEY);
    if (raw === "null") return null;
    if (
      raw === "projects" ||
      raw === "files" ||
      raw === "chat" ||
      raw === "dashboard" ||
      raw === "skills" ||
      raw === "mcps" ||
      raw === "history" ||
      raw === "insights" ||
      raw === "git" ||
      raw === "harness" ||
      raw === "schedules" ||
      raw === "settings"
    ) {
      return raw;
    }
    return "projects";
  });
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 260;
    const raw = window.localStorage.getItem(PANEL_WIDTH_KEY);
    const n = raw ? Number(raw) : NaN;
    if (!Number.isFinite(n)) return 260;
    return Math.min(Math.max(n, 200), 480);
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(
        ACTIVITY_KEY,
        activity === null ? "null" : activity,
      );
    } catch {
      // ignore quota / private mode
    }
  }, [activity]);
  useEffect(() => {
    try {
      window.localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth));
    } catch {
      // ignore
    }
  }, [panelWidth]);

  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        const target = e.target as HTMLElement | null;
        if (target?.closest?.(".monaco-editor")) return;
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const location = useLocation();
  useEffect(() => {
    if (!inProject) return;
    const tail = projectMatch?.params["*"] ?? "";
    const kind: ActivityKind =
      tail.startsWith("dashboard") ? "dashboard"
      : tail.startsWith("files") ? "files"
      : tail.startsWith("git") ? "git"
      : tail.startsWith("harness") ? "harness"
      : tail.startsWith("schedules") ? "schedules"
      : tail.startsWith("runs") ? "history"
      : tail.startsWith("agents") ? "agents"
      : tail.startsWith("insights") ? "insights"
      : "chat";
    setActivity(kind);
  }, [inProject, location.pathname, projectMatch?.params]);

  const selectActivity = useCallback((next: ActivityKind) => {
    setActivity(next);
  }, []);

  // lobby 에선 settings 만 패널을 띄움 — 다른 항목은 풀 페이지가 책임.
  // workshop 에선 대부분 패널을 띄우지만 insights 는 풀 페이지 self-contained 이라
  // 사이드 panel 이 비어 보이는 걸 피하려 제외.
  const showActivityPanel =
    activity !== null &&
    activity !== "insights" &&
    (inProject || activity === "settings");

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen overflow-hidden bg-background">
        {inProject ? (
          <ActivityBar active={activity} onSelect={selectActivity} />
        ) : (
          <MainSidebar
            settingsActive={activity === "settings"}
            onSettingsClick={() =>
              selectActivity(activity === "settings" ? null : "settings")
            }
          />
        )}
        {showActivityPanel ? (
          <ActivityPanel
            activity={activity}
            width={panelWidth}
            onResize={setPanelWidth}
            mode={inProject ? "rail" : "lobby"}
            onDismiss={() => selectActivity(null)}
          />
        ) : null}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <Outlet context={{} satisfies LayoutOutletContext} />
        </main>
        <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
      </div>
    </TooltipProvider>
  );
}
