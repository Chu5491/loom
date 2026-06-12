// 한 run 의 SSE 이벤트를 구독한다. 서버가 replay(이미 나온 이벤트) → 라이브 →
// done 순서로 보내므로, 새로고침·재마운트해도 같은 runId 면 전체가 복원된다.

import { useEffect, useState } from "react";
import type { OfficeEvent, RunInfo, RunStatus } from "@loom/core";
import { runEventsUrl } from "../api/client.js";

export interface RunStream {
  events: OfficeEvent[];
  run: RunInfo | null;
  status: RunStatus;
}

export function useRunStream(runId: string | null): RunStream {
  const [events, setEvents] = useState<OfficeEvent[]>([]);
  const [run, setRun] = useState<RunInfo | null>(null);
  const [status, setStatus] = useState<RunStatus>("running");

  useEffect(() => {
    if (!runId) return;
    setEvents([]);
    setRun(null);
    setStatus("running");

    const es = new EventSource(runEventsUrl(runId));

    // (재)연결 때마다 서버는 replay 부터 다시 보낸다 — 누적분을 비워 중복 렌더 방지.
    es.onopen = () => setEvents([]);

    es.addEventListener("event", (e) => {
      try {
        const msg = JSON.parse((e as MessageEvent).data) as { event: OfficeEvent };
        setEvents((prev) => [...prev, msg.event]);
      } catch {
        // 깨진 페이로드 한 줄이 스트림 전체를 죽이면 안 됨
      }
    });
    es.addEventListener("done", (e) => {
      try {
        const msg = JSON.parse((e as MessageEvent).data) as { run: RunInfo };
        setRun(msg.run);
        setStatus(msg.run.status);
      } catch {
        // done 파싱 실패 — 최종 상태는 runs 쿼리 폴링이 채운다
      }
      es.close();
    });
    // 네이티브 error: 일시 단절(서버 재시작·노트북 슬립)이면 EventSource 가 알아서
    // 재접속하므로 여기서 close 하면 안 된다 — 내장 재연결이 꺼져 영구 failed 로
    // 굳는다. readyState CLOSED 는 영구 실패(run 소실 등) — 그때만 failed 처리.
    es.addEventListener("error", () => {
      if (es.readyState === EventSource.CLOSED) {
        setStatus((s) => (s === "running" ? "failed" : s));
      }
    });

    return () => es.close();
  }, [runId]);

  return { events, run, status };
}
