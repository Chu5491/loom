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

  const liveModels = useQuery({
    queryKey: ["models", manifest.kind, command ?? ""],
    queryFn: () => api.listAdapterModels(manifest.kind, { command }),
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
