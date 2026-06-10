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

    es.addEventListener("event", (e) => {
      const msg = JSON.parse((e as MessageEvent).data) as { event: OfficeEvent };
      setEvents((prev) => [...prev, msg.event]);
    });
    es.addEventListener("done", (e) => {
      const msg = JSON.parse((e as MessageEvent).data) as { run: RunInfo };
      setRun(msg.run);
      setStatus(msg.run.status);
      es.close();
    });
    // 네이티브 error: 연결 끊김 or 서버 not_found. done 이후 close 로도 한 번 뜨므로
    // running 일 때만 failed 로 내린다.
    es.addEventListener("error", () => {
      es.close();
      setStatus((s) => (s === "running" ? "failed" : s));
    });

    return () => es.close();
  }, [runId]);

  return { events, run, status };
}
