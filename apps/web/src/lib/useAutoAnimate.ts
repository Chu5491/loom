// 컨테이너 자식 추가/삭제/정렬에 자동 모핑을 얹어주는 ref 훅.

import { useEffect, useRef } from "react";
import autoAnimate, { type AutoAnimateOptions } from "@formkit/auto-animate";

export function useAutoAnimate<T extends HTMLElement = HTMLElement>(
  options?: Partial<AutoAnimateOptions>,
) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (ref.current) autoAnimate(ref.current, options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ref;
}
