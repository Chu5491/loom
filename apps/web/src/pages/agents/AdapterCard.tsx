// 어댑터 선택 카드. 선택되면 좌측에 강조 바 + 보더 색 변화.
// (이전엔 spotlight + rotating border 효과 — 화려하지만 정보가치 0이라 제거.)

import type { AdapterManifest } from "@loom/core";
import { AdapterIcon } from "../../components/AdapterIcon.js";
import { AdapterStatusLive } from "../../components/AdapterStatus.js";
import { useI18n } from "../../context/I18nContext.js";
import { tManifestDescription } from "../../lib/adapterText.js";
import { cn } from "../../lib/utils.js";

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
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "group relative text-left rounded-md border p-3 transition-colors",
        selected
          ? "border-foreground/50 bg-card"
          : "border-border bg-muted/40 hover:border-foreground/30 hover:bg-muted/60",
      )}
    >
      {selected ? (
        <span
          aria-hidden
          className="absolute -left-px top-2 bottom-2 w-0.5 rounded-r-full bg-foreground"
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
    </button>
  );
}
