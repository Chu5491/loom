// 한 run 의 SSE 이벤트를 구독한다. 서버가 replay(이미 나온 이벤트) → 라이브 →
// done 순서로 보내므로, 새로고침·재마운트해도 같은 runId 면 전체가 복원된다.

import { useEffect, useState } from "react";
import type { OfficeEvent, RunInfo, RunStatus } from "@loom/core";
import { runEventsUrl } from "../api/client.js";
import { streamStatusOnError, parsePayload } from "../lib/stream.js";

export interface RunStream {
  events: OfficeEvent[];
  run: RunInfo | null;
  status: RunStatus;
  /** 일시 단절 후 EventSource 가 자동 재접속 중 — UI 가 "재연결 중" 을 보일 근거. */
  reconnecting: boolean;
}

export function useRunStream(runId: string | null): RunStream {
  const [events, setEvents] = useState<OfficeEvent[]>([]);
  const [run, setRun] = useState<RunInfo | null>(null);
  const [status, setStatus] = useState<RunStatus>("running");
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    if (!runId) return;
    setEvents([]);
    setRun(null);
    setStatus("running");
    setReconnecting(false);

    const es = new EventSource(runEventsUrl(runId));

    // (재)연결 때마다 서버는 replay 부터 다시 보낸다 — 누적분을 비워 중복 렌더 방지.
    es.onopen = () => {
      setEvents([]);
      setReconnecting(false);
    };

    es.addEventListener("event", (e) => {
      // 깨진 페이로드 한 줄이 스트림 전체를 죽이면 안 됨 → parsePayload 가 null 로 흡수
      const msg = parsePayload<{ event: OfficeEvent }>((e as MessageEvent).data);
      if (msg) setEvents((prev) => [...prev, msg.event]);
    });
    es.addEventListener("done", (e) => {
      // done 파싱 실패 — 최종 상태는 runs 쿼리 폴링이 채운다
      const msg = parsePayload<{ run: RunInfo }>((e as MessageEvent).data);
      if (msg) {
        setRun(msg.run);
        setStatus(msg.run.status);
      }
      es.close();
    });
    // 네이티브 error: 일시 단절(서버 재시작·노트북 슬립)이면 EventSource 가 알아서
    // 재접속하므로 여기서 close 하면 안 된다 — 내장 재연결이 꺼져 영구 failed 로
    // 굳는다. readyState CLOSED 는 영구 실패(run 소실 등) — 그때만 failed 처리.
    es.addEventListener("error", () => {
      // CLOSED=영구 실패, CONNECTING=브라우저가 자동 재접속 중(onopen 에서 해제).
      const closed = es.readyState === EventSource.CLOSED;
      setReconnecting(!closed);
      setStatus((s) => streamStatusOnError(closed, s));
    });

    return () => es.close();
  }, [runId]);

  return { events, run, status, reconnecting };
}
