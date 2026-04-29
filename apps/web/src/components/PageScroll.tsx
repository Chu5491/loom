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
      <div className={cn("max-w-5xl mx-auto px-6 py-6", className)}>
        {children}
      </div>
    </div>
  );
}
