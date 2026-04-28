import { useState } from "react";
import type {
  AdapterField,
  AdapterEnvMapField,
  AdapterSelectField,
  AdapterSelectOption,
  AdapterStringListField,
} from "@loom/core";
import { Button, Input, Label } from "./ui.js";
import { useI18n } from "../context/I18nContext.js";

/** Render a single adapter field bound to a value/onChange pair. */
export function AdapterFieldInput({
  field,
  value,
  onChange,
  adapterKind,
  optionsOverride,
  labelAdornment,
}: {
  field: AdapterField;
  value: unknown;
  onChange: (next: unknown) => void;
  adapterKind: string;
  /** Replace the select field's options at render time (e.g. live model list). */
  optionsOverride?: AdapterSelectOption[];
  /** Element shown to the right of the label (e.g. "Live ✓ 12 models"). */
  labelAdornment?: React.ReactNode;
}) {
  const { t } = useI18n();
  // Try i18n key `adapter.<kind>.field.<key>` — fall back to manifest's English label.
  const labelKey = `adapter.${adapterKind}.field.${field.key}`;
  const translated = t(labelKey);
  const label = translated === labelKey ? field.label : translated;

  const helpKey = `adapter.${adapterKind}.field.${field.key}.help`;
  const helpTranslated = t(helpKey);
  const help = helpTranslated === helpKey ? field.help : helpTranslated;

  // Danger booleans get a full warning panel treatment instead of a plain row.
  if (field.danger && field.kind === "boolean") {
    return (
      <DangerBooleanField
        field={field}
        value={!!value}
        onChange={onChange}
        label={label}
        help={help}
      />
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`field-${field.key}`}>{label}</Label>
        {labelAdornment}
      </div>
      <FieldControl
        field={field}
        value={value}
        onChange={onChange}
        id={`field-${field.key}`}
        optionsOverride={optionsOverride}
      />
      {help ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-500">{help}</p>
      ) : null}
    </div>
  );
}

function DangerBooleanField({
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
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {label}
            </span>
            {value ? (
              <span className="inline-flex items-center rounded border border-red-300 bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700 dark:border-red-800 dark:bg-red-900/50 dark:text-red-300">
                {t("adapter.field.danger.enabled")}
              </span>
            ) : null}
          </div>
          {help ? (
            <p className="mt-1 text-xs text-zinc-700 dark:text-zinc-300">
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
  const color = enabled ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400";
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

function FieldControl({
  field,
  value,
  onChange,
  id,
  optionsOverride,
}: {
  field: AdapterField;
  value: unknown;
  onChange: (next: unknown) => void;
  id: string;
  optionsOverride?: AdapterSelectOption[];
}) {
  switch (field.kind) {
    case "string":
      return (
        <Input
          id={id}
          value={(value as string | undefined) ?? ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          placeholder={field.placeholder}
        />
      );

    case "boolean":
      return (
        <label className="inline-flex items-center gap-2 select-none cursor-pointer">
          <input
            id={id}
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            className="size-4 rounded border-zinc-300 dark:border-zinc-700"
          />
          <span className="text-sm text-zinc-700 dark:text-zinc-300">
            Enabled
          </span>
        </label>
      );

    case "select":
      return (
        <SelectControl
          id={id}
          field={field}
          value={(value as string | undefined) ?? ""}
          onChange={onChange}
          optionsOverride={optionsOverride}
        />
      );

    case "stringList":
      return (
        <StringListControl
          id={id}
          field={field}
          value={Array.isArray(value) ? (value as string[]) : []}
          onChange={onChange}
        />
      );

    case "envMap":
      return (
        <EnvMapControl
          id={id}
          field={field}
          value={
            value && typeof value === "object" && !Array.isArray(value)
              ? (value as Record<string, string>)
              : {}
          }
          onChange={onChange}
        />
      );
  }
}

function SelectControl({
  id,
  field,
  value,
  onChange,
  optionsOverride,
}: {
  id: string;
  field: AdapterSelectField;
  value: string;
  onChange: (next: string | undefined) => void;
  optionsOverride?: AdapterSelectOption[];
}) {
  const options = optionsOverride ?? field.options;
  const isCustom =
    field.allowCustom &&
    !!value &&
    !options.some((opt) => opt.value === value);

  const [customMode, setCustomMode] = useState(isCustom);

  if (customMode) {
    return (
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value || undefined)}
          placeholder={field.placeholder ?? "Custom value"}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setCustomMode(false);
            onChange(options[0]?.value);
          }}
        >
          Presets
        </Button>
      </div>
    );
  }

  const matched = options.find((opt) => opt.value === value);
  const selectValue = matched ? value : "";
  const grouped = groupByCategory(options);

  return (
    <div className="flex gap-2">
      <select
        id={id}
        value={selectValue}
        onChange={(e) => {
          if (e.target.value === "__custom__") {
            setCustomMode(true);
            onChange("");
          } else {
            onChange(e.target.value || undefined);
          }
        }}
        className="h-9 flex-1 rounded-md border px-2 text-sm border-zinc-300 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
      >
        {field.placeholder ? <option value="">{field.placeholder}</option> : null}
        {grouped.map(([category, opts]) =>
          category ? (
            <optgroup key={category} label={category}>
              {opts.map((opt) => (
                <option key={opt.value} value={opt.value} title={opt.description}>
                  {opt.label}
                </option>
              ))}
            </optgroup>
          ) : (
            opts.map((opt) => (
              <option key={opt.value} value={opt.value} title={opt.description}>
                {opt.label}
              </option>
            ))
          ),
        )}
        {field.allowCustom ? (
          <option value="__custom__">Custom…</option>
        ) : null}
      </select>
    </div>
  );
}

/**
 * Groups options by `category` while preserving original ordering. Returns
 * tuples of [categoryLabel | "", options[]] so flat lists (no categories) keep
 * working unchanged.
 */
function groupByCategory(
  options: AdapterSelectOption[],
): Array<[string, AdapterSelectOption[]]> {
  const order: string[] = [];
  const map = new Map<string, AdapterSelectOption[]>();
  for (const opt of options) {
    const key = opt.category ?? "";
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(opt);
  }
  return order.map((k) => [k, map.get(k)!]);
}

function StringListControl({
  id,
  field,
  value,
  onChange,
}: {
  id: string;
  field: AdapterStringListField;
  value: string[];
  onChange: (next: string[] | undefined) => void;
}) {
  const update = (next: string[]) => {
    onChange(next.length === 0 ? undefined : next);
  };

  return (
    <div className="space-y-1.5" id={id}>
      {value.map((item, i) => (
        <div key={i} className="flex gap-2">
          <Input
            value={item}
            onChange={(e) => {
              const next = [...value];
              next[i] = e.target.value;
              update(next);
            }}
            placeholder={field.itemPlaceholder}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              const next = [...value];
              next.splice(i, 1);
              update(next);
            }}
            aria-label="Remove"
          >
            ✕
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => update([...value, ""])}
      >
        + Add
      </Button>
    </div>
  );
}

function EnvMapControl({
  id,
  field,
  value,
  onChange,
}: {
  id: string;
  field: AdapterEnvMapField;
  value: Record<string, string>;
  onChange: (next: Record<string, string> | undefined) => void;
}) {
  const entries = Object.entries(value);
  const presentKeys = new Set(entries.map(([k]) => k));

  const update = (next: [string, string][]) => {
    const obj: Record<string, string> = {};
    for (const [k, v] of next) {
      if (k) obj[k] = v;
    }
    onChange(Object.keys(obj).length === 0 ? undefined : obj);
  };

  const unaddedSuggestions = (field.suggestions ?? []).filter(
    (s) => !presentKeys.has(s.key),
  );

  return (
    <div className="space-y-2" id={id}>
      {unaddedSuggestions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {unaddedSuggestions.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => update([...entries, [s.key, ""]])}
              title={s.description}
              className={
                "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs mono transition-colors " +
                (s.required
                  ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50"
                  : "border-zinc-300 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700")
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
            placeholder="KEY"
            className="mono"
          />
          <Input
            value={v}
            onChange={(e) => {
              const next = entries.slice();
              next[i] = [k, e.target.value];
              update(next);
            }}
            placeholder="value"
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
            aria-label="Remove"
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
        + Add variable
      </Button>
    </div>
  );
}

function isSecretKey(key: string): boolean {
  const upper = key.toUpperCase();
  return /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/.test(upper);
}
