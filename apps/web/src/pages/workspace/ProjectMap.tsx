// ProjectMap — 사무실 자리에 들어가는 새 메인 캔버스.
//
// 픽셀아트 사무실은 귀여웠지만 *프로젝트와 무관*했음. 이건 실제 코드베이스의
// 모양을 그대로 보여주면서, 그 위에 에이전트가 어디서 일하고 있는지 라이브로
// 띄워준다. 초보자한텐 "프로젝트 구조 + AI 활동" 한눈 파악, 시니어한텐
// 빠른 navigation 도구.
//
// Phase 1: 트리. root 직속 dir 들이 자동 펼침. 그 아래는 lazy.
// Phase 2 (예정): treemap — 파일 사이즈/언어로 컬러풀한 타일.

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderTree, RefreshCw } from "lucide-react";
import type {
  ActiveToolsForAgent,
  ActiveTouch,
  Agent,
} from "@loom/core";
import { api } from "../../api/client.js";
import { agentColorOf, classesFor } from "../../components/agentColor.js";
import { AgentInitialBadge } from "../../components/AgentInitialBadge.js";
import { FilesTree } from "../../components/FilesTree.js";
import { useI18n } from "../../context/I18nContext.js";
import { basename } from "../../lib/path.js";
import { cn } from "../../lib/utils.js";

export function ProjectMap({
  projectId,
  projectName,
  agents,
  workingIds,
  touchingIds,
  activeTouches,
  activeTools,
  onPickFile,
  onPickAgent,
}: {
  projectId: string;
  projectName: string;
  agents: Agent[];
  /** 어떤 에이전트가 지금 run 중인지 — 이름 옆 dot. */
  workingIds: Set<string>;
  /** 어떤 에이전트가 *지금 파일을 만지고 있는지* — touching dot. */
  touchingIds: Set<string>;
  activeTouches: ActiveTouch[];
  activeTools: ActiveToolsForAgent[];
  /** 트리에서 파일 클릭 — 에디터 모드로 전환되며 그 파일을 연다. */
  onPickFile: (path: string) => void;
  /** 활성 활동 칩 클릭 — 채팅 composer 의 타깃 에이전트를 그 사람으로. */
  onPickAgent: (id: string) => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();

  // 누적 터치 — 파일 옆 dot 으로 "여기 누가 작업한 적 있다" 표시. 30초 간격
  // 정도면 충분 (실시간성은 active-touches 가 담당).
  const touched = useQuery({
    queryKey: ["projectTouched", projectId],
    queryFn: () => api.getProjectTouched(projectId),
    refetchInterval: 30_000,
  });

  // path → 마지막 토커 id. FilesTree 가 dot 컬러 결정용으로 사용.
  const touchedMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const tp of touched.data?.paths ?? []) m.set(tp.path, tp.lastAgentId);
    return m;
  }, [touched.data]);

  // 지금 만지고 있는 파일 → 에이전트 id. FilesTree 가 pulse 처리.
  const activeByAgent = useMemo(() => {
    const m = new Map<string, string>();
    for (const tch of activeTouches) {
      for (const p of tch.paths) m.set(p, tch.agentId);
    }
    return m;
  }, [activeTouches]);

  // "지금 활동 중" 헤더 칩 — 에이전트 + 그가 만지는 파일 + 도구 1개.
  const liveChips = useMemo(() => {
    type Chip = {
      agent: Agent;
      filePath: string | null;
      toolName: string | null;
    };
    const chips: Chip[] = [];
    const seen = new Set<string>();
    for (const tch of activeTouches) {
      const a = agents.find((x) => x.id === tch.agentId);
      if (!a || seen.has(a.id)) continue;
      seen.add(a.id);
      const tool = activeTools.find((x) => x.agentId === a.id);
      const latest = tool?.recent[tool.recent.length - 1];
      chips.push({
        agent: a,
        filePath: tch.paths[0] ?? null,
        toolName: latest?.name ?? null,
      });
    }
    // touching 안 하는데 working 인 에이전트도 칩으로 — "thinking 중" 표시.
    for (const a of agents) {
      if (seen.has(a.id) || !workingIds.has(a.id)) continue;
      seen.add(a.id);
      chips.push({ agent: a, filePath: null, toolName: null });
    }
    return chips;
  }, [activeTouches, activeTools, agents, workingIds]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["projectTree", projectId] });
    qc.invalidateQueries({ queryKey: ["projectTouched", projectId] });
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* 상단 — 프로젝트 라벨 + 라이브 활동 칩 라인. 사무실의 "지금 책상에 앉은
          사람" 시각 자리를 칩으로 대체. 한 줄에 다 안 들어가면 가로 스크롤. */}
      <header className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-border bg-muted/20">
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          <FolderTree className="size-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-semibold truncate" title={projectName}>
            {projectName}
          </span>
        </div>
        <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto subtle-scrollbar">
          {liveChips.length === 0 ? (
            <span className="text-[11px] text-muted-foreground/60 italic shrink-0">
              {t("map.idle")}
            </span>
          ) : (
            liveChips.map((c) => (
              <LiveChip
                key={c.agent.id}
                agent={c.agent}
                filePath={c.filePath}
                toolName={c.toolName}
                onClick={() => onPickAgent(c.agent.id)}
                onPickFile={onPickFile}
                touching={touchingIds.has(c.agent.id)}
              />
            ))
          )}
        </div>
        <button
          type="button"
          onClick={refresh}
          title={t("map.refresh")}
          aria-label={t("map.refresh")}
          className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        >
          <RefreshCw
            className={cn(
              "size-3.5",
              (touched.isFetching || touched.isPending) && "animate-spin",
            )}
          />
        </button>
      </header>

      {/* 본문 — 트리. canvas 답게 패딩 살짝 더 줘서 책장 처럼 보이게.
          max-w-3xl 로 너무 넓은 모니터에서 한쪽으로 안 쏠리게. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-3 py-3">
          <FilesTree
            projectId={projectId}
            selectedPath={null}
            touched={touchedMap}
            activeByAgent={activeByAgent}
            agents={agents}
            onPick={onPickFile}
            defaultOpenDepth={1}
            staleTime={5_000}
          />
        </div>
      </div>
    </div>
  );
}

// 라이브 칩 — "@A · src/foo.ts" 같이 한 줄. 클릭하면 그 에이전트 채팅 타깃,
// 파일명 부분만 따로 클릭하면 그 파일 에디터로.
function LiveChip({
  agent,
  filePath,
  toolName,
  touching,
  onClick,
  onPickFile,
}: {
  agent: Agent;
  filePath: string | null;
  toolName: string | null;
  touching: boolean;
  onClick: () => void;
  onPickFile: (path: string) => void;
}) {
  const cls = classesFor(agentColorOf(agent));
  const fileLabel = filePath ? basename(filePath) : null;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`@${agent.name}${filePath ? " · " + filePath : ""}${toolName ? " · " + toolName : ""}`}
      className={cn(
        "group inline-flex items-center gap-1.5 h-6 px-1.5 rounded-full border text-[11px] transition-colors shrink-0",
        cls.bgSoft,
        cls.border,
        "hover:bg-foreground/5",
      )}
    >
      <AgentInitialBadge agent={agent} live={touching} size="xs" />
      <span className={cn("font-medium truncate max-w-[8rem]", cls.text)}>
        @{agent.name}
      </span>
      {fileLabel && filePath ? (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onPickFile(filePath);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              onPickFile(filePath);
            }
          }}
          className="text-muted-foreground/80 mono truncate max-w-[10rem] hover:text-foreground hover:underline cursor-pointer"
        >
          {fileLabel}
        </span>
      ) : toolName ? (
        <span className="text-muted-foreground/70 mono truncate max-w-[10rem]">
          {toolName}
        </span>
      ) : null}
    </button>
  );
}
