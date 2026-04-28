import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import type { Agent, Run } from "@loom/core";
import { api } from "../api/client.js";
import { Card } from "../components/ui.js";
import { Composer, MessagePair } from "../components/Chat.js";
import { useI18n } from "../context/I18nContext.js";

export function ProjectChatPage() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();

  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.getProject(projectId!),
    enabled: !!projectId,
  });
  const agents = useQuery({
    queryKey: ["agents", { projectId }],
    queryFn: () => api.listAgents({ projectId }),
    enabled: !!projectId,
  });
  const adapters = useQuery({
    queryKey: ["adapters"],
    queryFn: api.listAdapters,
  });

  // Project-scoped runs come from listing all recent runs and filtering by
  // the agent set. /api/runs has no projectId filter — it'd be cheap to add
  // but for v0.1 the client-side filter is fine since limit caps the load.
  const projectAgentIds = useMemo(
    () => new Set((agents.data?.agents ?? []).map((a) => a.id)),
    [agents.data],
  );
  const runs = useQuery({
    queryKey: ["runs", { projectId }],
    queryFn: () => api.listRuns({ limit: 100 }),
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return false;
      const hasActive = data.runs.some(
        (r) => r.status === "queued" || r.status === "running",
      );
      return hasActive ? 2000 : false;
    },
    enabled: !!projectId,
  });
  const projectRuns = useMemo(() => {
    const list = (runs.data?.runs ?? []).filter((r) =>
      projectAgentIds.has(r.agentId),
    );
    // Show oldest first so the chat reads top-to-bottom like a conversation.
    return [...list].reverse();
  }, [runs.data, projectAgentIds]);

  // Composer state — agent target + draft. Lifted up so the Reply button on
  // a past message can pre-fill both at once.
  const [targetAgentId, setTargetAgentId] = useState<string | undefined>();
  const [draft, setDraft] = useState<string | undefined>();
  const [draftKey, setDraftKey] = useState(0);

  // Auto-pick the first agent when the project loads.
  useEffect(() => {
    if (!targetAgentId && agents.data?.agents.length) {
      setTargetAgentId(agents.data.agents[0]!.id);
    }
  }, [agents.data, targetAgentId]);

  // Auto-scroll to bottom on new runs unless the user scrolled up.
  const bodyRef = useRef<HTMLDivElement>(null);
  const stickyBottomRef = useRef(true);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickyBottomRef.current = dist < 100;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (stickyBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [projectRuns.length]);

  const handleReply = (run: Run, agent: Agent | undefined) => {
    setTargetAgentId(agent?.id ?? targetAgentId);
    setDraft(buildQuote(run, agent, t));
    setDraftKey((k) => k + 1);
  };

  if (project.isLoading || agents.isLoading) {
    return <p className="text-zinc-500 text-sm">{t("common.loading")}</p>;
  }
  if (project.isError || !project.data) {
    return (
      <p className="text-red-500 dark:text-red-400 text-sm">
        {project.error?.message ?? t("common.notFound")}
      </p>
    );
  }

  const p = project.data.project;
  const agentList = agents.data?.agents ?? [];
  const manifests = adapters.data?.adapters ?? [];

  return (
    <div
      className="flex flex-col rounded-lg border border-zinc-200 bg-white overflow-hidden dark:border-zinc-800 dark:bg-zinc-950"
      style={{ height: "calc(100vh - 180px)" }}
    >
      <Header project={p} />

      <div
        ref={bodyRef}
        className="flex-1 overflow-y-auto px-4 py-5 space-y-4 bg-zinc-50/40 dark:bg-zinc-900/40"
      >
        {agentList.length === 0 ? (
          <Empty>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {t("chat.empty.noAgents")}
            </p>
            <Link
              to={`/agents?projectId=${p.id}`}
              className="mt-2 inline-block text-sm text-sky-600 hover:underline dark:text-sky-300"
            >
              {t("chat.manageAgents")} →
            </Link>
          </Empty>
        ) : projectRuns.length === 0 ? (
          <Empty>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {t("chat.empty.firstMessage")}
            </p>
          </Empty>
        ) : (
          projectRuns.map((run) => {
            const agent = agentList.find((a) => a.id === run.agentId);
            const manifest = agent
              ? manifests.find((m) => m.kind === agent.adapterKind)
              : undefined;
            return (
              <MessagePair
                key={run.id}
                run={run}
                agent={agent}
                manifest={manifest}
                onReply={handleReply}
              />
            );
          })
        )}
      </div>

      {agentList.length > 0 ? (
        <Composer
          agents={agentList}
          manifests={manifests}
          initialAgentId={targetAgentId}
          initialDraft={draft}
          draftKey={draftKey}
          onSent={() => {
            setDraft(undefined);
            stickyBottomRef.current = true;
          }}
        />
      ) : null}
    </div>
  );
}

function Header({
  project,
}: {
  project: { id: string; name: string; path: string };
}) {
  const { t } = useI18n();
  return (
    <div className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Link
            to="/projects"
            className="text-[11px] text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            {t("chat.back")}
          </Link>
          <h1 className="font-semibold text-base truncate">{project.name}</h1>
          <p className="text-[11px] text-zinc-500 mono truncate" title={project.path}>
            {project.path}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs shrink-0">
          <Link
            to={`/agents?projectId=${project.id}`}
            className="text-sky-600 hover:underline dark:text-sky-300"
          >
            {t("chat.manageAgents")}
          </Link>
          <Link
            to="/specs"
            className="text-sky-600 hover:underline dark:text-sky-300"
          >
            {t("chat.manageSkills")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <Card className="text-center py-8 border-dashed bg-transparent dark:bg-transparent">
      {children}
    </Card>
  );
}

function buildQuote(
  run: Run,
  agent: Agent | undefined,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const name = agent?.name ?? run.agentId.slice(0, 8);
  const heading = t("chat.message.quoteHeading", { agent: name });
  // We quote the user's original prompt — the agent's output isn't on the
  // run record (lives in the log file). Users who want to quote agent text
  // can copy from the bubble directly. Keeps the prompt small + auditable.
  const lines = run.prompt.split("\n").map((l) => `> ${l}`);
  return `${heading}\n${lines.join("\n")}\n\n`;
}
