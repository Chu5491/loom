// 캐릭터 머리 위에 떠오르는 작은 말풍선. 짧은 한 줄 텍스트 + 아래 꼬리.
// 들어오고 나갈 때 살짝 fade + slide. AnimatePresence는 motion/react 사용
// (기존 의존성 — 새로 추가 X).

import { AnimatePresence, motion } from "motion/react";

export function SpeechBubble({
  text,
  className,
}: {
  /** null이면 풍선 없음 (AnimatePresence가 fade-out). */
  text: string | null;
  className?: string;
}) {
  return (
    <AnimatePresence>
      {text ? (
        <motion.div
          key={text}
          initial={{ opacity: 0, y: 4, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.9 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className={`pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 ${className ?? ""}`}
        >
          <div className="relative whitespace-nowrap rounded-md border border-border bg-popover px-2 py-0.5 text-[10px] mono text-popover-foreground shadow-md">
            {text}
            {/* 꼬리 — 아래 방향. border 두께 트릭으로 중앙에 작은 삼각형. */}
            <span
              aria-hidden
              className="absolute left-1/2 -translate-x-1/2 top-full"
              style={{
                width: 0,
                height: 0,
                borderLeft: "4px solid transparent",
                borderRight: "4px solid transparent",
                borderTop: "4px solid var(--popover)",
              }}
            />
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
