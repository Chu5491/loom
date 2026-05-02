// 8개 activity 패널이 공유하는 셸 컴포넌트.

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Skeleton } from "../ui/skeleton.js";

export function PanelHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 h-10 px-3 border-b border-border/70 shrink-0">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/70">
        {title}
      </span>
      {action ? <div className="flex items-center gap-1">{action}</div> : null}
    </div>
  );
}

export function NoProjectState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex items-center justify-center px-4 text-center">
      <p className="text-xs text-muted-foreground/70 italic">{message}</p>
    </div>
  );
}

export function ManageFooter({ to, label }: { to: string; label: string }) {
  return (
    <div className="border-t border-border/60 shrink-0">
      <Link
        to={to}
        className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
      >
        <span>{label}</span>
        <ChevronRight className="size-3" />
      </Link>
    </div>
  );
}

export function SettingsRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

// 어떤 패널이든 쓸 수 있는 행 스켈레톤. 아바타 변형 + 텍스트 두 줄.
export function ListSkeleton({
  rows = 5,
  withAvatar = true,
}: {
  rows?: number;
  withAvatar?: boolean;
}) {
  return (
    <div className="flex-1 overflow-hidden py-1">
      <ul className="space-y-px">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="flex items-start gap-2 px-3 py-2">
            {withAvatar ? (
              <Skeleton className="size-6 rounded-full shrink-0" />
            ) : null}
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-2.5 w-full max-w-[200px]" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
