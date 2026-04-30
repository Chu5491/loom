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
        "flex items-end justify-between gap-3 pb-3 border-b border-border/60",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-base font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
