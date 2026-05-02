// 우측 하단 floating 채팅 런처. 챗봇 위젯 패턴.
// 닫혀있을 때만 노출 — 열려있을 땐 ChatOverlay의 X로 닫기.
// 안 읽음 카운트는 우상단 ring-2 빨간 dot.

import { motion, AnimatePresence } from "motion/react";
import { MessagesSquare } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip.js";
import { useI18n } from "../context/I18nContext.js";

export function ChatLauncher({
  visible,
  unreadCount,
  onOpen,
}: {
  /** chatOpen=false 일 때만 보임 — 열려있을 땐 사라짐. */
  visible: boolean;
  unreadCount: number;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="chat-launcher"
          initial={{ opacity: 0, scale: 0.6, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.6, y: 12 }}
          transition={{ type: "spring", stiffness: 500, damping: 28 }}
          className="fixed bottom-4 right-4 z-30"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onOpen}
                aria-label={t("rail.chat")}
                className="relative inline-flex size-12 items-center justify-center rounded-full bg-foreground text-background shadow-lg ring-2 ring-card hover:scale-105 active:scale-95 transition-transform"
              >
                <MessagesSquare className="size-5" />
                {unreadCount > 0 ? (
                  <motion.span
                    key={unreadCount}
                    aria-label={`${unreadCount} unread`}
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-semibold mono inline-flex items-center justify-center ring-2 ring-card"
                  >
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </motion.span>
                ) : null}
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" sideOffset={8}>
              {t("rail.chat")}
            </TooltipContent>
          </Tooltip>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
