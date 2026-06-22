// Office 디테일 편집기 공통 훅 — 캐시 무효화 + 미저장 draft 가드.

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function useInvalidate() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ["office"] });
}

/** 미저장 가드 등록 — 매 렌더 최신 클로저로 갱신, 언마운트 시 해제(스테일 체커 방지). */
export function useDirtyGuard(register: ((fn: () => boolean) => void) | undefined, isDirty: () => boolean) {
  useEffect(() => {
    register?.(isDirty);
  });
  useEffect(() => () => register?.(() => false), [register]);
}

/** 디테일 공통 — dirty 가드 + "저장됨" 표시를 한 곳에서. snapshot 은 현재 폼, baseline 은
 *  prop(서버 원본)의 직렬화. 저장 직후엔 refetch 가 끝나기 전이라 snapshot≠baseline 이어도
 *  markSaved 가 찍어둔 스냅샷과 같으면 dirty 를 끄고 saved 를 켠다 — 그래서 저장하자마자
 *  넘어가도 경고가 안 뜬다. 다시 편집하면 스냅샷이 갈라져 saved 가 풀리고 dirty 가 살아난다. */
export function useEditorGuard(
  register: ((fn: () => boolean) => void) | undefined,
  snapshot: string,
  baseline: string,
) {
  const snapRef = useRef(snapshot);
  snapRef.current = snapshot;
  const [savedSnap, setSavedSnap] = useState<string | null>(null);
  useDirtyGuard(register, () => snapshot !== baseline && snapshot !== savedSnap);
  return {
    saved: savedSnap !== null && snapshot === savedSnap,
    markSaved: () => setSavedSnap(snapRef.current),
  };
}
