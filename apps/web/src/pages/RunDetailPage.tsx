import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import type { RunStatus } from "@loom/core";
import { api } from "../api/client.js";
import { Badge, Button, Card } from "../components/ui.js";
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

interface ParsedLine {
  id: number;
  ts: string;
  stream: "stdout" | "stderr";
  raw: string;
  json: unknown | null;
}

function statusTone(s: RunStatus) {
  switch (s) {
    case "succeeded":
      return "success" as const;
    case "failed":
      return "danger" as const;
    case "cancelled":
      return "warn" as const;
    case "running":
      return "info" as const;
    default:
      return "neutral" as const;
  }
}

export function RunDetailPage() {
  const { t } = useI18n();
  const { runId } = useParams<{ runId?: string }>();
  const id = runId;
  const qc = useQueryClient();

  const run = useQuery({
    queryKey: ["run", id],
    queryFn: () => api.getRun(id!),
    enabled: !!id,
    refetchInterval: (q) => {
      const r = q.state.data?.run;
      if (!r) return 1000;
      return r.status === "queued" || r.status === "running" ? 1500 : false;
    },
  });

  const cancel = useMutation({
    mutationFn: () => api.cancelRun(id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["run", id] }),
  });

  const [lines, setLines] = useState<ParsedLine[]>([]);
  const [streamDone, setStreamDone] = useState<DonePayload | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [view, setView] = useState<"pretty" | "raw">("pretty");
  const [autoscroll, setAutoscroll] = useState(true);
  const stdoutBufRef = useRef("");
  const stderrBufRef = useRef("");
  const lineCounterRef = useRef(0);
  const doneRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!id) return;
    setLines([]);
    setStreamDone(null);
    setStreamError(null);
    stdoutBufRef.current = "";
    stderrBufRef.current = "";
    lineCounterRef.current = 0;
    doneRef.current = false;

    const ev = new EventSource(`/api/runs/${id}/logs`);

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
      qc.invalidateQueries({ queryKey: ["run", id] });
    });

    ev.onerror = () => {
      if (!doneRef.current)
        setStreamError(t("runDetail.streamError.interrupted"));
      ev.close();
    };

    return () => ev.close();
  }, [id, qc, t]);

  useEffect(() => {
    if (autoscroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines.length, autoscroll]);

  const r = run.data?.run;
  const attachedSpecIds = r?.attachedSpecIds ?? [];

  const specsList = useQuery({
    queryKey: ["specs"],
    queryFn: () => api.listSpecs(),
    enabled: attachedSpecIds.length > 0,
  });
  const attachedSpecs = useMemo(
    () =>
      attachedSpecIds
        .map((sid) => specsList.data?.specs.find((s) => s.id === sid))
        .filter((s): s is NonNullable<typeof s> => !!s),
    [attachedSpecIds, specsList.data],
  );

  const result = useMemo(() => {
    return lines
      .map((l) => l.json)
      .reverse()
      .find(
        (j): j is { type: "result"; result?: string; total_cost_usd?: number } =>
          !!j &&
          typeof j === "object" &&
          (j as { type?: string }).type === "result",
      );
  }, [lines]);

  if (run.isLoading) return <p className="text-zinc-500 text-sm">{t("common.loading")}</p>;
  if (run.isError) return <p className="text-red-500 dark:text-red-400 text-sm">{run.error.message}</p>;
  if (!r) return null;

  const isActive = r.status === "queued" || r.status === "running";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-sm">
        <Link
          to="/runs"
          className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          {t("runDetail.back")}
        </Link>
        <span className="text-zinc-400 dark:text-zinc-600">/</span>
        <span className="mono text-zinc-500 truncate">{r.id}</span>
      </div>

      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Badge tone={statusTone(r.status)}>{t(`status.${r.status}`)}</Badge>
            {r.exitCode !== null ? (
              <span className="text-xs text-zinc-500 mono">
                {t("runDetail.tag.exit", { code: r.exitCode })}
              </span>
            ) : null}
            {r.pid ? (
              <span className="text-xs text-zinc-500 mono">
                {t("runDetail.tag.pid", { pid: r.pid })}
              </span>
            ) : null}
          </div>
          {isActive ? (
            <Button
              variant="danger"
              size="sm"
              disabled={cancel.isPending}
              onClick={() => {
                if (confirm(t("runDetail.cancelConfirm"))) cancel.mutate();
              }}
            >
              {cancel.isPending ? t("common.cancelling") : t("runDetail.button.cancel")}
            </Button>
          ) : null}
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500 mb-1">
            {t("runDetail.section.prompt")}
          </p>
          <pre className="text-sm mono rounded p-3 whitespace-pre-wrap break-words bg-zinc-100 dark:bg-zinc-950">
            {r.prompt}
          </pre>
        </div>
        {attachedSpecIds.length > 0 ? (
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500 mb-1">
              {t("runDetail.section.attachedSpecs", { count: attachedSpecIds.length })}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {attachedSpecs.map((s) => (
                <Link
                  key={s.id}
                  to={`/specs/${s.id}`}
                  className="inline-flex items-center rounded border px-2 py-0.5 text-xs bg-sky-100 text-sky-800 border-sky-300 hover:bg-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-800 dark:hover:bg-sky-900/50"
                >
                  {s.name}
                </Link>
              ))}
              {attachedSpecIds
                .filter((sid) => !attachedSpecs.find((s) => s.id === sid))
                .map((sid) => (
                  <span
                    key={sid}
                    className="inline-flex items-center rounded border px-2 py-0.5 text-xs mono line-through border-zinc-300 bg-zinc-100 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500"
                    title={t("runDetail.specDeleted")}
                  >
                    {sid.slice(0, 8)}
                  </span>
                ))}
            </div>
          </div>
        ) : null}
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <Meta label={t("runDetail.meta.cwd")} value={r.cwd} mono />
          <Meta
            label={t("runDetail.meta.started")}
            value={r.startedAt ? fmt(r.startedAt) : "—"}
          />
          <Meta
            label={t("runDetail.meta.duration")}
            value={
              r.startedAt && r.endedAt
                ? `${((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 1000).toFixed(2)}s`
                : "—"
            }
          />
          <Meta label={t("runDetail.meta.logFile")} value={r.logPath ?? "—"} mono />
        </dl>
        {result?.result ? (
          <div className="rounded border p-3 border-emerald-300 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30">
            <p className="text-xs uppercase tracking-wide text-emerald-700 dark:text-emerald-400 mb-1">
              {t("runDetail.section.result")}
            </p>
            <p className="text-sm mono whitespace-pre-wrap break-words">
              {result.result}
            </p>
            {typeof result.total_cost_usd === "number" ? (
              <p className="mt-1 text-xs text-emerald-700/70 dark:text-emerald-500/70 mono">
                {t("runDetail.tag.cost", {
                  cost: result.total_cost_usd.toFixed(5),
                })}
              </p>
            ) : null}
          </div>
        ) : null}
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{t("runDetail.section.logs")}</h2>
        <div className="flex items-center gap-2 text-xs">
          <label className="flex items-center gap-1 text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={autoscroll}
              onChange={(e) => setAutoscroll(e.target.checked)}
            />
            {t("runDetail.autoscroll")}
          </label>
          <div className="flex rounded-md border overflow-hidden border-zinc-300 dark:border-zinc-800">
            {(["pretty", "raw"] as const).map((v) => (
              <button
                key={v}
                className={
                  "px-2 py-1 transition-colors " +
                  (view === v
                    ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100")
                }
                onClick={() => setView(v)}
              >
                {v === "pretty" ? t("runDetail.view.pretty") : t("runDetail.view.raw")}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        ref={containerRef}
        className="rounded-md border max-h-[60vh] overflow-y-auto p-2 space-y-1.5 border-zinc-200 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-950"
      >
        {lines.length === 0 ? (
          <p className="text-zinc-500 text-xs px-2 py-4">
            {isActive
              ? t("runDetail.empty.waiting")
              : t("runDetail.empty.noOutput")}
          </p>
        ) : view === "pretty" ? (
          lines.map((l) => <PrettyLine key={l.id} line={l} />)
        ) : (
          <pre className="text-xs mono whitespace-pre-wrap break-words text-zinc-800 dark:text-zinc-300">
            {lines.map((l) => l.raw).join("\n")}
          </pre>
        )}
        {streamDone ? (
          <div className="px-2 py-1 text-xs text-zinc-500 mono">
            {t("runDetail.streamEnded", {
              status: t(`status.${streamDone.status}`),
              code: streamDone.exitCode ?? "—",
            })}
          </div>
        ) : null}
        {streamError ? (
          <div className="px-2 py-1 text-xs text-red-500 dark:text-red-400">
            {t("runDetail.streamError", { message: streamError })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString();
}

function Meta({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-zinc-500 uppercase tracking-wide">{label}</dt>
      <dd
        className={
          "break-all text-zinc-800 dark:text-zinc-300 " + (mono ? "mono text-xs" : "")
        }
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

function PrettyLine({ line }: { line: ParsedLine }) {
  const { t } = useI18n();
  const j = line.json as
    | {
        type?: string;
        subtype?: string;
        message?: { content?: Array<{ type: string; text?: string; name?: string; input?: unknown }> };
        tool_use_id?: string;
        content?: unknown;
        result?: string;
        is_error?: boolean;
      }
    | null;

  if (line.stream === "stderr") {
    return (
      <div className="text-xs text-red-500 dark:text-red-400 mono px-2">
        <span className="text-zinc-500">{t("runDetail.stderr")}</span> {line.raw}
      </div>
    );
  }

  if (!j || typeof j !== "object") {
    return (
      <div className="text-xs text-zinc-700 dark:text-zinc-300 mono px-2 whitespace-pre-wrap break-words">
        {line.raw}
      </div>
    );
  }

  const type = j.type;
  const subtype = j.subtype;

  if (type === "system") {
    return (
      <div className="text-xs text-zinc-500 px-2 mono">
        <Badge tone="neutral">{t("runDetail.event.system")}</Badge>{" "}
        <span>{subtype ?? ""}</span>
      </div>
    );
  }

  if (type === "assistant" && j.message?.content) {
    return (
      <div className="px-2 space-y-1">
        <Badge tone="info">{t("runDetail.event.assistant")}</Badge>
        {j.message.content.map((c, i) => {
          if (c.type === "text" && c.text) {
            return (
              <div
                key={i}
                className="text-sm whitespace-pre-wrap break-words text-zinc-900 dark:text-zinc-100"
              >
                {c.text}
              </div>
            );
          }
          if (c.type === "tool_use") {
            return (
              <div key={i} className="text-xs">
                <Badge tone="warn">{t("runDetail.event.tool")}</Badge>{" "}
                <span className="mono text-zinc-700 dark:text-zinc-300">{c.name}</span>
                <pre className="mt-1 text-xs mono rounded p-2 overflow-x-auto bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-500">
                  {JSON.stringify(c.input, null, 2)}
                </pre>
              </div>
            );
          }
          return null;
        })}
      </div>
    );
  }

  if (type === "user" && Array.isArray((j as { message?: { content?: unknown } }).message?.content)) {
    const content = (j as { message: { content: Array<{ type: string; content?: string; is_error?: boolean }> } }).message
      .content;
    return (
      <div className="px-2 space-y-1">
        {content.map((c, i) => {
          if (c.type === "tool_result") {
            return (
              <div key={i} className="text-xs">
                <Badge tone={c.is_error ? "danger" : "neutral"}>
                  {t("runDetail.event.toolResult")}
                </Badge>
                <pre className="mt-1 text-xs mono rounded p-2 overflow-x-auto whitespace-pre-wrap break-words bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
                  {typeof c.content === "string"
                    ? c.content
                    : JSON.stringify(c.content, null, 2)}
                </pre>
              </div>
            );
          }
          return null;
        })}
      </div>
    );
  }

  if (type === "result") {
    return (
      <div className="px-2">
        <Badge tone={j.is_error ? "danger" : "success"}>
          {t("runDetail.event.result")}
        </Badge>
        <span className="ml-2 text-xs text-zinc-500 mono">{subtype ?? ""}</span>
      </div>
    );
  }

  return (
    <details className="px-2">
      <summary className="text-xs text-zinc-500 cursor-pointer mono">
        {type ?? "?"}
        {subtype ? ` / ${subtype}` : ""}
      </summary>
      <pre className="mt-1 text-xs mono rounded p-2 overflow-x-auto bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
        {JSON.stringify(j, null, 2)}
      </pre>
    </details>
  );
}
