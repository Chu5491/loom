// 우측 가장자리 세로 아이콘 rail. 활동 패널들을 toggle하는 진입점.
// 카톡 PC의 친구목록/채팅탭처럼 항상 보이는 좁은 컬럼.
//
// 현재는 채팅(💬)만 활성. 참여자/활동 아이콘은 자리만 잡고 추후 단계.

import { motion } from "motion/react";
import { Activity, MessagesSquare, Users } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

export interface RightIconRailProps {
  chatOpen: boolean;
  unreadCount: number;
  onToggleChat: () => void;
}

export function RightIconRail({
  chatOpen,
  unreadCount,
  onToggleChat,
}: RightIconRailProps) {
  const { t } = useI18n();

  return (
    <aside className="flex w-11 shrink-0 flex-col items-center gap-1 border-l border-border bg-card py-2">
      <RailButton
        active={chatOpen}
        label={t("rail.chat")}
        onClick={onToggleChat}
        badge={!chatOpen && unreadCount > 0 ? unreadCount : undefined}
      >
        <MessagesSquare className="size-5" />
      </RailButton>
      {/* 자리 holder — 추후 단계에서 참여자/활동 패널과 연결. */}
      <RailButton disabled label={t("rail.participants")} onClick={() => {}}>
        <Users className="size-5" />
      </RailButton>
      <RailButton disabled label={t("rail.activity")} onClick={() => {}}>
        <Activity className="size-5" />
      </RailButton>
    </aside>
  );
}

function RailButton({
  active,
  disabled,
  label,
  badge,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  badge?: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          onClick={onClick}
          aria-label={label}
          aria-pressed={active}
          className={cn(
            "relative flex size-9 items-center justify-center rounded-md transition-colors",
            disabled
              ? "text-muted-foreground/30 cursor-not-allowed"
              : active
                ? "bg-foreground/[0.08] text-foreground"
                : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
          )}
        >
          {active ? (
            <span
              aria-hidden
              className="absolute -right-1.5 top-1.5 bottom-1.5 w-[2px] rounded-l-full bg-foreground"
            />
          ) : null}
          {children}
          {badge !== undefined && badge > 0 ? (
            <motion.span
              key={badge}
              aria-label={`${badge} unread`}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-semibold mono inline-flex items-center justify-center ring-2 ring-card"
            >
              {badge > 99 ? "99+" : badge}
            </motion.span>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
