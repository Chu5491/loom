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
  return (
    <motion.div
      data-run-id={runId?.id}
      data-msg-kind={runId?.kind}
      // 새 발화 첫 줄만 슬라이드 인. 연속 메시지는 가만히 — 스크롤이 흔들리지 않음.
      initial={isContinuation ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={cn(
        // 좁은 폭(@chat 컨테이너 < 480px) 대응 — 좌우 여백을 줄이고
        // gap도 좁혀서 채팅 dock / 분할 모드에서 텍스트 폭 확보.
        "group relative flex items-start gap-2 px-2 py-0.5 hover:bg-foreground/[0.03]",
        "@[480px]:gap-3 @[480px]:px-4",
        !isContinuation && "mt-1.5 pt-1",
      )}
    >
      <div className="w-7 @[480px]:w-8 shrink-0 mt-0.5 relative">
        {isContinuation ? (
          <>
            {/* 연속 메시지를 그룹 아바타에 잇는 희미한 세로선. */}
            <span
              aria-hidden
              className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-px bg-foreground/[0.08] group-hover:bg-foreground/[0.15] transition-colors"
            />
            <span className="invisible group-hover:visible block text-right text-[10px] text-muted-foreground/70 mono leading-9 -mt-2 relative">
              {fmtTime(timestamp)}
            </span>
          </>
        ) : (
          avatar
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!isContinuation ? (
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className={cn("text-sm font-semibold", nameClassName)}>{name}</span>
            <span className="text-[11px] text-muted-foreground mono">
              {fmtTime(timestamp)}
            </span>
            {tag}
          </div>
        ) : null}
        {children}
      </div>
      {actions ? (
        <div className="absolute right-1.5 @[480px]:right-3 -top-2 opacity-0 group-hover:opacity-100 transition-opacity">
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
