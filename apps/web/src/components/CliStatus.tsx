// 헤더 CLI 상태 — 이 머신에서 인증된 CLI 들의 브랜드 아이콘을 한 줄로.
// 클릭하면 연결 탭으로(상세·테스트는 거기서). probe 는 어댑터별 쿼리, 길게 캐시.

import { useQueries, useQuery } from "@tanstack/react-query";
import { api } from "../api/client.js";
import { useI18n } from "../context/I18nContext.js";
import { AdapterIcon } from "./AdapterIcon.js";
import { cn } from "../lib/utils.js";

export function CliStatus({ onOpenConnections }: { onOpenConnections: () => void }) {
  const { t } = useI18n();
  const adapters = useQuery({ queryKey: ["adapters"], queryFn: api.listAdapters, staleTime: 5 * 60_000 });
  const list = adapters.data?.adapters ?? [];

  const probes = useQueries({
    queries: list.map((m) => ({
      queryKey: ["probe", m.kind],
      queryFn: () => api.probeAdapter(m.kind),
      staleTime: 5 * 60_000,
    })),
  });

  const ready = list.filter((_, i) => {
    const p = probes[i]?.data?.probe;
    return p?.binary?.available && p.auth?.state === "authenticated";
  });

  if (ready.length === 0) return null;

  return (
    <button
      type="button"
      onClick={onOpenConnections}
      title={t("conn.header.tooltip", { count: String(ready.length) })}
      className={cn(
        "hidden items-center gap-0.5 rounded-md border border-border bg-card/60 px-1.5 py-1",
        "transition-colors hover:bg-muted/60 sm:flex",
      )}
    >
      {ready.map((m) => (
        <span key={m.kind} className="flex size-5 items-center justify-center" title={m.displayName}>
          <AdapterIcon manifest={m} size={14} />
        </span>
      ))}
      <span className="ml-0.5 size-1.5 rounded-full bg-success shadow-[0_0_5px_var(--color-success)]" />
    </button>
  );
}
