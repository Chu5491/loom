// 모든 필드 렌더러가 공유하는 props 형태.
// 새 필드 타입(예: "color", "duration") 추가 시 이 타입을 가진 컴포넌트 + registry 항목 추가만 하면 됨.

import type { AdapterField, AdapterSelectOption } from "@loom/core";

export interface FieldRendererProps<F extends AdapterField = AdapterField> {
  id: string;
  field: F;
  value: unknown;
  onChange: (next: unknown) => void;
  adapterKind: string;
  /** select 필드용 — 라이브 모델 목록 등 런타임 옵션 교체. */
  optionsOverride?: AdapterSelectOption[];
}

export type FieldKind = AdapterField["kind"];
