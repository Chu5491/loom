// 한 글자 git 상태 코드 — 색은 git 관습.
//   A / ?  → 초록 (added / untracked)
//   M       → 노랑 (modified)
//   D       → 빨강 (deleted)
//   R / C   → 파랑 (renamed / copied)
//   U       → 진빨강 강조 (conflicted)

import { cn } from "../../lib/utils.js";

export function StatusBadge({
  code,
  untracked,
}: {
  code: string;
  untracked?: boolean;
}) {
  const color = untracked
    ? "text-emerald-600 dark:text-emerald-400"
    : code === "A"
      ? "text-emerald-600 dark:text-emerald-400"
      : code === "M"
        ? "text-amber-600 dark:text-amber-400"
        : code === "D"
          ? "text-rose-600 dark:text-rose-400"
          : code === "R" || code === "C"
            ? "text-sky-600 dark:text-sky-400"
            : code === "U"
              ? "text-rose-700 dark:text-rose-300 font-bold"
              : "text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex size-4 items-center justify-center mono text-[10px] shrink-0",
        color,
      )}
    >
      {untracked ? "U" : code}
    </span>
  );
}
