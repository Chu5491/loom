import * as React from "react";
import { cn } from "../../lib/utils.js";

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-xl border bg-card text-card-foreground shadow-xs transition-shadow duration-200",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export { Card };
