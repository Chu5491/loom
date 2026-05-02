import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdapterProbeResult } from "@loom/core";
import { api } from "../api/client.js";
import { useI18n } from "../context/I18nContext.js";

export type StatusTone = "ok" | "warn" | "danger" | "muted";

const TONE_DOT: Record<StatusTone, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  danger: "bg-destructive",
  muted: "bg-muted-foreground/40",
};

const TONE_TEXT: Record<StatusTone, string> = {
  ok: "text-success",
  warn: "text-warning",
  danger: "text-destructive",
  muted: "text-muted-foreground",
};

export function StatusDot({
  tone,
  pulse,
}: {
  tone: StatusTone;
  pulse?: boolean;
}) {
  return (
    <span className="relative inline-flex items-center justify-center size-2">
      {pulse ? (
        <span
          className={`absolute inset-0 rounded-full ${TONE_DOT[tone]} opacity-50 animate-ping`}
        />
      ) : null}
      <span className={`relative size-2 rounded-full ${TONE_DOT[tone]}`} />
    </span>
  );
}

export function StatusLabel({
  tone,
  children,
}: {
  tone: StatusTone;
  children: React.ReactNode;
}) {
  return <span className={`text-xs ${TONE_TEXT[tone]}`}>{children}</span>;
}

/** Map a probe result to (tone, label, hint). */
export function describeProbe(
  probe: AdapterProbeResult | undefined,
  t: (key: string, vars?: Record<string, string | number>) => string,
): { tone: StatusTone; label: string; hint?: string } {
  if (!probe) {
    return { tone: "muted", label: t("adapter.status.checking") };
  }
  if (!probe.binary.available) {
    return {
      tone: "danger",
      label: t("adapter.status.notInstalled"),
      hint: probe.binary.error,
    };
  }
  if (probe.auth.state === "authenticated") {
    return {
      tone: "ok",
      label: t("adapter.status.ready"),
      hint: probe.auth.hint,
    };
  }
  if (probe.auth.state === "unauthenticated") {
    return {
      tone: "warn",
      label: t("adapter.status.signInNeeded"),
      hint: probe.auth.hint,
    };
  }
  return { tone: "muted", label: t("adapter.status.unknown") };
}

/**
 * Live probe display. Loads via /api/adapters/:kind/probe, caches with TanStack
 * Query, refetches every 60s while mounted.
 */
export function AdapterStatusLive({
  kind,
  command,
  showLabel = true,
}: {
  kind: string;
  command?: string;
  showLabel?: boolean;
}) {
  const { t } = useI18n();
  const probe = useQuery({
    queryKey: ["probe", kind, command ?? ""],
    queryFn: () => api.probeAdapter(kind, { command }),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnMount: false,
  });

  const result = probe.data?.probe;
  const desc = describeProbe(result, t);
  const pulsing = !result;

  const title = [
    desc.label,
    result?.binary?.version
      ? t("adapter.probe.versionPrefix", { version: result.binary.version })
      : null,
    desc.hint,
  ]
    .filter(Boolean)
    .join(" — ");

  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={title}
      aria-label={title}
    >
      <StatusDot tone={desc.tone} pulse={pulsing} />
      {showLabel ? <StatusLabel tone={desc.tone}>{desc.label}</StatusLabel> : null}
    </span>
  );
}

/** Manual "re-check" button. Invalidates probe + models for the kind. */
export function AdapterRefreshButton({
  kind,
  command,
}: {
  kind: string;
  command?: string;
}) {
  const qc = useQueryClient();
  const { t } = useI18n();
  const refresh = async () => {
    await Promise.all([
      api.probeAdapter(kind, { command, refresh: true }),
      api.listAdapterModels(kind, { command, refresh: true }),
    ]);
    qc.invalidateQueries({ queryKey: ["probe", kind] });
    qc.invalidateQueries({ queryKey: ["models", kind] });
  };
  return (
    <button
      type="button"
      onClick={refresh}
      title={t("adapter.refresh")}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:text-zinc-900 hover:bg-zinc-100 dark:hover:text-zinc-100 dark:hover:bg-zinc-800"
    >
      <RefreshIcon />
      <span>{t("adapter.refresh")}</span>
    </button>
  );
}

function RefreshIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

export function AdapterStatusDetails({
  probe,
}: {
  probe: AdapterProbeResult | undefined;
}) {
  const { t } = useI18n();
  if (!probe) return null;
  const { binary, auth } = probe;
  return (
    <dl className="text-xs space-y-1">
      <div className="flex gap-2">
        <dt className="w-16 shrink-0 text-muted-foreground uppercase tracking-wide">
          {t("adapter.probe.binary")}
        </dt>
        <dd className="mono break-all">
          {binary.available ? (
            <>
              <span className="text-success">
                ✓ {binary.command}
              </span>
              {binary.version ? (
                <span className="text-zinc-500"> · {binary.version}</span>
              ) : null}
            </>
          ) : (
            <span className="text-destructive">
              ✗ {binary.error ?? t("adapter.probe.notInstalled")}
            </span>
          )}
        </dd>
      </div>
      <div className="flex gap-2">
        <dt className="w-16 shrink-0 text-muted-foreground uppercase tracking-wide">
          {t("adapter.probe.auth")}
        </dt>
        <dd>
          {auth.state === "authenticated" ? (
            <span className="text-success">
              ✓ {t("adapter.probe.authenticated")}
            </span>
          ) : auth.state === "unauthenticated" ? (
            <span className="text-warning">
              ⚠ {t("adapter.probe.signInNeeded")}
            </span>
          ) : (
            <span className="text-zinc-500">— {t("adapter.probe.unknown")}</span>
          )}
          {auth.hint ? (
            <span className="ml-1 text-muted-foreground mono">({auth.hint})</span>
          ) : null}
        </dd>
      </div>
    </dl>
  );
}
