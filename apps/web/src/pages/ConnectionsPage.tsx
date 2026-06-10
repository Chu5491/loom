// v2-core 의 단일 화면 — Connections.
// 이 머신의 CLI 에이전트들을 카드로: 발견(probe) → 인증 → 라이브 모델 → 연동 테스트.
// 모든 데이터는 /api/adapters 4종에서. 영속 상태 없음 — 보이는 게 전부다.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Languages, Moon, RefreshCw, Sun, Zap } from "lucide-react";
import type { AdapterManifest, TestAdapterResult } from "@loom/core";
import { api } from "../api/client.js";
import { AdapterIcon } from "../components/AdapterIcon.js";
import { LoomLogo } from "../components/LoomLogo.js";
import { Badge, Button } from "../components/ui.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { useI18n } from "../context/I18nContext.js";
import { useTheme } from "../context/ThemeContext.js";
import { cn } from "../lib/utils.js";

export function ConnectionsPage() {
  const { t, lang, setLang } = useI18n();
  const { effective, setMode } = useTheme();
  const qc = useQueryClient();

  const adapters = useQuery({
    queryKey: ["adapters"],
    queryFn: api.listAdapters,
  });

  return (
    <div className="min-h-full bg-background">
      {/* 헤더 — 글래스 바 + 브랜드 + 토글 */}
      <header className="sticky top-0 z-10 border-b border-border bg-card/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <LoomLogo className="size-6 dark:invert" />
          <span className="font-display text-base font-semibold">
            {t("app.title")}
          </span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {t("app.tagline")}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-label="theme"
              onClick={() => setMode(effective === "dark" ? "light" : "dark")}
            >
              {effective === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="language"
              onClick={() => setLang(lang === "ko" ? "en" : "ko")}
            >
              <Languages className="size-4" />
              <span className="text-xs uppercase">{lang}</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                qc.invalidateQueries();
              }}
            >
              <RefreshCw className="size-3.5" />
              {t("conn.refreshAll")}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          {t("conn.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("conn.subtitle")}</p>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {adapters.isLoading
            ? [0, 1, 2, 3].map((i) => (
                <div key={i} className="rounded-xl border border-border bg-card p-5">
                  <div className="flex items-center gap-3">
                    <Skeleton className="size-10 rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-48" />
                    </div>
                  </div>
                </div>
              ))
            : (adapters.data?.adapters ?? []).map((m) => (
                <AdapterCard key={m.kind} manifest={m} />
              ))}
        </div>

        {adapters.isError ? (
          <p className="mt-6 text-sm text-destructive">{adapters.error.message}</p>
        ) : null}
      </main>
    </div>
  );
}

function AdapterCard({ manifest }: { manifest: AdapterManifest }) {
  const { t } = useI18n();
  const [showAllModels, setShowAllModels] = useState(false);
  const [testResult, setTestResult] = useState<TestAdapterResult | null>(null);

  const probe = useQuery({
    queryKey: ["probe", manifest.kind],
    queryFn: () => api.probeAdapter(manifest.kind),
    staleTime: 30_000,
  });
  const models = useQuery({
    queryKey: ["models", manifest.kind],
    queryFn: () => api.listAdapterModels(manifest.kind),
    staleTime: 5 * 60_000,
  });

  const test = useMutation({
    mutationFn: () =>
      api.testAdapter(manifest.kind, { config: manifest.defaultConfig }),
    onSuccess: (r) => setTestResult(r.test),
    onError: (err) =>
      setTestResult({
        ok: false,
        durationMs: 0,
        exitCode: null,
        output: "",
        stderr: "",
        error: err instanceof Error ? err.message : String(err),
      }),
  });

  const binary = probe.data?.probe.binary;
  const auth = probe.data?.probe.auth;
  const ready = !!binary?.available && auth?.state === "authenticated";
  const modelList = models.data?.models.models ?? [];
  const visibleModels = showAllModels ? modelList : modelList.slice(0, 6);
  const source = models.data?.models.source;

  return (
    <section
      className={cn(
        "flex flex-col rounded-xl border bg-card p-5 transition-shadow",
        ready
          ? "border-primary/25 shadow-[var(--shadow-glow-sm)]"
          : "border-border",
      )}
    >
      {/* 아이덴티티 + 상태 */}
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
          <AdapterIcon manifest={manifest} size={24} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-sm font-semibold">
              {manifest.displayName}
            </h2>
            {probe.isLoading ? (
              <span className="text-xs text-muted-foreground">
                {t("common.checking")}
              </span>
            ) : (
              <>
                <Badge tone={binary?.available ? "success" : "neutral"}>
                  {binary?.available
                    ? binary.version
                      ? `v${binary.version}`
                      : t("conn.binary.installed")
                    : t("conn.binary.missing")}
                </Badge>
                <Badge
                  tone={
                    auth?.state === "authenticated"
                      ? "success"
                      : auth?.state === "unauthenticated"
                        ? "warn"
                        : "neutral"
                  }
                >
                  {t(`conn.auth.${auth?.state ?? "unknown"}`)}
                </Badge>
              </>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {manifest.description}
          </p>
        </div>
      </div>

      {/* 모델 */}
      <div className="mt-4 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("conn.models.title")}
          </span>
          {source ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[11px]",
                source === "live"
                  ? "text-success"
                  : source === "error"
                    ? "text-warning"
                    : "text-muted-foreground",
              )}
              title={models.data?.models.hint}
            >
              {source === "live" ? (
                <span className="size-1.5 rounded-full bg-success shadow-[0_0_6px_var(--color-success)]" />
              ) : null}
              {t(`conn.models.${source}`)}
              {source !== "presets" || modelList.length ? ` · ${modelList.length}` : ""}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => models.refetch()}
            className="ml-auto text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("conn.models.refresh")}
          </button>
        </div>

        {models.isLoading ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-6 w-24 rounded-md" />
            ))}
          </div>
        ) : modelList.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("conn.models.empty")}
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {visibleModels.map((m) => (
              <span
                key={m.value}
                title={m.description ?? m.value}
                className="rounded-md border border-border bg-background px-2 py-0.5 font-mono text-[11px] text-foreground/80"
              >
                {m.value}
              </span>
            ))}
            {modelList.length > 6 ? (
              <button
                type="button"
                onClick={() => setShowAllModels((v) => !v)}
                className="rounded-md px-2 py-0.5 text-[11px] text-primary transition-colors hover:bg-primary/10"
              >
                {showAllModels
                  ? t("conn.models.showLess")
                  : t("conn.models.showAll", { count: modelList.length })}
              </button>
            ) : null}
          </div>
        )}
      </div>

      {/* 연동 테스트 */}
      <div className="mt-4 border-t border-border pt-3">
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            disabled={!ready || test.isPending}
            onClick={() => test.mutate()}
            className={cn(!ready && "opacity-50")}
            title={ready ? undefined : t("conn.test.notReady")}
          >
            <Zap className="size-3.5" />
            {test.isPending ? t("conn.test.running") : t("conn.test.run")}
          </Button>
          {testResult ? (
            <span
              className={cn(
                "min-w-0 truncate text-xs",
                testResult.ok ? "text-success" : "text-destructive",
              )}
              title={testResult.output || testResult.stderr || testResult.error}
            >
              {testResult.ok
                ? `${t("conn.test.ok", { sec: (testResult.durationMs / 1000).toFixed(1) })} — “${testResult.output.slice(0, 60)}”`
                : `${t("conn.test.fail")}: ${(testResult.error || testResult.stderr || `exit ${testResult.exitCode}`).slice(0, 80)}`}
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
