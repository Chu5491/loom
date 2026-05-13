// 메시지 한 줄 레이아웃 + 부모 메시지 점프 핸들러.
// 사용자/에이전트 메시지가 공유하는 헤더(아바타·이름·타임스탬프) 셸.

import type { ReactNode } from "react";
import { CornerDownLeft } from "lucide-react";
import { motion } from "motion/react";
import type { Agent } from "@loom/core";
import { Button } from "../ui/button.js";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";
import { agentColorOf, classesFor } from "../agentColor.js";
import { fmtTime } from "./utils.js";

export function MessageRow({
  avatar,
  name,
  nameClassName,
  timestamp,
  tag,
  isContinuation,
  actions,
  runId,
  children,
}: {
  avatar: ReactNode;
  name: string;
  nameClassName?: string;
  timestamp: string;
  tag?: ReactNode;
  isContinuation: boolean;
  actions?: ReactNode;
  /** "↳ from @prev" 배지가 [data-run-id][data-msg-kind] 셀렉터로 점프하기 위한 마크. */
  runId?: { id: string; kind: "user" | "agent" };
  children: ReactNode;
}) {
  const isUser = runId?.kind === "user";

  return (
    <motion.div
      data-run-id={runId?.id}
      data-msg-kind={runId?.kind}
      initial={isContinuation ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={cn(
        "group relative flex px-2 py-0.5",
        "@[480px]:px-4",
        isUser ? "justify-end" : "justify-start",
        !isContinuation && "mt-3 pt-0.5",
      )}
    >
      {/* 에이전트: 아바타 왼쪽 */}
      {!isUser ? (
        <div className="w-7 @[480px]:w-8 shrink-0 mt-0.5 mr-2 @[480px]:mr-2.5">
          {isContinuation ? null : avatar}
        </div>
      ) : null}

      <div className={cn("min-w-0", isUser ? "max-w-[90%] @[480px]:max-w-[85%]" : "max-w-[95%] @[480px]:max-w-[90%] flex-1")}>
        {/* 이름 + 시간 헤더 */}
        {!isContinuation ? (
          <div className={cn(
            "flex items-baseline gap-2 mb-1",
            isUser && "justify-end",
          )}>
            {!isUser ? (
              <span className={cn("text-[13px] font-semibold", nameClassName)}>{name}</span>
            ) : null}
            <span className="text-[10px] text-muted-foreground/60 mono">
              {fmtTime(timestamp)}
            </span>
            {!isUser && tag ? tag : null}
          </div>
        ) : null}

        {/* 말풍선 */}
        <div
          className={cn(
            "relative rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
            isUser
              ? "bg-primary text-primary-foreground rounded-tr-md"
              : "bg-muted/60 dark:bg-muted/40 text-foreground rounded-tl-md",
          )}
        >
          {children}
          {/* 사용자 메시지 태그 (대상 에이전트) */}
          {isUser && tag ? (
            <div className="mt-1.5 flex justify-end">{tag}</div>
          ) : null}
        </div>

        {/* 에이전트 상태 태그 — 말풍선 아래 */}
        {!isUser && tag && isContinuation ? (
          <div className="mt-0.5 px-1">{tag}</div>
        ) : null}
      </div>

      {actions ? (
        <div className={cn(
          "absolute -top-2 opacity-0 group-hover:opacity-100 transition-opacity",
          isUser ? "left-1.5 @[480px]:left-3" : "right-1.5 @[480px]:right-3",
        )}>
          {actions}
        </div>
      ) : null}
    </motion.div>
  );
}

// 부모 메시지로 부드럽게 스크롤 + 잠깐 배경 플래시. 타깃이 페이지에 없으면 조용히 무시.
export function jumpToParent(parentRunId: string) {
  const el = document.querySelector(
    `[data-run-id="${parentRunId}"][data-msg-kind="agent"]`,
  ) as HTMLElement | null;
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("flash-target");
  void el.offsetWidth;
  el.classList.add("flash-target");
  window.setTimeout(() => el.classList.remove("flash-target"), 1500);
}

export function setHoverTarget(parentRunId: string, on: boolean) {
  const el = document.querySelector(
    `[data-run-id="${parentRunId}"][data-msg-kind="agent"]`,
  );
  if (!el) return;
  el.classList.toggle("hover-target", on);
}

export function ParentReference({
  parentAgent,
  parentRunId,
}: {
  parentAgent: Agent;
  parentRunId: string;
}) {
  const { t } = useI18n();
  const cls = classesFor(agentColorOf(parentAgent));
  return (
    <button
      type="button"
      onClick={() => jumpToParent(parentRunId)}
      onMouseEnter={() => setHoverTarget(parentRunId, true)}
      onMouseLeave={() => setHoverTarget(parentRunId, false)}
      className={cn(
        "group/parent inline-flex items-center gap-1.5 mb-1.5 rounded-md border bg-muted/40",
        "px-2 py-0.5 text-[11px] hover:bg-muted hover:border-foreground/30",
        "transition-colors cursor-pointer",
      )}
      title={t("chat.jumpToParent")}
    >
      <CornerDownLeft className="size-3 -scale-x-100 opacity-60 group-hover/parent:opacity-100" />
      <span className="text-muted-foreground">{t("chat.parentFrom")}</span>
      <span className={cn("font-medium", cls.text)}>@{parentAgent.name}</span>
    </button>
  );
}

export function HoverActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border bg-background shadow-sm px-1 py-0.5">
      {children}
    </div>
  );
}

export function HoverButton({
  onClick,
  icon,
  label,
}: {
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 text-muted-foreground hover:text-foreground"
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {icon}
    </Button>
  );
}
