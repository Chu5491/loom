// 에이전트 색상 스와치. "auto"는 해시 기반 자동 선택.
// 선택 ring은 motion layoutId로 색상 사이를 미끄러짐.
// 18색 팔레트 — PICKER_ORDER(색상환 순)로 2x9 그리드 렌더.

import { motion } from "motion/react";
import { useState } from "react";
import {
  PICKER_ORDER,
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
  // 호버한 색을 미리보기 칩으로 띄움 — 선택하기 전에 어떤 톤인지 살핌.
  const [preview, setPreview] = useState<AgentColor | null>(null);
  const previewColor = preview ?? value ?? fallback;
  const previewClasses = classesFor(previewColor);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(null)}
          title={t("agents.field.color.auto")}
          aria-pressed={value === null}
          className={cn(
            "relative inline-flex items-center gap-1.5 rounded-full border px-2.5 h-7 text-[10px] font-semibold uppercase tracking-wider mono transition-colors",
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
        <div
          aria-hidden
          className={cn(
            "ml-auto flex items-center gap-1.5 rounded-md border border-border px-2 h-7 transition-colors",
            previewClasses.bgSoft,
          )}
        >
          <span className={cn("size-2 rounded-full", previewClasses.dot)} />
          <span
            className={cn(
              "text-[10px] mono uppercase tracking-wider",
              previewClasses.text,
            )}
          >
            {previewColor}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-9 gap-1.5">
        {PICKER_ORDER.map((c) => {
          const isSel = value === c;
          const tones = classesFor(c);
          return (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c)}
              onMouseEnter={() => setPreview(c)}
              onMouseLeave={() => setPreview(null)}
              onFocus={() => setPreview(c)}
              onBlur={() => setPreview(null)}
              title={c}
              aria-label={c}
              aria-pressed={isSel}
              className="relative inline-flex size-7 items-center justify-center rounded-full border border-border hover:border-foreground/40 transition-[transform,border-color] hover:scale-110"
            >
              {isSel ? (
                <motion.span
                  layoutId="agent-color-ring"
                  aria-hidden
                  className="absolute inset-0 rounded-full ring-2 ring-foreground/50"
                  transition={{ type: "spring", stiffness: 500, damping: 32 }}
                />
              ) : null}
              <span
                aria-hidden
                className={cn("size-3.5 rounded-full", tones.dot)}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
