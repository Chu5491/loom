// kind: "boolean" + danger=true — 경고 패널로 강조 + ENABLED 뱃지.

import type { AdapterField } from "@loom/core";
import { useI18n } from "../../context/I18nContext.js";

export function DangerBooleanField({
  field,
  value,
  onChange,
  label,
  help,
}: {
  field: AdapterField;
  value: boolean;
  onChange: (next: unknown) => void;
  label: string;
  help: string | undefined;
}) {
  const { t } = useI18n();
  const id = `field-${field.key}`;
  const enabledClasses = value
    ? "border-red-400 bg-red-50 dark:border-red-700 dark:bg-red-950/40"
    : "border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20";

  return (
    <div className={`rounded-md border p-3 transition-colors ${enabledClasses}`}>
      <label
        htmlFor={id}
        className="flex items-start gap-3 cursor-pointer select-none"
      >
        <ShieldIcon enabled={value} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {label}
            </span>
            {value ? (
              <span className="inline-flex items-center rounded border border-red-300 bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700 dark:border-red-800 dark:bg-red-900/50 dark:text-red-300">
                {t("adapter.field.danger.enabled")}
              </span>
            ) : null}
          </div>
          {help ? (
            <p className="mt-1 text-xs text-foreground/90">
              {help}
            </p>
          ) : null}
        </div>
        <input
          id={id}
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 rounded border-red-400 dark:border-red-700 accent-red-600 dark:accent-red-500"
        />
      </label>
    </div>
  );
}

function ShieldIcon({ enabled }: { enabled: boolean }) {
  const color = enabled
    ? "text-destructive"
    : "text-warning";
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 mt-0.5 ${color}`}
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      {enabled ? (
        <path d="M9 12l2 2 4-4" />
      ) : (
        <line x1="12" y1="8" x2="12" y2="13" />
      )}
      {!enabled ? <line x1="12" y1="16" x2="12" y2="16.01" /> : null}
    </svg>
  );
}
