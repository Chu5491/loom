// 페이지와 보이지 않는 트리거(사이드바·메시지 액션·그래프·레일) 사이의 느슨한 pub/sub.
// EventTarget을 window에 한 번 부착해 HMR에도 인스턴스 유지.

import { useEffect } from "react";

export interface LoomEventMap {
  openFile: { path: string };
  pickThread: { id: string };
  newThread: undefined;
  pickAgent: { id: string };
  jumpToRun: { runId: string };
}

type EventName = keyof LoomEventMap;

const bus =
  typeof window === "undefined"
    ? null
    : (() => {
        const w = window as Window & { __loomBus?: EventTarget };
        if (!w.__loomBus) w.__loomBus = new EventTarget();
        return w.__loomBus;
      })();

export function emit<K extends EventName>(
  name: K,
  ...args: LoomEventMap[K] extends undefined ? [] : [detail: LoomEventMap[K]]
): void {
  bus?.dispatchEvent(new CustomEvent(name, { detail: args[0] }));
}

export function useLoomEvent<K extends EventName>(
  name: K,
  handler: (detail: LoomEventMap[K]) => void,
): void {
  useEffect(() => {
    if (!bus) return;
    const wrapped = (e: Event) =>
      handler((e as CustomEvent<LoomEventMap[K]>).detail);
    bus.addEventListener(name, wrapped);
    return () => bus.removeEventListener(name, wrapped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
}
