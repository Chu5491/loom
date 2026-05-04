// 컨텐츠 부재 상태 — 아이콘 + 제목 + 옵션 액션. 배경은 미묘한 radial-gradient 한 장.
// (이전 파티클 데코는 로드 비용이 가치를 못 따라가서 제거.)

import type { ReactNode } from "react";

export function Empty({
  icon,
  title,
  action,
}: {
  icon: ReactNode;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="relative flex flex-col items-center justify-center text-center py-20 px-6 overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_30%,_color-mix(in_oklch,_var(--accent-strong)_10%,_transparent),_transparent_60%)]"
      />
      {icon}
      <p className="mt-3 text-sm text-muted-foreground">{title}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
