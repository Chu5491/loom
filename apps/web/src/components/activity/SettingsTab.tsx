// 사이드 패널 — 테마/언어/워크스페이스 룰/서버 상태 + 빌드 정보.

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../../api/client.js";
import { LoomLogo } from "../LoomLogo.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
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

        <ApiKeysSection />

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

/** External API keys — 마켓플레이스 source 들의 인증 키.
 *
 *  보안:
 *   - 서버는 raw 값을 클라에 절대 안 보냄. status (configured + source) 만.
 *   - input 은 type="password" — 화면에 안 비치게.
 *   - 빈 문자열 저장 = clear (NULL).
 *   - source 가 "env" 면 사용자가 환경변수로 넣은 거 — UI 가 read-only 안내.
 */
function ApiKeysSection() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["settings", "api-keys"],
    queryFn: api.getApiKeys,
  });

  const save = useMutation({
    mutationFn: (body: { smithery?: string | null; skillsSh?: string | null }) =>
      api.putApiKeys(body),
    onSuccess: (next) => {
      qc.setQueryData(["settings", "api-keys"], next);
      // 마켓플레이스 dialogs 의 source 활성 상태도 갱신해야 함.
      qc.invalidateQueries({ queryKey: ["mcp-marketplace"] });
      qc.invalidateQueries({ queryKey: ["skill-marketplace"] });
      toast.success(t("settings.apiKeys.saved"));
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : String(err)),
  });

  return (
    <div className="pt-2 border-t space-y-3">
      <label className="text-xs font-medium text-foreground block">
        {t("settings.apiKeys.title")}
      </label>
      <p className="text-[11px] text-muted-foreground/80 leading-snug">
        {t("settings.apiKeys.help")}
      </p>
      <ApiKeyRow
        label="smithery"
        hint={t("settings.apiKeys.smitheryHint")}
        status={status.data?.smithery}
        onSave={(v) => save.mutate({ smithery: v })}
        onClear={() => save.mutate({ smithery: null })}
        busy={save.isPending}
      />
      <ApiKeyRow
        label="skills.sh"
        hint={t("settings.apiKeys.skillsShHint")}
        status={status.data?.skillsSh}
        onSave={(v) => save.mutate({ skillsSh: v })}
        onClear={() => save.mutate({ skillsSh: null })}
        busy={save.isPending}
      />
    </div>
  );
}

function ApiKeyRow({
  label,
  hint,
  status,
  onSave,
  onClear,
  busy,
}: {
  label: string;
  hint: string;
  status: { configured: boolean; source: "db" | "env" | "none" } | undefined;
  onSave: (value: string) => void;
  onClear: () => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);

  const isEnv = status?.source === "env";
  const isDb = status?.source === "db";

  return (
    <div className="rounded-md border border-border/70 p-2.5 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="mono text-xs font-semibold">{label}</span>
        <StatusPill status={status} />
        <span className="ml-auto text-[10px] text-muted-foreground/70">
          {hint}
        </span>
      </div>
      {isEnv ? (
        <p className="text-[11px] text-muted-foreground/80 italic">
          {t("settings.apiKeys.fromEnv")}
        </p>
      ) : null}
      {editing ? (
        <div className="flex items-center gap-1.5">
          <Input
            type="password"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("settings.apiKeys.placeholder")}
            className="h-7 text-xs mono"
            disabled={busy}
          />
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={!draft.trim() || busy}
            onClick={() => {
              onSave(draft);
              setDraft("");
              setEditing(false);
            }}
          >
            {busy ? t("common.saving") : t("common.save")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            disabled={busy}
            onClick={() => {
              setDraft("");
              setEditing(false);
            }}
          >
            {t("common.cancel")}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            {isDb
              ? t("settings.apiKeys.replace")
              : t("settings.apiKeys.set")}
          </Button>
          {isDb ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-destructive"
              disabled={busy}
              onClick={onClear}
            >
              {t("settings.apiKeys.clear")}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function StatusPill({
  status,
}: {
  status: { configured: boolean; source: "db" | "env" | "none" } | undefined;
}) {
  const { t } = useI18n();
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/50 px-1.5 py-0.5 rounded bg-muted/40">
        ···
      </span>
    );
  }
  if (!status.configured) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 px-1.5 py-0.5 rounded bg-muted/60">
        {t("settings.apiKeys.notConfigured")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded bg-emerald-500/10">
      {status.source === "env"
        ? t("settings.apiKeys.fromEnvBadge")
        : t("settings.apiKeys.configured")}
    </span>
  );
}
