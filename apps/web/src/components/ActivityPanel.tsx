// 사이드 활동 패널 라우터. 선택된 activity에 따라 ./activity/*Tab 컴포넌트로 분기.
// 각 패널 본체는 components/activity/ 디렉토리에 분리됨.

import type { ActivityKind } from "./ActivityBar.js";
import { ProjectsTab } from "./activity/ProjectsTab.js";
import { FilesTab } from "./activity/FilesTab.js";
import { AgentsTab } from "./activity/AgentsTab.js";
import { SkillsTab } from "./activity/SkillsTab.js";
import { McpsTab } from "./activity/McpsTab.js";
import { ReviewTab } from "./activity/ReviewTab.js";
import { HistoryTab } from "./activity/HistoryTab.js";
import { GitTab } from "./activity/GitTab.js";
import { SettingsTab } from "./activity/SettingsTab.js";

const PANEL_MIN_WIDTH = 200;
const PANEL_MAX_WIDTH = 480;

export function ActivityPanel({
  activity,
  width,
  onResize,
}: {
  activity: ActivityKind;
  width: number;
  onResize: (next: number) => void;
}) {
  if (activity === null) return null;

  return (
    <aside
      className="hidden md:flex shrink-0 flex-col border-r border-border bg-card relative"
      style={{ width }}
    >
      <ActivityContent activity={activity} />
      <PanelResizer width={width} onChange={onResize} />
    </aside>
  );
}

function ActivityContent({ activity }: { activity: ActivityKind }) {
  switch (activity) {
    case "projects":
      return <ProjectsTab />;
    case "files":
      return <FilesTab />;
    case "agents":
      return <AgentsTab />;
    case "skills":
      return <SkillsTab />;
    case "mcps":
      return <McpsTab />;
    case "review":
      return <ReviewTab />;
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
