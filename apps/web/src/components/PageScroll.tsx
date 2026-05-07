import { cn } from "../lib/utils.js";

/**
 * Fills the main column with a scrollable wrapper. Used by
 * management pages (Projects · Agents · Specs · Runs) that have
 * variable-length content. The chat page opts out — it manages its
 * own internal scrolling so the composer stays pinned to the bottom.
 */
export function PageScroll({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="h-full overflow-y-auto">
      {/* GitHub-y density — 좁은 화면에서도 컨텐츠가 압박되지 않게 padding 을
          반응형으로. 좌우 6 → 4 → 3, 상하 6 → 4. max-w-6xl 로 와이드 모니터에서도
          한쪽으로 안 쏠리게. */}
      <div
        className={cn(
          "max-w-6xl mx-auto px-3 sm:px-4 lg:px-6 py-4 lg:py-6",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
