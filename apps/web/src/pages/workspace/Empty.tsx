// 컨텐츠 부재 상태 — 아이콘 + 제목 + 옵션 액션. 배경은 lazy 파티클(@tsparticles).
// 파티클 청크는 빈 상태가 화면에 등장할 때만 fetch.

import { Suspense, lazy, type ReactNode } from "react";

const EmptyParticles = lazy(() =>
  import("../../components/EmptyParticles.js").then((m) => ({
    default: m.EmptyParticles,
  })),
);

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
      <Suspense fallback={null}>
        <EmptyParticles className="absolute inset-0 -z-10 opacity-70" />
      </Suspense>
      {icon}
      <p className="mt-3 text-sm text-muted-foreground">{title}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
