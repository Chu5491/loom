// 사이드 패널 — 테마/언어/서버 상태 + 빌드 정보.

import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client.js";
import { LoomLogo } from "../LoomLogo.js";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";
import { useTheme, type ThemeMode } from "../../context/ThemeContext.js";
import {
  LANG_NAMES,
  SUPPORTED_LANGS,
  type Lang,
} from "../../i18n/dictionaries.js";
import { PanelHeader, SettingsRow } from "./shared.js";

export function SettingsTab() {
  const { t } = useI18n();
  const { mode, setMode } = useTheme();
  const { lang, setLang } = useI18n();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 10_000,
  });
  return (
    <>
      <PanelHeader title={t("activity.settings")} />
      <div className="flex-1 overflow-y-auto subtle-scrollbar p-3 space-y-4">
        <SettingsRow label={t("nav.theme.title")}>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as ThemeMode)}
            className="h-7 cursor-pointer rounded-md border bg-transparent px-2 text-xs hover:bg-muted focus:outline-none"
          >
            <option value="system">{t("nav.theme.system")}</option>
            <option value="light">{t("nav.theme.light")}</option>
            <option value="dark">{t("nav.theme.dark")}</option>
          </select>
        </SettingsRow>
        <SettingsRow label={t("nav.lang.title")}>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
            className="h-7 cursor-pointer rounded-md border bg-transparent px-2 text-xs hover:bg-muted focus:outline-none"
          >
            {SUPPORTED_LANGS.map((l) => (
              <option key={l} value={l}>
                {LANG_NAMES[l]}
              </option>
            ))}
          </select>
        </SettingsRow>
        <SettingsRow label={t("settings.serverStatus")}>
          <span className="inline-flex items-center gap-1.5 text-xs">
            <span
              className={cn(
                "size-1.5 rounded-full",
                health.isSuccess
                  ? "bg-emerald-500"
                  : health.isError
                    ? "bg-red-500"
                    : "bg-zinc-400",
              )}
            />
            {health.isSuccess
              ? t("common.online")
              : health.isError
                ? t("common.offline")
                : t("common.loading")}
          </span>
        </SettingsRow>

        <div className="pt-3 border-t">
          <div className="flex items-center gap-2">
            <LoomLogo className="size-5 dark:invert" />
            <div className="text-xs text-muted-foreground">
              loom <span className="mono">v0.1.0</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
