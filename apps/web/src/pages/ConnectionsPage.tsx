// v2-core 의 단일 화면 — Connections.
// 이 머신의 CLI 에이전트들을 카드로: 발견(probe) → 인증 → 라이브 모델 → 연동 테스트.
// 모든 데이터는 /api/adapters 4종에서. 영속 상태 없음 — 보이는 게 전부다.

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, Zap } from "lucide-react";
import type { AdapterManifest, TestAdapterResult } from "@loom/core";
import { api } from "../api/client.js";
import { AdapterIcon } from "../components/AdapterIcon.js";
import { Badge, Button, PageShell } from "../components/ui.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

export function ConnectionsPage() {
  const { t } = useI18n();

  const adapters = useQuery({
    queryKey: ["adapters"],
    queryFn: api.listAdapters,
  });

  return (
    <PageShell
      title={t("conn.title")}
      subtitle={t("conn.subtitle")}
      actions={
        // data/ 는 gitignore — 손상·실수 삭제 시 복구 수단이 없어 수동 백업 경로.
        // 앵커 다운로드(브라우저가 파일 저장 처리). office + loom.db + standup/analysis.
        <a
          href="/api/backup"
          download
          className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          title={t("backup.hint")}
        >
          <Download className="size-3.5" />
          {t("backup.export")}
        </a>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
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
    </PageShell>
  );
}

function AdapterCard({ manifest }: { manifest: AdapterManifest }) {
  const { t } = useI18n();
  const [selectedModel, setSelectedModel] = useState("");
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
    // 선택한 모델로 검증. 빈 값이면 CLI 자체 기본 모델 사용.
    mutationFn: () =>
      api.testAdapter(manifest.kind, {
        config: selectedModel ? { model: selectedModel } : {},
      }),
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
  const source = models.data?.models.source;
  // 모델을 카테고리별로 묶어 optgroup 으로.
  const grouped = new Map<string, typeof modelList>();
  for (const m of modelList) {
    const g = m.category ?? "";
    if (!grouped.has(g)) grouped.set(g, []);
    grouped.get(g)!.push(m);
  }

  return (
    <section
      className={cn(
        "relative flex flex-col overflow-hidden rounded-xl border bg-card p-4 transition-shadow",
        ready
          ? "border-primary/25 shadow-[var(--shadow-glow-sm)]"
          : "border-border",
      )}
    >
      {/* 연결 시그니처 — 살아있는 CLI 는 상단 그라데이션 띠 */}
      {ready ? <span className="absolute inset-x-0 top-0 h-0.5 bg-gradient-accent" /> : null}

      {/* 아이덴티티 + 상태 */}
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "relative flex size-10 shrink-0 items-center justify-center rounded-xl border bg-background",
            ready ? "border-primary/40 shadow-[var(--shadow-glow-sm)]" : "border-border opacity-70",
          )}
        >
          <AdapterIcon manifest={manifest} size={24} />
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-card",
              ready ? "animate-pulse bg-success" : binary?.available ? "bg-warning" : "bg-muted-foreground/30",
            )}
          />
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
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground" title={manifest.description}>
            {manifest.description}
          </p>
        </div>
      </div>

      {/* 모델 */}
      <div className="mt-3 flex-1">
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
          <Skeleton className="mt-1.5 h-8 w-full rounded-md" />
        ) : (
          <select
            className="mt-1.5 h-8 w-full rounded-md border border-input bg-background px-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
          >
            <option value="">{t("conn.models.default")}</option>
            {[...grouped.entries()].map(([g, list]) =>
              g ? (
                <optgroup key={g} label={g}>
                  {list.map((m) => (
                    <option key={m.value} value={m.value}>{m.value}</option>
                  ))}
                </optgroup>
              ) : (
                list.map((m) => (
                  <option key={m.value} value={m.value}>{m.value}</option>
                ))
              ),
            )}
          </select>
        )}
      </div>

      {/* 연동 테스트 */}
      <div className="mt-3 border-t border-border/60 pt-2.5">
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
        </div>
        {/* 터미널풍 결과 블록 — CLI 와의 대화라는 정체성을 그대로 */}
        {testResult ? (
          <div className="mt-2.5 rounded-lg border border-border/60 bg-background/80 px-3 py-2 font-mono text-[11px] leading-relaxed">
            <span className="text-muted-foreground">$ {manifest.kind} {selectedModel ? `--model ${selectedModel}` : ""}</span>
            <p className={cn("mt-0.5 break-all", testResult.ok ? "text-success" : "text-destructive")}>
              {testResult.ok
                ? `✓ ${t("conn.test.ok", { sec: (testResult.durationMs / 1000).toFixed(1) })} — “${testResult.output.slice(0, 80)}”`
                : testResult.timedOut
                  ? `✗ ${t("conn.test.timeout")}`
                  : `✗ ${t("conn.test.fail")}: ${(testResult.error || testResult.stderr || `exit ${testResult.exitCode}`).slice(0, 120)}`}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
