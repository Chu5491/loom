// 단일 어댑터 필드 → 렌더러 컴포넌트로 디스패치.
// 실제 렌더링 로직은 ./adapter-fields/ 디렉토리에 필드 종류별로 분리되어 있고,
// registry.ts가 kind → Component 매핑을 보유. 이 파일은 i18n 라벨/도움말 + danger 분기만.

import type { AdapterField, AdapterSelectOption } from "@loom/core";
import { Label } from "./ui.js";
import { useI18n } from "../context/I18nContext.js";
import { tFieldHelp, tFieldLabel } from "../lib/adapterText.js";
import { DangerBooleanField } from "./adapter-fields/DangerBooleanField.js";
import { FIELD_RENDERERS } from "./adapter-fields/registry.js";

/** value/onChange에 바인딩된 단일 어댑터 필드 렌더링. */
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
  /** select 필드의 옵션을 런타임에 교체 (예: 라이브 모델 목록). */
  optionsOverride?: AdapterSelectOption[];
  /** 라벨 우측에 표시할 요소 (예: "Live ✓ 12 models"). */
  labelAdornment?: React.ReactNode;
}) {
  const { t } = useI18n();
  const label = tFieldLabel(t, adapterKind, field);
  const help = tFieldHelp(t, adapterKind, field);

  // danger boolean은 평범한 체크박스 대신 경고 패널.
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

  const Renderer = FIELD_RENDERERS[field.kind];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`field-${field.key}`}>{label}</Label>
        {labelAdornment}
      </div>
      <Renderer
        id={`field-${field.key}`}
        field={field}
        value={value}
        onChange={onChange}
        adapterKind={adapterKind}
        optionsOverride={optionsOverride}
      />
      {help ? (
        <p className="text-xs text-muted-foreground dark:text-zinc-500">{help}</p>
      ) : null}
    </div>
  );
}
