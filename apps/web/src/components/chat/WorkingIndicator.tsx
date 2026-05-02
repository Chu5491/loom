// "에이전트 입력 중…" 점 3개 표시기. motion 시퀀스로 수동 keyframes 대체.

import { motion } from "motion/react";
import type { Agent } from "@loom/core";
import { useI18n } from "../../context/I18nContext.js";

const DOTS = [0, 0.15, 0.3];

export function WorkingIndicator({
  workingAgents,
}: {
  workingAgents: Agent[];
}) {
  const { t } = useI18n();
  if (workingAgents.length === 0) return null;
  const label =
    workingAgents.length === 1
      ? t("chat.working.singular", { agent: workingAgents[0]!.name })
      : t("chat.working.plural", { count: workingAgents.length });
  return (
    <div className="flex items-center gap-2 px-5 py-1.5 text-xs text-muted-foreground bg-background">
      <span className="flex items-end gap-0.5">
        {DOTS.map((delay, i) => (
          <motion.span
            key={i}
            className="size-1 rounded-full bg-foreground/50"
            animate={{ y: [0, -3, 0] }}
            transition={{
              duration: 1.1,
              repeat: Infinity,
              ease: "easeInOut",
              delay,
            }}
          />
        ))}
      </span>
      <span>{label}</span>
    </div>
  );
}
