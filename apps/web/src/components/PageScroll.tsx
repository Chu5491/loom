import { motion } from "motion/react";
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
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className={cn(
          "max-w-6xl mx-auto px-3 sm:px-4 lg:px-6 py-4 lg:py-6",
          className,
        )}
      >
        {children}
      </motion.div>
    </div>
  );
}
