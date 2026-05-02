// 선택된 어댑터의 라이브 상태 + 새로고침 버튼 + 문서 링크 패널.
// 어댑터 카드 아래에 항상 위치.

import { useQuery } from "@tanstack/react-query";
import type { AdapterManifest } from "@loom/core";
import { api } from "../../api/client.js";
import { AdapterIcon } from "../../components/AdapterIcon.js";
import {
  AdapterRefreshButton,
  AdapterStatusDetails,
  AdapterStatusLive,
} from "../../components/AdapterStatus.js";
import { useI18n } from "../../context/I18nContext.js";

export function SelectedAdapterPanel({
  manifest,
  command,
}: {
  manifest: AdapterManifest;
  command: string | undefined;
}) {
  const { t } = useI18n();
  const probe = useQuery({
    queryKey: ["probe", manifest.kind, command ?? ""],
    queryFn: () => api.probeAdapter(manifest.kind, { command }),
    staleTime: 30_000,
  });

  const ready =
    probe.data?.probe.binary.available &&
    probe.data.probe.auth.state === "authenticated";
  const tone = ready
    ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30"
    : "border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20";

  return (
    <section className={`rounded-md border p-3 ${tone}`}>
      <div className="flex items-start gap-3">
        <AdapterIcon manifest={manifest} size={28} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{manifest.displayName}</span>
            <AdapterStatusLive kind={manifest.kind} command={command} />
            <AdapterRefreshButton kind={manifest.kind} command={command} />
            {manifest.docsUrl ? (
              <a
                href={manifest.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-auto text-xs text-sky-700 hover:underline dark:text-sky-300"
              >
                {t("agents.docsLink")} ↗
              </a>
            ) : null}
          </div>
          <div className="mt-2">
            <AdapterStatusDetails probe={probe.data?.probe} />
          </div>
        </div>
      </div>
    </section>
  );
}
