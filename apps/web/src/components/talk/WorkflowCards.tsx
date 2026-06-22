// 워크플로우 진행 보드 — 이 스레드에서 도는 워크플로우 체인의 노드별 상태.
// TalkPage 에서 분리(prop 구동 — 공유 상태 없음).

import { useMemo, useState } from "react";
import { Workflow } from "lucide-react";
import type { RunInfo, WorkflowSpec } from "@loom/core";
import { WorkflowLiveGraph } from "../WorkflowLiveGraph.js";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";

// ── 워크플로우 진행 보드 — 이 스레드에서 도는 워크플로우 체인의 노드별 상태 ─────────
// 실행 중이거나 게이트가 대기 중일 때 채팅 위에 뜨는 스트립. run.workflow/node 태그 기반.
export function WorkflowProgress({ runs, workflows, gates, onGate }: { runs: RunInfo[]; workflows: WorkflowSpec[]; gates: import("@loom/core").WorkflowGate[]; onGate: (id: string, ok: boolean) => void }) {
  const { t } = useI18n();
  // 실행 중인 체인만 — 같은 워크플로우를 여러 번 돌렸어도 parentRunId 루트로
  // 묶어 "이번 실행"만 그린다(역대 run 이 한 줄에 합쳐지는 것 방지).
  const active = useMemo(() => {
    const byId = new Map(runs.map((r) => [r.id, r]));
    const rootOf = (r: RunInfo): string => {
      let cur = r;
      while (cur.parentRunId) {
        const p = byId.get(cur.parentRunId);
        if (!p || p.workflow !== r.workflow) break;
        cur = p;
      }
      return cur.id;
    };
    const chains = new Map<string, { name: string; list: RunInfo[] }>();
    for (const r of runs) {
      if (!r.workflow) continue;
      const key = `${r.workflow}:${rootOf(r)}`;
      const g = chains.get(key) ?? { name: r.workflow, list: [] };
      g.list.push(r);
      chains.set(key, g);
    }
    return [...chains.values()]
      .map(({ name, list }) => ({ name, list: list.sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1)) }))
      // 게이트에서 멈춘 체인은 running run 이 없다 — 게이트가 있으면 같이 살린다.
      .filter(({ name, list }) => list.some((r) => r.status === "running") || gates.some((g) => g.workflow === name));
  }, [runs, gates]);
  if (active.length === 0 && gates.length === 0) return null;

  // 그래프에 노드가 그려지는 체인은 게이트 버튼도 그래프 안에 있다 — 스트립 중복 방지.
  const graphedWorkflows = new Set(active.map((c) => c.name));

  return (
    <div className="space-y-1.5 pt-3">
      {/* 휴먼 게이트 — 사람이 결정할 차례 (그래프 밖의 게이트만 스트립으로) */}
      {gates.filter((g) => !graphedWorkflows.has(g.workflow)).map((g) => (
        <div key={g.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2">
          <span className="text-sm">⏸</span>
          <span className="text-xs font-semibold">{g.workflow}</span>
          <span className="rounded-full border border-warning/40 px-2 py-0.5 text-[10px] font-medium text-warning">{g.nodeId} · {t("talk.gate.waiting")}</span>
          <span className="ml-auto flex gap-1.5">
            <button
              type="button"
              onClick={() => onGate(g.id, true)}
              className="rounded-md border border-success/40 bg-success/10 px-2.5 py-1 text-xs font-medium text-success transition-colors hover:bg-success/20"
            >
              {t("talk.gate.approve")}
            </button>
            <button
              type="button"
              onClick={() => onGate(g.id, false)}
              className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20"
            >
              {t("talk.gate.reject")}
            </button>
          </span>
        </div>
      ))}
      {active.map(({ name, list }) => (
        <WorkflowChainCard
          key={`${name}:${list[0]?.id ?? ""}`}
          name={name}
          list={list}
          wf={workflows.find((w) => w.name === name)}
          gates={gates.filter((g) => g.workflow === name)}
          onGate={onGate}
        />
      ))}
    </div>
  );
}

// 체인 1개 = 진행 칩 스트립 + 접을 수 있는 라이브 그래프(좌표가 있는 정의만).
function WorkflowChainCard({ name, list, wf, gates, onGate }: {
  name: string;
  list: RunInfo[];
  wf?: WorkflowSpec;
  gates: import("@loom/core").WorkflowGate[];
  onGate: (id: string, ok: boolean) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const total = wf?.nodes.length;
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 shadow-[var(--shadow-glow-sm)]">
      <div className="flex flex-wrap items-center gap-2">
        <Workflow className={cn("size-3.5 text-primary", list.some((r) => r.status === "running") && "animate-pulse")} />
        <span className="text-xs font-semibold">{name}</span>
        <span className="text-[10px] text-muted-foreground">
          {t("talk.wfProgress", { done: String(list.filter((r) => r.status !== "running").length), total: String(total ?? list.length) })}
        </span>
        <span className="flex flex-wrap items-center gap-1">
          {list.map((r, i) => (
            <span key={r.id} className="flex items-center gap-1">
              {i > 0 ? <span className="text-[10px] text-muted-foreground">→</span> : null}
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                  r.status === "running"
                    ? "border-primary/50 bg-primary/15 text-primary"
                    : r.status === "succeeded"
                      ? "border-success/40 bg-success/10 text-success"
                      : "border-destructive/40 bg-destructive/10 text-destructive",
                )}
              >
                {r.node ?? "?"} @{r.agent}{r.status === "running" ? " ⋯" : r.status === "succeeded" ? " ✓" : " ✗"}
              </span>
            </span>
          ))}
        </span>
        {wf ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="ml-auto rounded-md border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
          >
            {open ? t("talk.wfGraph.hide") : t("talk.wfGraph.show")}
          </button>
        ) : null}
      </div>
      {wf && open ? (
        <div className="mt-2">
          <WorkflowLiveGraph wf={wf} chainRuns={list} gates={gates} onGate={onGate} />
        </div>
      ) : null}
    </div>
  );
}
