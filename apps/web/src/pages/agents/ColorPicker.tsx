// 에이전트 색상 스와치. "auto"는 해시 기반 자동 선택.
// 선택 ring은 motion layoutId로 색상 사이를 미끄러짐.

import { motion } from "motion/react";
import {
  AGENT_COLORS,
  type AgentColor,
  classesFor,
} from "../../components/agentColor.js";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";

export function ColorPicker({
  value,
  fallback,
  onChange,
}: {
  value: AgentColor | null;
  fallback: AgentColor;
  onChange: (next: AgentColor | null) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => onChange(null)}
        title={t("agents.field.color.auto")}
        aria-pressed={value === null}
        className={cn(
          "relative inline-flex items-center gap-1 rounded-full border px-2 h-6 text-[10px] font-semibold uppercase tracking-wider mono transition-colors",
          value === null
            ? "border-foreground/50 bg-foreground/[0.04] text-foreground"
            : "border-border text-muted-foreground hover:text-foreground hover:bg-muted",
        )}
      >
        <span
          aria-hidden
          className={cn("size-2 rounded-full", classesFor(fallback).dot)}
        />
        {t("agents.field.color.auto")}
      </button>
      {AGENT_COLORS.map((c) => {
        const isSel = value === c;
        return (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            title={c}
            aria-label={c}
            aria-pressed={isSel}
            className="relative inline-flex size-6 items-center justify-center rounded-full border border-border hover:border-foreground/40 transition-colors"
          >
            {isSel ? (
              <motion.span
                layoutId="agent-color-ring"
                aria-hidden
                className="absolute inset-0 rounded-full ring-2 ring-foreground/40"
                transition={{ type: "spring", stiffness: 500, damping: 32 }}
              />
            ) : null}
            <span
              aria-hidden
              className={cn("size-3 rounded-full", classesFor(c).dot)}
            />
          </button>
        );
      })}
    </div>
  );
}
