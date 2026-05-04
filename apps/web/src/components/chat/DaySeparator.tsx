// 날짜 구분선 — 캡슐 + 그림자 + 양옆 라인은 좁은 dock에선 너무 시끄럽다.
// 작게: 점선 1px + 가운데 라벨, sticky로 스크롤 시 상단에 살짝만 떠있음.

import { useI18n } from "../../context/I18nContext.js";
import { dayLabel } from "./utils.js";

export function DaySeparator({ ts }: { ts: string }) {
  const { t } = useI18n();
  return (
    <div className="sticky top-0 z-10 my-2 flex items-center justify-center pointer-events-none">
      <span className="rounded bg-card/95 backdrop-blur px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground/70">
        {dayLabel(ts, t)}
      </span>
    </div>
  );
}
