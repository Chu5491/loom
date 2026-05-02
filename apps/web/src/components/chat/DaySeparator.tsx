// 날짜 구분 헤더 — 스레드 사이를 떠다니는 sticky 캡슐.

import { useI18n } from "../../context/I18nContext.js";
import { dayLabel } from "./utils.js";

export function DaySeparator({ ts }: { ts: string }) {
  const { t } = useI18n();
  return (
    <div className="sticky top-0 z-10 my-3 flex items-center gap-3 px-1">
      <div className="flex-1 border-t" />
      <span className="rounded-full border bg-background px-3 py-0.5 text-[11px] font-medium text-muted-foreground shadow-sm">
        {dayLabel(ts, t)}
      </span>
      <div className="flex-1 border-t" />
    </div>
  );
}
