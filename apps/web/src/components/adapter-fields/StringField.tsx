// kind: "string" — 단일 텍스트 입력.

import type { AdapterField } from "@loom/core";
import { Input } from "../ui.js";
import type { FieldRendererProps } from "./types.js";

export function StringField({ id, field, value, onChange }: FieldRendererProps) {
  const f = field as Extract<AdapterField, { kind: "string" }>;
  return (
    <Input
      id={id}
      value={(value as string | undefined) ?? ""}
      onChange={(e) => onChange(e.target.value || undefined)}
      placeholder={f.placeholder}
    />
  );
}
