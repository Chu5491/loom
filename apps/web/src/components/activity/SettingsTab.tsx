// 사이드 패널 — 테마/언어/워크스페이스 룰/서버 상태 + 빌드 정보.

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../../api/client.js";
import { LoomLogo } from "../LoomLogo.js";
import { Button } from "../ui/button.js";
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

        <GlobalRuleSection />

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

/** 워크스페이스 전역 룰 — 모든 에이전트 prompt 위에 prepend 됨.
 *  매 턴 prefix 가 같아 provider prompt cache 가 잘 먹히므로 짧게(< 2k 토큰)
 *  유지하면 토큰 비용은 거의 무시할 수준. */
function GlobalRuleSection() {
  const { t } = useI18n();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["settings", "global-rule"],
    queryFn: api.getGlobalRule,
  });

  // local draft — 저장 누르기 전까지 변경 사항을 들고 있음.
  const [draft, setDraft] = useState<string | null>(null);
  const remote = query.data?.content ?? "";
  const value = draft ?? remote;
  const dirty = draft !== null && draft !== remote;

  // 서버 fetch 성공하면 draft 를 cleared 상태로. 다른 곳에서 갱신됐을 때
  // 사용자가 입력 중이 아니면 그 값을 따라가게.
  useEffect(() => {
    if (query.isSuccess && draft === null) {
      // remote 는 이미 value 에 반영됨 — 별도 작업 불필요.
    }
  }, [query.isSuccess, draft]);

  const save = useMutation({
    mutationFn: (content: string) => api.putGlobalRule(content),
    onSuccess: (r) => {
      qc.setQueryData(["settings", "global-rule"], { content: r.settings.globalRule });
      setDraft(null);
      toast.success(t("settings.globalRule.saved"));
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : String(err)),
  });

  return (
    <div className="space-y-1.5 pt-2 border-t">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-foreground">
          {t("settings.globalRule.title")}
        </label>
        <span className="text-[10px] text-muted-foreground/70 mono">
          {value.length}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground/80 leading-snug">
        {t("settings.globalRule.help")}
      </p>
      <textarea
        value={value}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={t("settings.globalRule.placeholder")}
        rows={6}
        className="w-full resize-y rounded-md border bg-background px-2 py-1.5 text-xs font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-foreground/30"
      />
      <div className="flex items-center justify-end gap-2 pt-0.5">
        {dirty ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setDraft(null)}
            disabled={save.isPending}
          >
            {t("common.cancel")}
          </Button>
        ) : null}
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate(draft ?? "")}
        >
          {save.isPending
            ? t("common.saving")
            : t("common.save")}
        </Button>
      </div>
    </div>
  );
}
