// kind: "boolean" — 평범한 체크박스.
// danger 플래그가 있으면 AdapterFieldInput이 별도로 DangerBooleanField를 사용함.

import { useI18n } from "../../context/I18nContext.js";
import type { FieldRendererProps } from "./types.js";

export function BooleanField({ id, value, onChange }: FieldRendererProps) {
  const { t } = useI18n();
  return (
    <label className="inline-flex items-center gap-2 select-none cursor-pointer">
      <input
        id={id}
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 rounded border-border"
      />
      <span className="text-sm text-foreground/90">
        {t("adapter.field.boolean.enabled")}
      </span>
    </label>
  );
}
