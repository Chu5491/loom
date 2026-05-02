// 멀티-run 스레드를 좌측 세로 라인으로 묶어 시각적으로 한 단위로 보이게.

import type { ReactNode } from "react";
import type { ThreadGroup } from "./utils.js";
import { cn } from "../../lib/utils.js";

export function ThreadFrame({
  thread,
  children,
}: {
  thread: ThreadGroup;
  children: ReactNode;
}) {
  const isMulti = thread.runs.length > 1;
  return (
    <div
      className={cn(
        "py-1",
        isMulti && "relative pl-3 ml-3 border-l-2 border-foreground/[0.08] my-2",
      )}
    >
      {children}
    </div>
  );
}
