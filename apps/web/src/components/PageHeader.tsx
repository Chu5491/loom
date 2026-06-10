import { cn } from "../lib/utils.js";

/**
 * Title row for management pages (Agents · Skills · Runs). Title sits
 * on the left, action(s) on the right. Without it those pages spawned
 * a lonely button at the top with nothing across from it — looked like
 * a leftover header.
 */
export function PageHeader({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // GitHub repo-page 헤더 풍 — 얇은 underline + 양쪽 정렬.
        "flex items-center justify-between gap-3 pb-2.5 mb-1 border-b border-border/70",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="font-display text-[15px] font-semibold leading-tight">
          {title}
        </h1>
        {description ? (
          <p className="mt-0.5 text-[11.5px] text-muted-foreground/90 leading-snug">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
