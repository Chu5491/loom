// kind: "stringList" — 동적으로 행을 추가/삭제하는 문자열 배열 입력.

import type { AdapterField } from "@loom/core";
import { Button, Input } from "../ui.js";
import { useI18n } from "../../context/I18nContext.js";
import { useAutoAnimate } from "../../lib/useAutoAnimate.js";
import type { FieldRendererProps } from "./types.js";

export function StringListField({
  id,
  field,
  value,
  onChange,
}: FieldRendererProps) {
  const { t } = useI18n();
  const f = field as Extract<AdapterField, { kind: "stringList" }>;
  const list = Array.isArray(value) ? (value as string[]) : [];
  const containerRef = useAutoAnimate<HTMLDivElement>();

  const update = (next: string[]) => {
    onChange(next.length === 0 ? undefined : next);
  };

  return (
    <div ref={containerRef} className="space-y-1.5" id={id}>
      {list.map((item, i) => (
        <div key={i} className="flex gap-2">
          <Input
            value={item}
            onChange={(e) => {
              const next = [...list];
              next[i] = e.target.value;
              update(next);
            }}
            placeholder={f.itemPlaceholder}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              const next = [...list];
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
        onClick={() => update([...list, ""])}
      >
        {t("adapter.field.list.add")}
      </Button>
    </div>
  );
}
