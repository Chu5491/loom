// 채팅 오버레이 상단 단톡방 헤더.
// 참여자 = 이 thread에서 한 번이라도 발화한 에이전트들.
// 좁은 라인은 아바타 stack + 이름, 펼치면 각자 상태(작업중/생각중/idle).

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown } from "lucide-react";
import type { Agent } from "@loom/core";
import { AgentInitialBadge } from "./AgentInitialBadge.js";
import { useI18n } from "../context/I18nContext.js";
import { agentColorOf, classesFor } from "./agentColor.js";
import { cn } from "../lib/utils.js";

export interface ParticipantsHeaderProps {
  participants: Agent[];
  workingIds: Set<string>;
  touchingIds: Set<string>;
}

export function ParticipantsHeader({
  participants,
  workingIds,
  touchingIds,
}: ParticipantsHeaderProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  if (participants.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60 text-[11px] text-muted-foreground/70 italic">
        {t("participants.empty")}
      </div>
    );
  }

  return (
    <div className="border-b border-border/60">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
      >
        <div className="flex -space-x-1.5 shrink-0">
          {participants.slice(0, 5).map((a) => (
            <span
              key={a.id}
              className="ring-2 ring-card rounded-full"
              title={`@${a.name}`}
            >
              <AgentInitialBadge
                agent={a}
                size="xs"
                live={touchingIds.has(a.id)}
              />
            </span>
          ))}
          {participants.length > 5 ? (
            <span className="size-5 rounded-full ring-2 ring-card bg-muted text-[9px] font-semibold mono inline-flex items-center justify-center text-muted-foreground">
              +{participants.length - 5}
            </span>
          ) : null}
        </div>
        <span className="flex-1 min-w-0 text-[11px] truncate">
          {participants
            .slice(0, 3)
            .map((a) => `@${a.name}`)
            .join(" · ")}
          {participants.length > 3
            ? ` · ${t("participants.othersCount", { n: participants.length - 3 })}`
            : ""}
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 text-muted-foreground transition-transform shrink-0",
            expanded && "rotate-180",
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.ul
            key="expanded"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            {participants.map((a) => {
              const cls = classesFor(agentColorOf(a));
              const status = touchingIds.has(a.id)
                ? "working"
                : workingIds.has(a.id)
                  ? "thinking"
                  : "idle";
              return (
                <li
                  key={a.id}
                  className="flex items-center gap-2 px-3 py-1.5 border-t border-border/40 first:border-t"
                >
                  <AgentInitialBadge
                    agent={a}
                    size="sm"
                    live={status !== "idle"}
                  />
                  <span className={cn("text-xs font-medium", cls.text)}>
                    @{a.name}
                  </span>
                  <span className="ml-auto inline-flex items-center gap-1 text-[10px] mono text-muted-foreground">
                    <span
                      aria-hidden
                      className={cn(
                        "size-1.5 rounded-full",
                        status === "working"
                          ? "bg-emerald-500 animate-pulse"
                          : status === "thinking"
                            ? "bg-amber-400 animate-pulse"
                            : "bg-muted-foreground/30",
                      )}
                    />
                    {t(`participants.status.${status}`)}
                  </span>
                </li>
              );
            })}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
