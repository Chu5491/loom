// kind: "envMap" — 환경 변수 KEY=VALUE 맵 + 어댑터별 제안 칩.
// KEY 이름이 KEY/TOKEN/SECRET/PASSWORD/CREDENTIAL을 포함하면 password input으로 마스킹.

import type { AdapterField } from "@loom/core";
import { Button, Input } from "../ui.js";
import { useI18n } from "../../context/I18nContext.js";
import { tSuggestionDescription } from "../../lib/adapterText.js";
import { useAutoAnimate } from "../../lib/useAutoAnimate.js";
import type { FieldRendererProps } from "./types.js";

export function EnvMapField({
  id,
  field,
  value,
  onChange,
  adapterKind,
}: FieldRendererProps) {
  const { t } = useI18n();
  const f = field as Extract<AdapterField, { kind: "envMap" }>;
  const map =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, string>)
      : {};
  const entries = Object.entries(map);
  const presentKeys = new Set(entries.map(([k]) => k));
  const containerRef = useAutoAnimate<HTMLDivElement>();

  const update = (next: [string, string][]) => {
    const obj: Record<string, string> = {};
    for (const [k, v] of next) {
      if (k) obj[k] = v;
    }
    onChange(Object.keys(obj).length === 0 ? undefined : obj);
  };

  const unaddedSuggestions = (f.suggestions ?? []).filter(
    (s) => !presentKeys.has(s.key),
  );

  return (
    <div ref={containerRef} className="space-y-2" id={id}>
      {unaddedSuggestions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {unaddedSuggestions.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => update([...entries, [s.key, ""]])}
              title={tSuggestionDescription(t, adapterKind, f.key, s)}
              className={
                "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs mono transition-colors " +
                (s.required
                  ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50"
                  : "border-zinc-300 bg-zinc-50 text-foreground/90 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700")
              }
            >
              <span className="opacity-60">+</span>
              {s.key}
              {s.required ? <span className="opacity-70">*</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {entries.map(([k, v], i) => (
        <div key={i} className="grid grid-cols-[1fr_2fr_auto] gap-2">
          <Input
            value={k}
            onChange={(e) => {
              const next = entries.slice();
              next[i] = [e.target.value, v];
              update(next);
            }}
            placeholder={t("adapter.field.envMap.keyPlaceholder")}
            className="mono"
          />
          <Input
            value={v}
            onChange={(e) => {
              const next = entries.slice();
              next[i] = [k, e.target.value];
              update(next);
            }}
            placeholder={t("adapter.field.envMap.valuePlaceholder")}
            className="mono"
            type={isSecretKey(k) ? "password" : "text"}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              const next = entries.slice();
              next.splice(i, 1);
              update(next);
            }}
            aria-label={t("common.remove")}
          >
            ✕
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => update([...entries, ["", ""]])}
      >
        {t("adapter.field.envMap.add")}
      </Button>
    </div>
  );
}

function isSecretKey(key: string): boolean {
  const upper = key.toUpperCase();
  return /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/.test(upper);
}
