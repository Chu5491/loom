// 스켈레톤 로더 — 둥근 사각 박스가 좌→우로 흐르는 시머. motion 없이 순수 CSS
// gradient + animation으로 충분 (수십 개 띄워도 GPU 부하 없음).
//
// 용례:
//   <Skeleton className="h-4 w-32" />
//   <Skeleton className="h-9 w-9 rounded-full" />

import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils.js";

export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md bg-muted/60",
        "before:absolute before:inset-0 before:-translate-x-full",
        "before:bg-gradient-to-r before:from-transparent before:via-foreground/[0.06] before:to-transparent",
        "before:animate-shimmer",
        className,
      )}
      aria-hidden
      {...props}
    />
  );
}
