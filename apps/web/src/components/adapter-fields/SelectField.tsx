// kind: "select" — 옵션 드롭다운 (+ optgroup + custom 자유 입력 모드).

import { useState } from "react";
import type { AdapterField, AdapterSelectOption } from "@loom/core";
import { Button, Input } from "../ui.js";
import { useI18n } from "../../context/I18nContext.js";
import {
  tOptgroup,
  tOptionDescription,
  tOptionLabel,
} from "../../lib/adapterText.js";
import type { FieldRendererProps } from "./types.js";

export function SelectField({
  id,
  field,
  value,
  onChange,
  optionsOverride,
  adapterKind,
}: FieldRendererProps) {
  const { t } = useI18n();
  const f = field as Extract<AdapterField, { kind: "select" }>;
  const stringValue = (value as string | undefined) ?? "";
  const options = optionsOverride ?? f.options;
  const isCustom =
    f.allowCustom &&
    !!stringValue &&
    !options.some((opt) => opt.value === stringValue);

  const [customMode, setCustomMode] = useState(isCustom);

  if (customMode) {
    return (
      <div className="flex gap-2">
        <Input
          id={id}
          value={stringValue}
          onChange={(e) => onChange(e.target.value || undefined)}
          placeholder={
            f.placeholder ?? t("adapter.field.select.customPlaceholder")
          }
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
          {t("adapter.field.select.presets")}
        </Button>
      </div>
    );
  }

  const matched = options.find((opt) => opt.value === stringValue);
  const selectValue = matched ? stringValue : "";
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
        {f.placeholder ? <option value="">{f.placeholder}</option> : null}
        {grouped.map(([category, opts]) =>
          category ? (
            <optgroup
              key={category}
              label={tOptgroup(t, adapterKind, f.key, category)}
            >
              {opts.map((opt) => (
                <option
                  key={opt.value}
                  value={opt.value}
                  title={tOptionDescription(t, adapterKind, f.key, opt)}
                >
                  {tOptionLabel(t, adapterKind, f.key, opt)}
                </option>
              ))}
            </optgroup>
          ) : (
            opts.map((opt) => (
              <option
                key={opt.value}
                value={opt.value}
                title={tOptionDescription(t, adapterKind, f.key, opt)}
              >
                {tOptionLabel(t, adapterKind, f.key, opt)}
              </option>
            ))
          ),
        )}
        {f.allowCustom ? (
          <option value="__custom__">{t("adapter.field.select.custom")}</option>
        ) : null}
      </select>
    </div>
  );
}

// 옵션을 category로 묶음 (원래 순서 보존).
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
