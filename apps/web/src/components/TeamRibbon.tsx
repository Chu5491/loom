// 워크스페이스 상단 채널 배너. Slack 스타일: `#project / thread` + working 클러스터.
// 활성 에이전트 아바타가 우측에 stack — motion layout으로 추가/이탈 시 부드럽게 정렬.

import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Hash } from "lucide-react";
import type { Agent, Project, Thread } from "@loom/core";
import { api } from "../api/client.js";
import { AgentAvatar } from "./Chat.js";
import { useI18n } from "../context/I18nContext.js";

const MAX_VISIBLE = 5;

export function TeamRibbon({
  project,
  agents,
  workingIds,
  activeThread,
}: {
  project: Project;
  agents: Agent[];
  workingIds: Set<string>;
  activeThread: Thread | null;
}) {
  const { t } = useI18n();
  const workingAgents = agents.filter((a) => workingIds.has(a.id));
  const workingCount = workingAgents.length;

  // 어댑터 매니페스트는 아바타 아이콘에 필요. 프로젝트마다 한 번만 fetch.
  const adapters = useQuery({
    queryKey: ["adapters"],
    queryFn: api.listAdapters,
  });
  const manifests = adapters.data?.adapters ?? [];

  const visible = workingAgents.slice(0, MAX_VISIBLE);
  const overflow = Math.max(0, workingCount - MAX_VISIBLE);

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-card shrink-0">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Hash className="size-4 text-muted-foreground/70 shrink-0" />
        <div className="flex items-baseline gap-2 min-w-0">
          <span
            className="text-[15px] font-semibold tracking-tight truncate"
            title={project.path}
          >
            {project.name}
          </span>
          {activeThread ? (
            <span
              className="text-xs text-muted-foreground/80 truncate"
              title={activeThread.name}
            >
              {activeThread.name}
            </span>
          ) : null}
        </div>
      </div>

      <AnimatePresence>
        {workingCount > 0 ? (
          <motion.div
            key="working-cluster"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.18 }}
            className="flex items-center gap-2 shrink-0"
          >
            {/* 펄스하는 라이브 도트 — "지금 작동 중" 신호. */}
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-success mono">
              <motion.span
                className="size-1.5 rounded-full bg-emerald-500"
                animate={{ opacity: [1, 0.4, 1], scale: [1, 1.3, 1] }}
                transition={{
                  duration: 1.4,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
              {t("teamRibbon.workingCount", { n: workingCount })}
            </span>
            {/* 아바타 스택 — 겹침 + motion layout으로 join/leave 시 부드럽게 자리 이동. */}
            <div className="flex -space-x-1.5">
              <AnimatePresence initial={false}>
                {visible.map((a) => {
                  const m = manifests.find((mm) => mm.kind === a.adapterKind);
                  return (
                    <motion.div
                      key={a.id}
                      layout
                      initial={{ opacity: 0, scale: 0.7, y: -4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.7, y: -4 }}
                      transition={{
                        type: "spring",
                        stiffness: 500,
                        damping: 32,
                      }}
                      className="ring-2 ring-card rounded-full"
                      title={`@${a.name}`}
                    >
                      <AgentAvatar
                        agent={a}
                        manifest={m}
                        working
                        size="sm"
                      />
                    </motion.div>
                  );
                })}
                {overflow > 0 ? (
                  <motion.span
                    key="overflow"
                    layout
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.7 }}
                    className="size-6 rounded-full ring-2 ring-card bg-muted text-[10px] font-semibold mono inline-flex items-center justify-center text-muted-foreground"
                  >
                    +{overflow}
                  </motion.span>
                ) : null}
              </AnimatePresence>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
