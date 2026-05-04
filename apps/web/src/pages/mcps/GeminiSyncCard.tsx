// Gemini settings.json 자동 동기화 카드. McpsPage 상단에 배치.
//
// 흐름 (하이브리드: B 자동 + A 수동 폴백):
//   - 기본: enabled. 카탈로그 변경 시 ~/.gemini/settings.json 안전 머지.
//   - 사용자가 토글로 OFF 가능. OFF면 자동 동기화 멈추고 카드는 "수동 모드"로
//     스니펫 + 복사 버튼을 노출. 사용자는 직접 settings.json에 붙여넣음.
//   - 충돌(같은 이름이 사용자에 의해 미리 등록됨) 발생 시 카드에 경고 + 해당
//     서버는 동기화 보류. 사용자가 충돌하는 이름을 catalog에서 바꾸거나
//     settings에서 빼야 진행됨.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  ClipboardCheck,
  RefreshCw,
} from "lucide-react";
import { api } from "../../api/client.js";
import { Button, Card } from "../../components/ui.js";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";
import { formatTimeAgo } from "../../lib/timeAgo.js";

export function GeminiSyncCard() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [showSnippet, setShowSnippet] = useState(false);
  const [copied, setCopied] = useState(false);

  const status = useQuery({
    queryKey: ["gemini-sync-status"],
    queryFn: api.getGeminiSyncStatus,
    refetchInterval: 15_000,
  });

  const snippet = useQuery({
    queryKey: ["gemini-sync-snippet"],
    queryFn: api.getGeminiSnippet,
    enabled: showSnippet || (status.data?.status.enabled === false),
  });

  const toggle = useMutation({
    mutationFn: (next: boolean) => api.setGeminiSyncEnabled(next),
    onSuccess: (r) => {
      qc.setQueryData(["gemini-sync-status"], { status: r.status });
      toast.success(
        r.status.enabled
          ? t("gemini.toast.enabled")
          : t("gemini.toast.disabled"),
      );
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : String(err)),
  });

  const forceSync = useMutation({
    mutationFn: () => api.runGeminiSync(true),
    onSuccess: (r) => {
      qc.setQueryData(["gemini-sync-status"], { status: r.status });
      const { report } = r;
      if (!report.ok) {
        toast.error(t("gemini.toast.syncFailed", { error: report.error ?? "" }));
      } else if (report.skipped === "disabled") {
        toast.info(t("gemini.toast.syncSkipped"));
      } else {
        const summary = [
          report.addedToSettings.length
            ? t("gemini.toast.added", { n: report.addedToSettings.length })
            : null,
          report.removedFromSettings.length
            ? t("gemini.toast.removed", { n: report.removedFromSettings.length })
            : null,
          report.conflicts.length
            ? t("gemini.toast.conflicts", { n: report.conflicts.length })
            : null,
        ]
          .filter(Boolean)
          .join(" · ");
        toast.success(summary || t("gemini.toast.synced"));
      }
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : String(err)),
  });

  if (status.isLoading || !status.data) {
    return (
      <Card className="text-xs text-muted-foreground">
        {t("common.loading")}
      </Card>
    );
  }

  const s = status.data.status;
  const enabled = s.enabled;
  const hasConflicts = s.conflicts.length > 0;

  const onCopy = async () => {
    if (!snippet.data) return;
    try {
      await navigator.clipboard.writeText(snippet.data.snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error(t("gemini.toast.copyFailed"));
    }
  };

  return (
    <Card className="space-y-3">
      <header className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            "mt-0.5 inline-flex size-7 items-center justify-center rounded text-white shrink-0",
            enabled
              ? "bg-emerald-600 dark:bg-emerald-500"
              : "bg-muted text-muted-foreground",
          )}
        >
          {enabled ? (
            <CheckCircle2 className="size-4" />
          ) : (
            <RefreshCw className="size-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            {t("gemini.title")}
            <span
              className={cn(
                "text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded",
                enabled
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {enabled ? t("gemini.status.on") : t("gemini.status.off")}
            </span>
          </h2>
          <p className="text-[11px] text-muted-foreground/80 mt-0.5">
            {enabled ? t("gemini.subtitle.on") : t("gemini.subtitle.off")}
          </p>
          <p className="mt-1 text-[10px] mono text-muted-foreground/60 truncate">
            {s.settingsPath}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {enabled ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1"
              disabled={forceSync.isPending}
              onClick={() => forceSync.mutate()}
              title={t("gemini.action.resync")}
            >
              <RefreshCw
                className={cn(
                  "size-3.5",
                  forceSync.isPending && "animate-spin",
                )}
              />
              {t("gemini.action.resync")}
            </Button>
          ) : null}
          <Button
            variant={enabled ? "ghost" : "primary"}
            size="sm"
            className="h-7"
            onClick={() => toggle.mutate(!enabled)}
            disabled={toggle.isPending}
          >
            {enabled ? t("gemini.action.disable") : t("gemini.action.enable")}
          </Button>
        </div>
      </header>

      {/* 동기화 통계 한 줄. */}
      {enabled ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <Stat
            label={t("gemini.stat.loom")}
            value={s.loomManagedNames.length}
            tone="primary"
          />
          <Stat
            label={t("gemini.stat.user")}
            value={s.userManagedNames.length}
          />
          <Stat
            label={t("gemini.stat.conflicts")}
            value={s.conflicts.length}
            tone={hasConflicts ? "warn" : "muted"}
          />
          {s.lastSyncedAt ? (
            <span className="ml-auto mono text-muted-foreground/70">
              {t("gemini.stat.lastSynced", {
                ago: formatTimeAgo(s.lastSyncedAt, t),
              })}
            </span>
          ) : (
            <span className="ml-auto text-muted-foreground/60 italic">
              {t("gemini.stat.never")}
            </span>
          )}
        </div>
      ) : null}

      {/* 충돌 경고 — 사용자가 같은 이름을 settings에 미리 등록한 경우. */}
      {hasConflicts ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <AlertTriangle className="size-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
          <div className="text-[11px] flex-1">
            <p className="font-medium text-amber-700 dark:text-amber-300">
              {t("gemini.conflict.title", { n: s.conflicts.length })}
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {t("gemini.conflict.body")}
            </p>
            <ul className="mt-1.5 flex flex-wrap gap-1">
              {s.conflicts.map((name) => (
                <li
                  key={name}
                  className="inline-flex items-center px-1.5 h-5 rounded bg-amber-500/10 text-amber-800 dark:text-amber-200 text-[10px] mono"
                >
                  {name}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {/* 마지막 sync error. */}
      {s.lastError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
          {s.lastError}
        </div>
      ) : null}

      {/* 수동 모드 폴백 (B의 A 폴백) — 토글 OFF일 때 또는 사용자가 펼칠 때 노출. */}
      {!enabled || showSnippet ? (
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              {t("gemini.snippet.hint")}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 text-[11px]"
              onClick={onCopy}
              disabled={!snippet.data}
            >
              {copied ? (
                <>
                  <ClipboardCheck className="size-3" />
                  {t("gemini.snippet.copied")}
                </>
              ) : (
                <>
                  <Clipboard className="size-3" />
                  {t("gemini.snippet.copy")}
                </>
              )}
            </Button>
          </div>
          <pre className="text-[10px] mono text-muted-foreground bg-card border border-border/50 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto">
            {snippet.data?.snippet ?? t("common.loading")}
          </pre>
        </div>
      ) : (
        <div className="flex items-center justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[11px] text-muted-foreground"
            onClick={() => setShowSnippet(true)}
          >
            {t("gemini.snippet.show")}
          </Button>
        </div>
      )}
    </Card>
  );
}

function Stat({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: number;
  tone?: "primary" | "warn" | "muted";
}) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span
        className={cn(
          "mono font-semibold tabular-nums",
          tone === "primary" && "text-foreground",
          tone === "warn" && "text-amber-700 dark:text-amber-300",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </span>
      <span className="text-muted-foreground/70">{label}</span>
    </span>
  );
}
