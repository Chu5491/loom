// 에이전트 아바타 = 그 에이전트가 쓰는 CLI 도구의 브랜드 아이콘.
// (이름해시 글자 대신 — 어떤 CLI인지 한눈에. 같은 어댑터면 이름 라벨로 구분.)

import { useQuery } from "@tanstack/react-query";
import type { AdapterKind } from "@loom/core";
import { api } from "../api/client.js";
import { AdapterIcon } from "./AdapterIcon.js";
import { cn } from "../lib/utils.js";

export function AgentAvatar({ adapter, size = 36, className }: { adapter: AdapterKind; size?: number; className?: string }) {
  const adapters = useQuery({ queryKey: ["adapters"], queryFn: api.listAdapters, staleTime: 5 * 60_000 });
  const manifest = adapters.data?.adapters.find((m) => m.kind === adapter);
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-xl border border-border bg-background", className)}
      style={{ width: size, height: size }}
    >
      {manifest ? (
        <AdapterIcon manifest={manifest} size={Math.round(size * 0.62)} />
      ) : (
        <span className="font-mono text-xs text-muted-foreground">{adapter.charAt(0).toUpperCase()}</span>
      )}
    </span>
  );
}
