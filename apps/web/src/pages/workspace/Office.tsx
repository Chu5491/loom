// "사무실" 뷰 — 캐릭터들이 사무실 안을 자유롭게 돌아다니다 일이 들어오면
// 자기 자리로 가서 작업. 클릭하면 그 에이전트와 채팅 시작 (composer 타깃 +
// dock 자동 열기). 자세한 활동은 호버 시 캐릭터 옆에 떠오르는 정보 카드에.

import { Pencil } from "lucide-react";
import type {
  ActiveTouch,
  ActiveToolsForAgent,
  Agent,
  Thread,
} from "@loom/core";
import { useI18n } from "../../context/I18nContext.js";
import { OfficeFloor } from "./OfficeFloor.js";

export function Office({
  agents,
  workingIds,
  touchingIds,
  activeTouches,
  activeTools,
  activeThread,
  onPickAgent,
}: {
  agents: Agent[];
  workingIds: Set<string>;
  touchingIds: Set<string>;
  activeTouches: ActiveTouch[];
  activeTools: ActiveToolsForAgent[];
  activeThread: Thread | null;
  onPickAgent: (id: string) => void;
}) {
  const { t } = useI18n();
  const workingCount = workingIds.size;

  return (
    <div className="flex-1 min-h-0 flex flex-col office-floor">
      {/* 화이트보드 — 사무실 상단 공유 정보판. */}
      <header className="shrink-0 border-b-2 border-foreground/10 bg-card/60 backdrop-blur-sm">
        <div className="mx-auto max-w-5xl px-6 py-3 flex items-center gap-3">
          <span
            aria-hidden
            className="inline-flex size-7 items-center justify-center rounded bg-foreground/[0.06] text-muted-foreground"
          >
            <Pencil className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-semibold truncate">
                {activeThread
                  ? activeThread.name
                  : t("office.whiteboard.noThread")}
              </h2>
              <span className="text-[11px] text-muted-foreground/70 mono">
                {t("office.whiteboard.agents", { n: agents.length })}
              </span>
              {workingCount > 0 ? (
                <span className="inline-flex items-center gap-1 px-1.5 h-5 rounded-full text-[10px] mono text-emerald-700 dark:text-emerald-300 bg-emerald-500/10">
                  <span
                    aria-hidden
                    className="size-1.5 rounded-full bg-emerald-500 animate-pulse"
                  />
                  {t("office.whiteboard.working", { n: workingCount })}
                </span>
              ) : null}
            </div>
            <p className="text-[11px] text-muted-foreground/80 mt-0.5">
              {t("office.whiteboard.subtitle")}
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex flex-col">
        <OfficeFloor
          agents={agents}
          workingIds={workingIds}
          touchingIds={touchingIds}
          activeTouches={activeTouches}
          activeTools={activeTools}
          onPickAgent={(id) => {
            // 캐릭터 클릭 = "이 사람과 대화" — composer 타깃 + dock 자동 열기.
            onPickAgent(id);
            window.dispatchEvent(new CustomEvent("loom:openChatDock"));
          }}
        />
      </div>
    </div>
  );
}
