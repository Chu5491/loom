// 마켓플레이스 dialog 안에 inline 으로 박는 API 키 관리.
//
// "키 없음 → tab 회색 + tooltip" 만으론 사용자가 *어디서 키를 넣어야 하는지*
// 모르는 마찰이 컸음. 이 컴포넌트는 그 자리에서 바로:
//   - 미설정 → 작은 banner + [Set key] inline 입력
//   - DB 에 저장됨 → "Saved" badge + Replace / Clear
//   - env 에서 → "from env" badge + read-only 안내
//
// 같은 컴포넌트를 MCP (smithery) 와 Skill (skills.sh) dialog 가 공유.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Key, X } from "lucide-react";
import { toast } from "sonner";
import { api, type ApiKeyStatus } from "../../api/client.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";

type Provider = "smithery" | "skillsSh";

interface ProviderMeta {
  label: string;
  /** 키 발급 안내 — 설명 + 외부 링크. */
  obtainHint: string;
  obtainUrl?: string;
  /** 저장 mutation 의 body 만들기. */
  toBody: (value: string | null) => Parameters<typeof api.putApiKeys>[0];
}

const PROVIDERS: Record<Provider, ProviderMeta> = {
  smithery: {
    label: "smithery",
    obtainHint: "Sign up at smithery.ai for an API key.",
    obtainUrl: "https://smithery.ai",
    toBody: (v) => ({ smithery: v }),
  },
  skillsSh: {
    label: "skills.sh",
    obtainHint: "Email skills-api@vercel.com to request a key.",
    obtainUrl: "mailto:skills-api@vercel.com",
    toBody: (v) => ({ skillsSh: v }),
  },
};

export function InlineApiKey({
  provider,
  /** 카드 위에 얹는 banner 모드 — 키 미설정일 때 마켓플레이스 dialog 의 비활성
   *  source 탭 자리에 떠서 사용자를 키 입력으로 유도. */
  variant = "banner",
}: {
  provider: Provider;
  variant?: "banner" | "row";
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const meta = PROVIDERS[provider];

  const status = useQuery({
    queryKey: ["settings", "api-keys"],
    queryFn: api.getApiKeys,
  });

  const save = useMutation({
    mutationFn: (value: string | null) => api.putApiKeys(meta.toBody(value)),
    onSuccess: (next) => {
      qc.setQueryData(["settings", "api-keys"], next);
      qc.invalidateQueries({ queryKey: ["mcp-marketplace"] });
      qc.invalidateQueries({ queryKey: ["skill-marketplace"] });
      toast.success(t("settings.apiKeys.saved"));
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : String(err)),
  });

  const s: ApiKeyStatus | undefined = status.data?.[provider];
  const isEnv = s?.source === "env";
  const isDb = s?.source === "db";
  const configured = !!s?.configured;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  // env 에서 키가 오면 사용자가 UI 에서 못 바꿈 — 명시 안내.
  if (isEnv) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 text-[11px] text-muted-foreground/80",
          variant === "banner"
            ? "rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5"
            : "",
        )}
      >
        <Key className="size-3 shrink-0" />
        <span className="font-medium">{meta.label}</span>
        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
          {t("settings.apiKeys.fromEnvBadge")}
        </span>
        <span className="truncate">{t("settings.apiKeys.fromEnv")}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 text-[11px]",
        variant === "banner"
          ? "rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-1.5"
          : "",
      )}
    >
      <Key
        className={cn(
          "size-3 shrink-0",
          configured ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400",
        )}
      />
      <span className="font-medium">{meta.label}</span>
      {configured ? (
        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
          {t("settings.apiKeys.configured")}
        </span>
      ) : (
        <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400">
          {t("settings.apiKeys.notConfigured")}
        </span>
      )}

      {editing ? (
        <div className="flex w-full items-center gap-1.5 mt-1.5 sm:mt-0 sm:w-auto sm:flex-1 sm:min-w-[16rem]">
          <Input
            type="password"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("settings.apiKeys.placeholder")}
            className="h-7 text-xs mono"
            disabled={save.isPending}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim() && !save.isPending) {
                save.mutate(draft);
                setEditing(false);
                setDraft("");
              } else if (e.key === "Escape") {
                setEditing(false);
                setDraft("");
              }
            }}
          />
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={!draft.trim() || save.isPending}
            onClick={() => {
              save.mutate(draft);
              setEditing(false);
              setDraft("");
            }}
          >
            {save.isPending ? t("common.saving") : t("common.save")}
          </Button>
          <button
            type="button"
            onClick={() => {
              setDraft("");
              setEditing(false);
            }}
            disabled={save.isPending}
            className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted"
            aria-label={t("common.cancel")}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1 ml-auto">
          {!configured && meta.obtainUrl ? (
            <a
              href={meta.obtainUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/80 hover:text-foreground"
              title={meta.obtainHint}
            >
              {t("settings.apiKeys.howToGet")}
              <ExternalLink className="size-2.5" />
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setDraft("");
              setEditing(true);
            }}
            className="rounded px-1.5 py-0.5 text-[11px] text-foreground hover:bg-muted/60 transition-colors"
          >
            {isDb
              ? t("settings.apiKeys.replace")
              : t("settings.apiKeys.set")}
          </button>
          {isDb ? (
            <button
              type="button"
              onClick={() => save.mutate(null)}
              disabled={save.isPending}
              className="rounded px-1.5 py-0.5 text-[11px] text-destructive hover:bg-destructive/10 transition-colors"
            >
              {t("settings.apiKeys.clear")}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
