// 어댑터 선택 카드. 호버 spotlight + 선택 시 회전 보더 빔.

import { motion } from "motion/react";
import type { AdapterManifest } from "@loom/core";
import { AdapterIcon } from "../../components/AdapterIcon.js";
import { AdapterStatusLive } from "../../components/AdapterStatus.js";
import { RotatingBorder } from "../../components/RotatingBorder.js";
import { Spotlight } from "../../components/Spotlight.js";
import { useI18n } from "../../context/I18nContext.js";
import { tManifestDescription } from "../../lib/adapterText.js";

export function AdapterCard({
  manifest,
  selected,
  onSelect,
}: {
  manifest: AdapterManifest;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  return (
    <motion.button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.985 }}
      transition={{ duration: 0.12 }}
      className={
        "group relative overflow-hidden text-left rounded-lg p-3 transition-colors " +
        (selected
          ? "bg-card"
          : "border border-zinc-200 bg-zinc-50/50 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/50 dark:hover:border-zinc-600")
      }
    >
      <RotatingBorder active={selected} />
      <Spotlight />
      <div className="relative z-10">
        {selected ? (
          <motion.span
            layoutId="adapter-card-marker"
            aria-hidden
            className="absolute -left-3 top-1/2 -translate-y-1/2 h-8 w-1 rounded-r-full bg-sky-500 dark:bg-sky-400"
            transition={{ type: "spring", stiffness: 500, damping: 32 }}
          />
        ) : null}
        <div className="flex items-center gap-3">
          <AdapterIcon manifest={manifest} size={32} />
          <div className="min-w-0 flex-1">
            <div className="font-medium truncate">{manifest.displayName}</div>
            <div className="text-xs text-muted-foreground mono truncate">
              {manifest.kind} · {manifest.defaultCommand}
            </div>
          </div>
          <AdapterStatusLive kind={manifest.kind} showLabel={false} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
          {tManifestDescription(t, manifest)}
        </p>
      </div>
    </motion.button>
  );
}
