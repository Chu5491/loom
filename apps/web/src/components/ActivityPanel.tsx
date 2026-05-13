// 사이드 활동 패널 라우터. 선택된 activity에 따라 ./activity/*Tab 컴포넌트로 분기.
// 각 패널 본체는 components/activity/ 디렉토리에 분리됨.
//
// 반응형:
//   - 넓은 뷰포트 (≥ lg = 1024px) → 일반 column. flex flow 안에서 자리 잡음.
//   - 좁은 뷰포트 (< lg) → ActivityBar 옆에 floating overlay (drawer 풍).
//     본문은 안 밀리고 panel 만 위에 떠서 좁은 화면 공간 효율 ↑. 백드롭 클릭
//     으로 닫음.

import type { ActivityKind } from "./ActivityBar.js";
import { cn } from "../lib/utils.js";
import { ChatTab } from "./activity/ChatTab.js";
import { DashboardTab } from "./activity/DashboardTab.js";
import { ProjectsTab } from "./activity/ProjectsTab.js";
import { FilesTab } from "./activity/FilesTab.js";
import { SkillsTab } from "./activity/SkillsTab.js";
import { McpsTab } from "./activity/McpsTab.js";
import { HistoryTab } from "./activity/HistoryTab.js";
import { GitTab } from "./activity/GitTab.js";
import { SettingsTab } from "./activity/SettingsTab.js";

const PANEL_MIN_WIDTH = 200;
const PANEL_MAX_WIDTH = 480;

export function ActivityPanel({
  activity,
  width,
  onResize,
  onDismiss,
  /** ActivityBar (48px) 옆이면 "rail", MainSidebar (200px) 옆이면 "lobby". */
  mode,
}: {
  activity: ActivityKind;
  width: number;
  onResize: (next: number) => void;
  /** 좁은 뷰포트에서 backdrop 클릭으로 panel 닫기. */
  onDismiss: () => void;
  mode: "rail" | "lobby";
}) {
  if (activity === null) return null;

  return (
    <>
      {/* 좁은 뷰포트 backdrop — md 이상 lg 미만에서만. md 미만은 panel 자체가
          숨겨지고, lg 이상은 flex flow 라 backdrop 불필요. */}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Close panel"
        className="hidden md:block lg:hidden fixed inset-0 z-20 bg-foreground/30 backdrop-blur-[1px]"
      />
      <aside
        className={cn(
          "hidden md:flex shrink-0 flex-col border-r border-border bg-card",
          // wide: flex flow 안의 column. narrow: 좌측 sidebar 옆에 floating.
          "relative max-lg:fixed max-lg:inset-y-0 max-lg:z-30 max-lg:shadow-2xl",
          mode === "rail"
            ? "max-lg:left-12" // 48px
            : "max-lg:left-[200px]", // MAIN_SIDEBAR_WIDTH
        )}
        style={{ width }}
      >
        <ActivityContent activity={activity} />
        <PanelResizer width={width} onChange={onResize} />
      </aside>
    </>
  );
}

function ActivityContent({ activity }: { activity: ActivityKind }) {
  switch (activity) {
    case "chat":
      return <ChatTab />;
    case "dashboard":
      return <DashboardTab />;
    case "projects":
      return <ProjectsTab />;
    case "files":
      return <FilesTab />;
    case "skills":
      return <SkillsTab />;
    case "mcps":
      return <McpsTab />;
    case "history":
      return <HistoryTab />;
    case "git":
      return <GitTab />;
    case "settings":
      return <SettingsTab />;
    default:
      return null;
  }
}

// 패널 우측 가장자리 드래그 핸들. 부모(Layout) state에 width 보고.
// 단순 사이드바 1개라 react-resizable-panels(PanelGroup) 도입은 과한 변경 — 현 구조 유지.
function PanelResizer({
  width,
  onChange,
}: {
  width: number;
  onChange: (next: number) => void;
}) {
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const next = Math.min(
        PANEL_MAX_WIDTH,
        Math.max(PANEL_MIN_WIDTH, startWidth + dx),
      );
      onChange(next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onMouseDown={onMouseDown}
      className="absolute right-0 top-0 bottom-0 z-10 w-2 -mr-1 cursor-col-resize group"
    >
      <span
        aria-hidden
        className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-px bg-transparent group-hover:bg-foreground/30 transition-colors"
      />
    </div>
  );
}
