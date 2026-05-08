import type { Agent } from "@loom/core";
import { agentColorOf, initialFor } from "./agentColor.js";
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
 * Compact filled square showing an agent's first character. Used where
 * an avatar would be too big — file tabs, tree rows, "editing now"
 * banners. Reads at-a-glance like the badges in the reference design:
 * a tiny [AD] chip pinned next to the filename.
 *
 * `live=true` adds a soft outer pulse so the eye catches the *currently*
 * editing file even in a long tree.
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
      ? "size-3.5 text-[8px]"
      : size === "md"
        ? "size-5 text-[10px]"
        : size === "lg"
          ? "size-9 text-[14px] rounded-md"
          : size === "xl"
            ? "size-12 text-[18px] rounded-lg"
            : "size-4 text-[9px]";
  const bg = SOLID_BG[color] ?? "bg-foreground/60";

  return (
    <span
      className={cn(
        "relative inline-flex items-center justify-center rounded shrink-0",
        className,
      )}
      title={`@${agent.name}${live ? ` · ${t("editing.tooltipSuffix")}` : ""}`}
    >
      {live ? (
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 rounded animate-ping opacity-40",
            bg,
          )}
        />
      ) : null}
      <span
        className={cn(
          "relative inline-flex items-center justify-center rounded font-bold text-white tracking-tight",
          dim,
          bg,
          live && "ring-2 ring-background",
        )}
      >
        {initialFor(agent.name)}
      </span>
    </span>
  );
}
