import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ChevronDown, GitCompare, RotateCcw, Undo2 } from "lucide-react";
import type { Agent, Run, RunStatus } from "@loom/core";
import { api } from "../api/client.js";
import { Badge, Button, Card } from "../components/ui.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.js";
import { PageScroll } from "../components/PageScroll.js";
import { useConfirm } from "../components/ConfirmDialog.js";
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
  const confirm = useConfirm();
  // Nested under /projects/:id/runs/:runId — pull both.
  const { id: projectId, runId } = useParams<{ id?: string; runId?: string }>();
  const id = runId;
  const runsListPath = projectId ? `/projects/${projectId}/runs` : "/runs";
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

  // Replay / Compare 에 필요한 보조 데이터.
  const agents = useQuery({
    queryKey: ["agents", { projectId }],
    queryFn: () => api.listAgents({ projectId }),
    enabled: !!projectId,
  });
  // 같은 thread 의 다른 run 들 — Compare picker 의 후보.
  const threadRuns = useQuery({
    queryKey: ["runs", { threadId: run.data?.run.threadId }],
    queryFn: () =>
      api.listRuns({
        threadId: run.data?.run.threadId ?? undefined,
        limit: 50,
      }),
    enabled: !!run.data?.run.threadId,
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

  if (run.isLoading) return <p className="text-muted-foreground text-sm">{t("common.loading")}</p>;
  if (run.isError) return <p className="text-destructive text-sm">{run.error.message}</p>;
  if (!r) return null;

  const isActive = r.status === "queued" || r.status === "running";

  return (
    <PageScroll className="space-y-4">
      <div className="flex items-center gap-3 text-sm">
        <Link
          to={runsListPath}
          className="text-muted-foreground hover:text-foreground"
        >
          {t("runDetail.back")}
        </Link>
        <span className="text-muted-foreground/60">/</span>
        <span className="mono text-muted-foreground truncate">{r.id}</span>
      </div>

      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Badge tone={statusTone(r.status)}>{t(`status.${r.status}`)}</Badge>
            {r.exitCode !== null ? (
              <span className="text-xs text-muted-foreground mono">
                {t("runDetail.tag.exit", { code: r.exitCode })}
              </span>
            ) : null}
            {r.pid ? (
              <span className="text-xs text-muted-foreground mono">
                {t("runDetail.tag.pid", { pid: r.pid })}
              </span>
            ) : null}
          </div>
          {isActive ? (
            <Button
              variant="danger"
              size="sm"
              disabled={cancel.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: t("runDetail.cancelConfirm"),
                  destructive: true,
                });
                if (ok) cancel.mutate();
              }}
            >
              {cancel.isPending ? t("common.cancelling") : t("runDetail.button.cancel")}
            </Button>
          ) : (
            <RunActions
              run={r}
              agents={agents.data?.agents ?? []}
              threadRuns={threadRuns.data?.runs ?? []}
              projectId={projectId}
            />
          )}
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
            {t("runDetail.section.prompt")}
          </p>
          <pre className="text-sm mono rounded p-3 whitespace-pre-wrap break-words bg-muted">
            {r.prompt}
          </pre>
        </div>
        {attachedSpecIds.length > 0 ? (
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              {t("runDetail.section.attachedSpecs", { count: attachedSpecIds.length })}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {attachedSpecs.map((s) => (
                <Link
                  key={s.id}
                  to={projectId ? `/projects/${projectId}/skills/${s.id}` : `#`}
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
                    className="inline-flex items-center rounded border px-2 py-0.5 text-xs mono line-through border-border bg-muted text-muted-foreground"
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
          <div className="rounded border p-3 border-success/40 bg-success/10">
            <p className="text-xs uppercase tracking-wide text-success mb-1">
              {t("runDetail.section.result")}
            </p>
            <p className="text-sm mono whitespace-pre-wrap break-words">
              {result.result}
            </p>
            {typeof result.total_cost_usd === "number" ? (
              <p className="mt-1 text-xs text-success/70 mono">
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
          <label className="flex items-center gap-1 text-muted-foreground">
            <input
              type="checkbox"
              checked={autoscroll}
              onChange={(e) => setAutoscroll(e.target.checked)}
            />
            {t("runDetail.autoscroll")}
          </label>
          <div className="flex rounded-md border overflow-hidden border-border">
            {(["pretty", "raw"] as const).map((v) => (
              <button
                key={v}
                className={
                  "px-2 py-1 transition-colors " +
                  (view === v
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground")
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
        className="rounded-md border max-h-[60vh] overflow-y-auto p-2 space-y-1.5 border-border bg-muted/30"
      >
        {lines.length === 0 ? (
          <p className="text-muted-foreground text-xs px-2 py-4">
            {isActive
              ? t("runDetail.empty.waiting")
              : t("runDetail.empty.noOutput")}
          </p>
        ) : view === "pretty" ? (
          lines.map((l) => <PrettyLine key={l.id} line={l} />)
        ) : (
          <pre className="text-xs mono whitespace-pre-wrap break-words text-foreground/90">
            {lines.map((l) => l.raw).join("\n")}
          </pre>
        )}
        {streamDone ? (
          <div className="px-2 py-1 text-xs text-muted-foreground mono">
            {t("runDetail.streamEnded", {
              status: t(`status.${streamDone.status}`),
              code: streamDone.exitCode ?? "—",
            })}
          </div>
        ) : null}
        {streamError ? (
          <div className="px-2 py-1 text-xs text-destructive">
            {t("runDetail.streamError", { message: streamError })}
          </div>
        ) : null}
      </div>
    </PageScroll>
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
      <dt className="text-muted-foreground uppercase tracking-wide">{label}</dt>
      <dd
        className={
          "break-all text-foreground/90 " + (mono ? "mono text-xs" : "")
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
      <div className="text-xs text-destructive mono px-2">
        <span className="text-muted-foreground">{t("runDetail.stderr")}</span> {line.raw}
      </div>
    );
  }

  if (!j || typeof j !== "object") {
    return (
      <div className="text-xs text-foreground/90 mono px-2 whitespace-pre-wrap break-words">
        {line.raw}
      </div>
    );
  }

  const type = j.type;
  const subtype = j.subtype;

  if (type === "system") {
    return (
      <div className="text-xs text-muted-foreground px-2 mono">
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
                className="text-sm whitespace-pre-wrap break-words text-foreground"
              >
                {c.text}
              </div>
            );
          }
          if (c.type === "tool_use") {
            return (
              <div key={i} className="text-xs">
                <Badge tone="warn">{t("runDetail.event.tool")}</Badge>{" "}
                <span className="mono text-foreground/90">{c.name}</span>
                <pre className="mt-1 text-xs mono rounded p-2 overflow-x-auto bg-muted text-muted-foreground">
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
                <pre className="mt-1 text-xs mono rounded p-2 overflow-x-auto whitespace-pre-wrap break-words bg-muted text-foreground/80">
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
        <span className="ml-2 text-xs text-muted-foreground mono">{subtype ?? ""}</span>
      </div>
    );
  }

  return (
    <details className="px-2">
      <summary className="text-xs text-muted-foreground cursor-pointer mono">
        {type ?? "?"}
        {subtype ? ` / ${subtype}` : ""}
      </summary>
      <pre className="mt-1 text-xs mono rounded p-2 overflow-x-auto bg-muted text-foreground/80">
        {JSON.stringify(j, null, 2)}
      </pre>
    </details>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// RunActions — finished run 의 우측 상단 액션 모음.
//
// 1) Rollback — workspace 를 이 run 직전 상태로 되돌림. before_ref 가 없으면
//    버튼 자체를 disabled.
// 2) Replay   — 같은 prompt + 같은 thread + parentRunId=this 로 새 run 시작.
//               agent picker 가 dropdown 으로 뜨고, 같은 agent 도 선택 가능.
// 3) Compare  — 같은 thread 의 다른 run 을 골라 /runs/compare?a=&b= 로 이동.

function RunActions(props: {
  run: Run;
  agents: Agent[];
  threadRuns: Run[];
  projectId: string | undefined;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { run: r, agents, threadRuns, projectId } = props;

  const rollback = useMutation({
    mutationFn: () => api.rollbackRun(r.id),
    onSuccess: (res) => {
      toast.success(t("runDetail.rollback.done"), {
        description: res.safetyRef
          ? t("runDetail.rollback.safetyRef", {
              sha: res.safetyRef.slice(0, 7),
            })
          : undefined,
      });
      qc.invalidateQueries({ queryKey: ["gitStatus", projectId] });
      qc.invalidateQueries({ queryKey: ["projectTouched", projectId] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const replay = useMutation({
    mutationFn: (agentId: string) =>
      api.createRun({
        agentId,
        prompt: r.prompt,
        threadId: r.threadId ?? null,
        parentRunId: r.id,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["runs"] });
      if (projectId) {
        navigate(`/projects/${projectId}/runs/${res.run.id}`);
      }
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const onRollback = async () => {
    if (!r.beforeRef) return;
    const ok = await confirm({
      title: t("runDetail.rollback.title"),
      description: t("runDetail.rollback.desc"),
      confirmLabel: t("runDetail.rollback.confirm"),
      destructive: true,
    });
    if (ok) rollback.mutate();
  };

  // Compare 후보 = 같은 thread 의 다른 run (자기 자신 제외).
  const compareCandidates = threadRuns.filter((x) => x.id !== r.id);
  const canCompare = compareCandidates.length > 0;

  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="ghost"
        size="sm"
        disabled={!r.beforeRef || rollback.isPending}
        onClick={onRollback}
        title={
          r.beforeRef
            ? t("runDetail.rollback.button")
            : t("runDetail.rollback.unavailable")
        }
      >
        <Undo2 className="size-3.5 mr-1" />
        {rollback.isPending
          ? t("runDetail.rollback.rolling")
          : t("runDetail.rollback.button")}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" disabled={replay.isPending}>
            <RotateCcw className="size-3.5 mr-1" />
            {replay.isPending
              ? t("runDetail.replay.starting")
              : t("runDetail.replay.button")}
            <ChevronDown className="size-3 ml-1" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[12rem]">
          <DropdownMenuLabel>
            {t("runDetail.replay.pickAgent")}
          </DropdownMenuLabel>
          {agents.length === 0 ? (
            <DropdownMenuItem disabled>
              {t("runDetail.replay.noAgents")}
            </DropdownMenuItem>
          ) : (
            agents.map((a) => (
              <DropdownMenuItem
                key={a.id}
                onSelect={() => replay.mutate(a.id)}
              >
                @{a.name}
                <span className="ml-auto text-[10px] text-muted-foreground/70 mono">
                  {a.adapterKind}
                </span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" disabled={!canCompare}>
            <GitCompare className="size-3.5 mr-1" />
            {t("runDetail.compare.button")}
            {canCompare ? <ChevronDown className="size-3 ml-1" /> : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[18rem]">
          <DropdownMenuLabel>
            {t("runDetail.compare.pickRun")}
          </DropdownMenuLabel>
          {!canCompare ? (
            <DropdownMenuItem disabled>
              {t("runDetail.compare.none")}
            </DropdownMenuItem>
          ) : (
            compareCandidates.slice(0, 20).map((other) => {
              const agent = agents.find((a) => a.id === other.agentId);
              return (
                <DropdownMenuItem
                  key={other.id}
                  onSelect={() => {
                    if (!projectId) return;
                    navigate(
                      `/projects/${projectId}/runs/compare?a=${r.id}&b=${other.id}`,
                    );
                  }}
                >
                  <span className="mono text-[10px] text-muted-foreground/70 mr-2">
                    {other.id.slice(0, 6)}
                  </span>
                  <span className="truncate flex-1">
                    {agent ? `@${agent.name}` : other.agentId.slice(0, 8)}
                  </span>
                  <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                    {other.status}
                  </span>
                </DropdownMenuItem>
              );
            })
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
