// 에디터가 메인 캔버스인 새 레이아웃에서의 파일 탭 스트립.
// 채팅은 floating overlay로 분리됐으므로 가짜 Chat 탭은 제거됨.
// 활성 에이전트 라이브 배지 + 라인 번호 + 닫기. auto-animate로 추가/삭제 모핑.

import { Activity, Code2, FileText, PanelRightClose, X } from "lucide-react";
import type { Agent } from "@loom/core";
import { AgentInitialBadge } from "../../components/AgentInitialBadge.js";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";
import { basename } from "../../lib/path.js";
import { useAutoAnimate } from "../../lib/useAutoAnimate.js";

export function FileTabBar({
  view,
  activeFile,
  openFiles,
  activeByPath,
  lineByPath,
  agents,
  onActivate,
  onClose,
  onCloseAll,
  onSelectOffice,
  onSelectEditor,
  onCollapseCanvas,
}: {
  /** "office"이면 Office 가짜 탭이 활성 — 어떤 파일 탭도 active 안 됨. */
  view: "office" | "editor";
  activeFile: string | null;
  openFiles: string[];
  activeByPath?: Map<string, string>;
  lineByPath?: Map<string, number>;
  agents?: Agent[];
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onCloseAll: () => void;
  /** Office 모드로 전환 — 활성 파일은 보존. */
  onSelectOffice: () => void;
  /** Editor 모드로 복귀 — 마지막 활성 파일이 있으면 그걸 보여줌. 없으면 EditorEmpty. */
  onSelectEditor: () => void;
  /** 캔버스 통째로 접기 — 시니어가 채팅 메인으로 쓸 때. 미정의면 버튼 숨김. */
  onCollapseCanvas?: () => void;
}) {
  const { t } = useI18n();
  const stripRef = useAutoAnimate<HTMLDivElement>({
    duration: 180,
    easing: "ease-out",
  });

  return (
    <div className="flex items-stretch border-b border-border bg-muted/30 shrink-0">
      {/* 좌측: 뷰 모드 버튼 — 사무실/에디터는 "파일이 아니라 모드". 시각적으로
          분리해서 탭 strip과 섞이지 않도록 별도 섹션 + vertical divider.
          두 버튼은 segmented control 처럼 붙어서 어떤 모드인지 한 눈에. */}
      <div className="flex items-stretch shrink-0 px-1.5 py-1 gap-0.5 border-r border-border">
        <ViewModeButton
          active={view === "office"}
          icon={<Activity className="size-3.5" />}
          label={t("workspace.tabs.live")}
          title={t("workspace.tabs.liveTitle")}
          onClick={onSelectOffice}
        />
        <ViewModeButton
          active={view === "editor"}
          icon={<Code2 className="size-3.5" />}
          label={t("workspace.tabs.editor")}
          title={t("workspace.tabs.editorTitle")}
          onClick={onSelectEditor}
        />
      </div>

      <div
        ref={stripRef}
        className="flex-1 min-w-0 flex items-stretch gap-px px-1 overflow-hidden"
      >
        {openFiles.length === 0 ? (
          <span className="self-center px-3 text-[11px] text-muted-foreground/50 italic">
            {t("workspace.tabs.noFiles")}
          </span>
        ) : null}
        {openFiles.map((path) => {
          const liveAgentId = activeByPath?.get(path);
          const liveAgent = liveAgentId
            ? agents?.find((a) => a.id === liveAgentId)
            : undefined;
          const liveLine = lineByPath?.get(path);
          return (
            <Tab
              key={path}
              active={view === "editor" && activeFile === path}
              icon={<FileText className="size-3.5" />}
              label={basename(path)}
              title={path}
              liveAgent={liveAgent}
              liveLine={liveLine}
              onActivate={() => onActivate(path)}
              onClose={() => onClose(path)}
            />
          );
        })}
      </div>
      {openFiles.length > 0 ? (
        <button
          type="button"
          onClick={onCloseAll}
          title={t("workspace.tabs.closeAll")}
          aria-label={t("workspace.tabs.closeAll")}
          className="inline-flex items-center gap-1 px-2 self-center h-6 mx-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors whitespace-nowrap shrink-0"
        >
          <X className="size-3 shrink-0" />
          <span>{t("workspace.tabs.closeAll")}</span>
          <span className="text-muted-foreground/60 mono ml-1">⌘\</span>
        </button>
      ) : null}
      {onCollapseCanvas ? (
        <button
          type="button"
          onClick={onCollapseCanvas}
          title={t("workspace.canvas.hide")}
          aria-label={t("workspace.canvas.hide")}
          className="inline-flex items-center gap-1 px-2 self-center h-6 mx-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors whitespace-nowrap shrink-0 border-l border-border/60 pl-2.5"
        >
          <PanelRightClose className="size-3.5 shrink-0" />
          <span className="hidden md:inline">{t("workspace.canvas.hide")}</span>
        </button>
      ) : null}
    </div>
  );
}

// 뷰 모드 버튼 — 사무실/에디터처럼 "어떤 콘텐츠를 보여줄지" 결정하는 토글.
// 파일 탭과는 의미가 다르므로 시각적으로도 다르게: 둥근 사각, 배경 채움.
function ViewModeButton({
  active,
  icon,
  label,
  title,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[12px] font-medium transition-colors shrink-0",
        active
          ? "bg-foreground text-background shadow-sm"
          : "text-muted-foreground hover:text-foreground hover:bg-muted",
      )}
    >
      <span className="opacity-90">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function Tab({
  active,
  icon,
  label,
  title,
  liveAgent,
  liveLine,
  onActivate,
  onClose,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  title?: string;
  liveAgent?: Agent;
  liveLine?: number;
  onActivate: () => void;
  onClose?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 px-3 py-1.5 text-sm border-b-2 -mb-px cursor-pointer transition-colors min-w-0 flex-1 max-w-[14rem]",
        active
          ? "border-foreground bg-background text-foreground font-medium"
          : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40",
      )}
      onClick={onActivate}
      title={
        liveAgent && title
          ? `${title}${liveLine ? ":" + liveLine : ""} · @${liveAgent.name} ${t("editing.tooltipSuffix")}`
          : title
      }
    >
      <span className="opacity-70 shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
      {liveAgent ? (
        <>
          <AgentInitialBadge
            agent={liveAgent}
            live
            size="xs"
            className="ml-0.5"
          />
          {liveLine ? (
            <span className="text-[10px] text-muted-foreground/80 mono shrink-0 ml-0.5">
              :{liveLine}
            </span>
          ) : null}
        </>
      ) : null}
      {onClose ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className={cn(
            "ml-1 inline-flex size-4 items-center justify-center rounded transition-opacity",
            active
              ? "opacity-60 hover:opacity-100 hover:bg-foreground/10"
              : "opacity-0 group-hover:opacity-60 hover:opacity-100 hover:bg-foreground/10",
          )}
          aria-label={t("workspace.tab.close")}
        >
          <X className="size-2.5" />
        </button>
      ) : null}
    </div>
  );
}
