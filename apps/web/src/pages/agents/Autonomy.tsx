// 자율성 칩(목록 미니 표시) + 슬라이더(편집 폼). 동일 도메인이라 한 파일에.

import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";
import { AUTONOMY_LEVELS, type Autonomy } from "./types.js";

export function AutonomyChip({ autonomy }: { autonomy: Autonomy }) {
  const { t } = useI18n();
  const tone =
    autonomy === "auto"
      ? "text-warning bg-amber-500/10 border-amber-500/25"
      : autonomy === "suggest"
        ? "text-sky-700 dark:text-sky-400 bg-sky-500/10 border-sky-500/25"
        : "text-success bg-emerald-500/10 border-emerald-500/25";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wider mono",
        tone,
      )}
      title={t(`agents.autonomy.${autonomy}.hint`)}
    >
      {t(`agents.autonomy.${autonomy}.label`)}
    </span>
  );
}

export function AutonomySlider({
  value,
  onChange,
}: {
  value: Autonomy;
  onChange: (next: Autonomy) => void;
}) {
  const { t } = useI18n();
  const idx = AUTONOMY_LEVELS.indexOf(value);
  const tone =
    value === "auto"
      ? "text-warning bg-amber-500/15"
      : value === "suggest"
        ? "text-sky-700 dark:text-sky-400 bg-sky-500/15"
        : "text-success bg-emerald-500/15";
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/50 p-3 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {t("agents.autonomy.title")}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("agents.autonomy.hint")}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider mono",
            tone,
          )}
        >
          {t(`agents.autonomy.${value}.label`)}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={AUTONOMY_LEVELS.length - 1}
        step={1}
        value={idx}
        onChange={(e) =>
          onChange(AUTONOMY_LEVELS[Number(e.target.value)] ?? "auto")
        }
        className="w-full accent-foreground/70"
      />
      <div className="grid grid-cols-3 gap-2 text-[10px] uppercase tracking-wider mono">
        {AUTONOMY_LEVELS.map((lvl, i) => (
          <button
            key={lvl}
            type="button"
            onClick={() => onChange(lvl)}
            className={cn(
              "text-center transition-colors",
              i === 0 && "text-left",
              i === AUTONOMY_LEVELS.length - 1 && "text-right",
              lvl === value
                ? "text-foreground font-semibold"
                : "text-muted-foreground/70 hover:text-foreground",
            )}
          >
            {t(`agents.autonomy.${lvl}.label`)}
          </button>
        ))}
      </div>
    </div>
  );
}
