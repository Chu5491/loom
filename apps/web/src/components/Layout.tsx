import { useCallback, useEffect, useState } from "react";
import { Outlet, useMatch } from "react-router-dom";
import { ActivityBar, type ActivityKind } from "./ActivityBar.js";
import { ActivityPanel } from "./ActivityPanel.js";
import { MainSidebar } from "./MainSidebar.js";
import { TooltipProvider } from "./ui/tooltip.js";

const ACTIVITY_KEY = "loom:layout:activity";
const PANEL_WIDTH_KEY = "loom:layout:activityPanelWidth";
const CHAT_FULL_MODAL_KEY = "loom:layout:chatFullModal";

/** Forwarded to nested routes via `<Outlet context>`. The workspace
 *  uses `chatFullModal` to know when to hide its own panels. */
export interface LayoutOutletContext {
  chatFullModal: boolean;
  setChatFullModal: (next: boolean) => void;
}

/**
 * 라우트에 따라 사이드바 자체가 바뀜:
 *
 *   /  /projects  /skills  /mcps  →  MainSidebar  (200px, labeled, lobby 톤)
 *   /projects/:id/*                 →  ActivityBar (48px icon rail, IDE 톤)
 *
 * lobby 의 페이지들은 풀 너비로 자기 콘텐츠를 다 그리므로 보조 ActivityPanel 이
 * 따라붙지 않음. project 모드에선 기존처럼 rail + panel 동시.
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
      raw === "agents" ||
      raw === "skills" ||
      raw === "mcps" ||
      raw === "history" ||
      raw === "insights" ||
      raw === "git" ||
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

  // ⌘⇧L flips the chat to a full-screen takeover. Activity panel +
  // file viewer collapse; the bar stays so the user can switch out.
  const [chatFullModal, setChatFullModalState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(CHAT_FULL_MODAL_KEY) === "1";
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
  useEffect(() => {
    try {
      window.localStorage.setItem(
        CHAT_FULL_MODAL_KEY,
        chatFullModal ? "1" : "0",
      );
    } catch {
      // ignore
    }
  }, [chatFullModal]);

  const selectActivity = useCallback((next: ActivityKind) => {
    setActivity(next);
  }, []);

  const setChatFullModal = useCallback((next: boolean) => {
    setChatFullModalState(next);
  }, []);
  // ⌘⇧L toggles full-modal. Skipped while an editable is focused so
  // the shortcut doesn't fire mid-typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "l"
      ) {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable)
        ) {
          return;
        }
        e.preventDefault();
        setChatFullModalState((v) => !v);
      } else if (e.key === "Escape" && chatFullModal) {
        e.preventDefault();
        setChatFullModalState(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatFullModal]);

  // lobby 에선 settings 만 패널을 띄움 — 다른 항목은 풀 페이지가 책임.
  // workshop 에선 대부분 패널을 띄우지만 insights 는 풀 페이지 self-contained 이라
  // 사이드 panel 이 비어 보이는 걸 피하려 제외.
  const showActivityPanel =
    !chatFullModal &&
    activity !== null &&
    activity !== "insights" &&
    (inProject || activity === "settings");

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen overflow-hidden bg-background">
        {inProject ? (
          <ActivityBar
            active={activity}
            onSelect={(next) => {
              if (chatFullModal) setChatFullModalState(false);
              selectActivity(next);
            }}
          />
        ) : (
          <MainSidebar
            settingsActive={activity === "settings"}
            onSettingsClick={() => {
              if (chatFullModal) setChatFullModalState(false);
              selectActivity(activity === "settings" ? null : "settings");
            }}
          />
        )}
        {showActivityPanel ? (
          <ActivityPanel
            activity={activity}
            width={panelWidth}
            onResize={setPanelWidth}
          />
        ) : null}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <Outlet
            context={
              { chatFullModal, setChatFullModal } satisfies LayoutOutletContext
            }
          />
        </main>
      </div>
    </TooltipProvider>
  );
}
