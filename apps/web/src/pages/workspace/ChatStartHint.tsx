// 프로젝트에 에이전트는 있지만 첫 스레드가 아직 없을 때의 빈 상태.
// "비어 있는 에디터" 대신 "이미 자리 잡은 채널"을 보여주는 게 목적.

import { Suspense, lazy } from "react";
import type { AdapterManifest, Agent } from "@loom/core";
import { useI18n } from "../../context/I18nContext.js";
import { AgentAvatar } from "../../components/Chat.js";

// tsparticles는 빈 상태 진입 시에만 fetch — 메인 번들에서 빠짐.
const EmptyParticles = lazy(() =>
  import("../../components/EmptyParticles.js").then((m) => ({
    default: m.EmptyParticles,
  })),
);

export function ChatStartHint({
  agents,
  manifests,
}: {
  agents: Agent[];
  manifests: AdapterManifest[];
}) {
  const { t } = useI18n();
  return (
    <div className="relative px-4 py-12 text-center overflow-hidden">
      <Suspense fallback={null}>
        <EmptyParticles className="absolute inset-0 -z-10 opacity-60" />
      </Suspense>
      <div className="inline-flex flex-wrap items-center justify-center gap-1.5 mb-4">
        {agents.slice(0, 6).map((a) => (
          <span
            key={a.id}
            className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 pl-1 pr-2 py-0.5 text-xs"
          >
            <AgentAvatar
              agent={a}
              manifest={manifests.find((m) => m.kind === a.adapterKind)}
              size="sm"
            />
            <span className="font-medium">@{a.name}</span>
          </span>
        ))}
      </div>
      <h3 className="text-base font-semibold tracking-tight">
        {t("chat.empty.firstMessage")}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("chat.start.hint")}
      </p>
    </div>
  );
}
