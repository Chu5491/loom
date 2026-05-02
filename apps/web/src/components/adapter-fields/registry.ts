// 필드 종류 → 렌더러 컴포넌트 매핑.
// 새 필드 타입(예: "color")을 추가하려면:
//   1. packages/core types에 새 kind 추가
//   2. ./ColorField.tsx 작성 (FieldRendererProps 형태)
//   3. 이 레지스트리에 한 줄 등록
// 다른 곳은 손대지 않아도 됨 — switch 디스패치 패턴이 만들던 분기 추가가 사라짐.

import type { ComponentType } from "react";
import { BooleanField } from "./BooleanField.js";
import { EnvMapField } from "./EnvMapField.js";
import { SelectField } from "./SelectField.js";
import { StringField } from "./StringField.js";
import { StringListField } from "./StringListField.js";
import type { FieldKind, FieldRendererProps } from "./types.js";

export const FIELD_RENDERERS: Record<
  FieldKind,
  ComponentType<FieldRendererProps>
> = {
  string: StringField,
  boolean: BooleanField,
  select: SelectField,
  stringList: StringListField,
  envMap: EnvMapField,
};
