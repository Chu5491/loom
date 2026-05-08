import type { Agent } from "@loom/core";
import { agentColorOf } from "./agentColor.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

// PALETTE 와 1:1 매칭. 색이 추가/삭제될 때 양쪽을 같이 바꿀 것.
const SOLID_BG: Record<string, string> = {
  sky: "bg-sky-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
  teal: "bg-teal-500",
  fuchsia: "bg-fuchsia-500",
  lime: "bg-lime-600",
  orange: "bg-orange-500",
  cyan: "bg-cyan-500",
  indigo: "bg-indigo-500",
  slate: "bg-slate-500",
};

/**
 * 작은 컬러 dot — 에이전트 색만으로 누구인지 식별. 예전엔 첫 글자(initial)
 * 박았었지만 시각적으로 노이지하고 글자 가독성도 약해 dot 만 남김.
 *
 * `live=true` 면 펄스 ring 으로 "지금 만지고 있음" 강조.
 */
export function AgentInitialBadge({
  agent,
  live = false,
  size = "sm",
  className,
}: {
  agent: Agent;
  live?: boolean;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const { t } = useI18n();
  const color = agentColorOf(agent);
  const dim =
    size === "xs"
      ? "size-2"
      : size === "md"
        ? "size-3"
        : size === "lg"
          ? "size-3.5"
          : size === "xl"
            ? "size-4"
            : "size-2.5";
  const bg = SOLID_BG[color] ?? "bg-foreground/60";

  return (
    <span
      className={cn(
        "relative inline-flex items-center justify-center rounded-full shrink-0",
        className,
      )}
      title={`@${agent.name}${live ? ` · ${t("editing.tooltipSuffix")}` : ""}`}
    >
      {live ? (
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 rounded-full animate-ping opacity-50",
            bg,
          )}
        />
      ) : null}
      <span
        className={cn(
          "relative inline-block rounded-full",
          dim,
          bg,
          live && "ring-2 ring-background",
        )}
      />
    </span>
  );
}
