// AdapterField 하나를 config dict에 바인딩. `model` 필드는 라이브 모델 목록 오버라이드.

import { useQuery } from "@tanstack/react-query";
import type {
  AdapterField,
  AdapterManifest,
  AdapterSelectOption,
} from "@loom/core";
import { api } from "../../api/client.js";
import { AdapterFieldInput } from "../../components/AdapterFields.js";
import { useI18n } from "../../context/I18nContext.js";

export function ConfigFieldBinder({
  field,
  config,
  setConfig,
  manifest,
}: {
  field: AdapterField;
  config: Record<string, unknown>;
  setConfig: (next: Record<string, unknown>) => void;
  manifest: AdapterManifest;
}) {
  const isModelField = field.kind === "select" && field.key === "model";
  const command = config.command as string | undefined;
  // 폼에 입력한 env(=API 키)를 모델 조회에 전달 — provider-API 어댑터가 그 키로
  // 라이브 모델을 가져온다. 키가 없으면 서버 process.env 로 폴백.
  const env =
    config.env && typeof config.env === "object"
      ? (config.env as Record<string, string>)
      : undefined;
  // 키 변경 시 refetch 되도록 queryKey 에 env 의 키 이름들을 포함(값은 제외).
  const envFingerprint = env ? Object.keys(env).sort().join(",") : "";

  const liveModels = useQuery({
    queryKey: ["models", manifest.kind, command ?? "", envFingerprint],
    queryFn: () => api.listAdapterModels(manifest.kind, { command, env }),
    enabled: isModelField,
    staleTime: 5 * 60_000,
  });

  const optionsOverride: AdapterSelectOption[] | undefined =
    isModelField && liveModels.data?.models.models?.length
      ? liveModels.data.models.models
      : undefined;

  const adornment = isModelField ? (
    <ModelSourceBadge
      source={liveModels.data?.models.source}
      hint={liveModels.data?.models.hint}
      isLoading={liveModels.isLoading}
    />
  ) : undefined;

  return (
    <AdapterFieldInput
      field={field}
      adapterKind={manifest.kind}
      value={config[field.key]}
      onChange={(next) => setConfig({ ...config, [field.key]: next })}
      optionsOverride={optionsOverride}
      labelAdornment={adornment}
    />
  );
}

function ModelSourceBadge({
  source,
  hint,
  isLoading,
}: {
  source: "live" | "presets" | "error" | undefined;
  hint?: string;
  isLoading: boolean;
}) {
  const { t } = useI18n();
  if (isLoading) {
    return (
      <span
        className="text-xs text-muted-foreground"
        title={t("adapter.models.checking")}
      >
        ⟳ {t("adapter.models.checking")}
      </span>
    );
  }
  if (!source) return null;
  const palette = {
    live: "text-success",
    presets: "text-zinc-500",
    error: "text-warning",
  } as const;
  const label =
    source === "live"
      ? t("adapter.models.live")
      : source === "presets"
        ? t("adapter.models.presets")
        : t("adapter.models.error");
  return (
    <span className={`text-xs ${palette[source]}`} title={hint}>
      {source === "live" ? "● " : source === "error" ? "⚠ " : ""}
      {label}
    </span>
  );
}
