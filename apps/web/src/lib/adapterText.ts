import type {
  AdapterField,
  AdapterManifest,
  AdapterSelectOption,
  EnvSuggestion,
} from "@loom/core";

type T = (key: string, vars?: Record<string, string | number>) => string;

// 어댑터 매니페스트 텍스트(label/help/description/option label 등)를 i18n 키로
// 우선 조회하고, 키가 없으면 매니페스트의 영문 원본으로 폴백합니다.
//
// 키 규칙:
//   adapter.<kind>.description                     - 어댑터 설명
//   adapter.<kind>.field.<key>                     - 필드 라벨
//   adapter.<kind>.field.<key>.help                - 필드 도움말
//   adapter.<kind>.field.<key>.placeholder         - 필드 placeholder
//   adapter.<kind>.field.<key>.option.<value>      - 셀렉트 옵션 라벨
//   adapter.<kind>.field.<key>.option.<value>.desc - 셀렉트 옵션 설명
//   adapter.<kind>.field.<key>.optgroup.<category> - 셀렉트 그룹 헤더
//   adapter.<kind>.field.<key>.suggestion.<envKey> - envMap 서제스천 설명

function tryT(t: T, key: string, fallback: string | undefined): string | undefined {
  if (!key) return fallback;
  const v = t(key);
  return v === key ? fallback : v;
}

export function tManifestDescription(t: T, m: AdapterManifest): string {
  return tryT(t, `adapter.${m.kind}.description`, m.description) ?? "";
}

export function tFieldLabel(t: T, kind: string, field: AdapterField): string {
  return tryT(t, `adapter.${kind}.field.${field.key}`, field.label) ?? field.label;
}

export function tFieldHelp(t: T, kind: string, field: AdapterField): string | undefined {
  return tryT(t, `adapter.${kind}.field.${field.key}.help`, field.help);
}

export function tFieldPlaceholder(
  t: T,
  kind: string,
  field: AdapterField,
  raw: string | undefined,
): string | undefined {
  return tryT(t, `adapter.${kind}.field.${field.key}.placeholder`, raw);
}

export function tOptionLabel(
  t: T,
  kind: string,
  fieldKey: string,
  opt: AdapterSelectOption,
): string {
  return tryT(t, `adapter.${kind}.field.${fieldKey}.option.${opt.value}`, opt.label) ?? opt.label;
}

export function tOptionDescription(
  t: T,
  kind: string,
  fieldKey: string,
  opt: AdapterSelectOption,
): string | undefined {
  return tryT(t, `adapter.${kind}.field.${fieldKey}.option.${opt.value}.desc`, opt.description);
}

export function tOptgroup(
  t: T,
  kind: string,
  fieldKey: string,
  category: string,
): string {
  return tryT(t, `adapter.${kind}.field.${fieldKey}.optgroup.${category}`, category) ?? category;
}

export function tSuggestionDescription(
  t: T,
  kind: string,
  fieldKey: string,
  s: EnvSuggestion,
): string | undefined {
  return tryT(
    t,
    `adapter.${kind}.field.${fieldKey}.suggestion.${s.key}`,
    s.description,
  );
}
