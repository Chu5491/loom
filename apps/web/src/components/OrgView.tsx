// 위임 흐름 트리 — 당신 → 마스터 → 팀원. 마스터가 받은 요청을 팀원에게 위임하면
// 그 트리(parentRunId)가 실시간으로 자란다. 각 노드는 AgentResultCard(트리 모드)로
// 그 위임의 받은 지시·답변·작업량까지 컴팩트하게. 작업 상세(TaskDetail)에서 재사용.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { RunInfo } from "@loom/core";
import { api } from "../api/client.js";
import { AgentResultCard } from "./AgentResult.js";
import { useI18n } from "../context/I18nContext.js";

export function OrgTree({ threadId, adapterOf }: { threadId: string; adapterOf: (name: string) => string }) {
  const { t } = useI18n();
  const runsQ = useQuery({
    queryKey: ["runs", threadId],
    queryFn: () => api.listRuns(threadId),
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  });
  const runs = runsQ.data?.runs ?? [];
  const childrenOf = useMemo(() => {
    const map = new Map<string, RunInfo[]>();
    for (const r of runs) {
      if (!r.parentRunId) continue;
      const g = map.get(r.parentRunId);
      if (g) g.push(r);
      else map.set(r.parentRunId, [r]);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    return (id: string) => map.get(id) ?? [];
  }, [runs]);
  const roots = useMemo(
    () => runs.filter((r) => !r.parentRunId || !runs.some((x) => x.id === r.parentRunId)).sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    [runs],
  );

  if (roots.length === 0) return <p className="text-sm text-muted-foreground">{t("org.starting")}…</p>;
  return (
    <div className="space-y-2">
      {roots.map((r) => (
        <AgentResultCard key={r.id} run={r} adapterOf={adapterOf} role="master" childrenOf={childrenOf} />
      ))}
    </div>
  );
}
