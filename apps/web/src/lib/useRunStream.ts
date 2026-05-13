import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "../context/I18nContext.js";

interface ChunkPayload {
  ts: string;
  stream: "stdout" | "stderr";
  data: string;
}

interface DonePayload {
  ts: string;
  status: "succeeded" | "failed" | "cancelled";
  exitCode: number | null;
}

export interface ParsedLine {
  id: number;
  ts: string;
  stream: "stdout" | "stderr";
  raw: string;
  json: unknown | null;
}

export function useRunStream(runId: string | undefined) {
  const qc = useQueryClient();
  const { t } = useI18n();
  const [lines, setLines] = useState<ParsedLine[]>([]);
  const [streamDone, setStreamDone] = useState<DonePayload | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const stdoutBufRef = useRef("");
  const stderrBufRef = useRef("");
  const lineCounterRef = useRef(0);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!runId) return;
    setLines([]);
    setStreamDone(null);
    setStreamError(null);
    stdoutBufRef.current = "";
    stderrBufRef.current = "";
    lineCounterRef.current = 0;
    doneRef.current = false;

    const ev = new EventSource(`/api/runs/${runId}/logs`);

    const flushBuffer = (
      stream: "stdout" | "stderr",
      ts: string,
      ref: { current: string },
    ): ParsedLine[] => {
      const parts = ref.current.split("\n");
      ref.current = parts.pop() ?? "";
      const produced: ParsedLine[] = [];
      for (const line of parts) {
        if (!line) continue;
        let json: unknown | null = null;
        try {
          json = JSON.parse(line);
        } catch {
          json = null;
        }
        produced.push({ id: lineCounterRef.current++, ts, stream, raw: line, json });
      }
      return produced;
    };

    ev.addEventListener("chunk", (e) => {
      const payload = JSON.parse((e as MessageEvent).data) as ChunkPayload;
      const ref = payload.stream === "stdout" ? stdoutBufRef : stderrBufRef;
      ref.current += payload.data;
      const produced = flushBuffer(payload.stream, payload.ts, ref);
      if (produced.length > 0) setLines((prev) => prev.concat(produced));
    });

    ev.addEventListener("done", (e) => {
      const done = JSON.parse((e as MessageEvent).data) as DonePayload;
      for (const stream of ["stdout", "stderr"] as const) {
        const ref = stream === "stdout" ? stdoutBufRef : stderrBufRef;
        if (ref.current) {
          ref.current += "\n";
          const produced = flushBuffer(stream, done.ts, ref);
          if (produced.length > 0) setLines((prev) => prev.concat(produced));
        }
      }
      doneRef.current = true;
      setStreamDone(done);
      ev.close();
      qc.invalidateQueries({ queryKey: ["run", runId] });
    });

    ev.onerror = () => {
      if (!doneRef.current)
        setStreamError(t("runDetail.streamError.interrupted"));
      ev.close();
    };

    return () => ev.close();
  }, [runId, qc, t]);

  return { lines, streamDone, streamError };
}
