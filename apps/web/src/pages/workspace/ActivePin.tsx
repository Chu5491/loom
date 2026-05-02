// 채팅 영역 위 작업 컨텍스트 핀.
// 에이전트가 지금 만지고 있는 파일들을 칩으로 표시 — 클릭하면 에디터로 전환.
// 활성 작업이 없으면 렌더 자체를 안 함 (빈 영역으로 자리 차지하지 않게).

import { useMemo } from "react";
import { ArrowUpRight, Radio } from "lucide-react";
import type { Agent } from "@loom/core";
import { AgentInitialBadge } from "../../components/AgentInitialBadge.js";
import { useI18n } from "../../context/I18nContext.js";
import { basename } from "../../lib/path.js";

interface Touch {
  agentId: string;
  paths: string[];
  locations: { path: string; line: number }[];
}

export function ActivePin({
  touches,
  agents,
  onPick,
}: {
  touches: Touch[];
  agents: Agent[];
  onPick: (path: string) => void;
}) {
  const { t } = useI18n();

  // (path, agentId, line?) 1차원으로 평탄화. 같은 path를 여러 에이전트가
  // 만지면 분리된 칩으로 — 누가 어디 손대고 있는지가 핵심 정보.
  const items = useMemo(() => {
    const seen = new Set<string>();
    const flat: { path: string; agentId: string; line?: number }[] = [];
    for (const tch of touches) {
      const lineByPath = new Map<string, number>();
      for (const loc of tch.locations) lineByPath.set(loc.path, loc.line);
      for (const p of tch.paths) {
        const key = `${tch.agentId}::${p}`;
        if (seen.has(key)) continue;
        seen.add(key);
        flat.push({ path: p, agentId: tch.agentId, line: lineByPath.get(p) });
      }
    }
    return flat;
  }, [touches]);

  if (items.length === 0) return null;

  const agentById = new Map(agents.map((a) => [a.id, a]));

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/60 bg-muted/30 shrink-0 overflow-x-auto subtle-scrollbar">
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/80 mr-1 shrink-0">
        <Radio className="size-3 text-success animate-pulse" />
        {t("chat.contextPin.label")}
      </span>
      {items.map((it) => {
        const agent = agentById.get(it.agentId);
        if (!agent) return null;
        return (
          <button
            key={`${it.agentId}::${it.path}`}
            type="button"
            onClick={() => onPick(it.path)}
            title={`${it.path}${it.line ? `:${it.line}` : ""} · @${agent.name}`}
            className="group inline-flex items-center gap-1.5 px-2 h-6 rounded-full border border-border bg-background hover:bg-muted hover:border-foreground/30 transition-colors text-[11px] whitespace-nowrap shrink-0"
          >
            <AgentInitialBadge agent={agent} live size="xs" />
            <span className="mono">{basename(it.path)}</span>
            {it.line ? (
              <span className="text-muted-foreground/70 mono">:{it.line}</span>
            ) : null}
            <ArrowUpRight className="size-3 opacity-50 group-hover:opacity-90 transition-opacity" />
          </button>
        );
      })}
    </div>
  );
}
