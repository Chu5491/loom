import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import type { Agent, Run } from "@loom/core";
import { api } from "../api/client.js";
import {
  AgentMessage,
  Composer,
  MemberPanel,
  UserMessage,
  WorkingIndicator,
  buildForwardQuote,
  buildReplyQuote,
  useRoomDerived,
} from "../components/Chat.js";
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

  const projectAgentIds = useMemo(
    () => new Set((agents.data?.agents ?? []).map((a) => a.id)),
    [agents.data],
  );
  const runsQuery = useQuery({
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
  const projectRuns = useMemo(
    () =>
      (runsQuery.data?.runs ?? []).filter((r) => projectAgentIds.has(r.agentId)),
    [runsQuery.data, projectAgentIds],
  );

  const agentList = agents.data?.agents ?? [];
  const manifests = adapters.data?.adapters ?? [];

  const { feed, working, workingIds } = useRoomDerived(projectRuns, agentList);

  const [agentId, setAgentId] = useState<string>("");
  const [draft, setDraft] = useState<string | undefined>();
  const [draftKey, setDraftKey] = useState(0);

  useEffect(() => {
    if (!agentId && agentList.length) setAgentId(agentList[0]!.id);
  }, [agentList, agentId]);

  // Auto-scroll: stick to bottom unless the user scrolled away.
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
    if (el && stickyBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [feed.length, working.length]);

  const handleReply = (run: Run, agent: Agent | undefined) => {
    if (agent) setAgentId(agent.id);
    setDraft(buildReplyQuote(run, agent, t));
    setDraftKey((k) => k + 1);
  };
  const handleForward = async (run: Run, agent: Agent | undefined) => {
    setDraft(await buildForwardQuote(run, agent, t));
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

  return (
    <div
      className="flex flex-col rounded-xl border border-zinc-200 bg-white overflow-hidden dark:border-zinc-800 dark:bg-zinc-950 shadow-sm"
      style={{ height: "calc(100vh - 180px)" }}
    >
      <Header
        project={p}
        agentCount={agentList.length}
        runCount={projectRuns.length}
        workingCount={working.length}
      />

      {agentList.length > 0 ? (
        <MemberPanel
          agents={agentList}
          manifests={manifests}
          workingIds={workingIds}
          selectedAgentId={agentId}
          onPick={(id) => setAgentId(id)}
        />
      ) : null}

      <div
        ref={bodyRef}
        className="flex-1 overflow-y-auto px-5 py-6 space-y-5 bg-gradient-to-b from-zinc-50/40 to-white dark:from-zinc-900/40 dark:to-zinc-950"
      >
        {agentList.length === 0 ? (
          <Empty>
            <p className="text-3xl">👥</p>
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
              {t("chat.empty.noAgents")}
            </p>
            <Link
              to={`/agents?projectId=${p.id}`}
              className="mt-3 inline-block text-sm font-medium text-sky-600 hover:underline dark:text-sky-300"
            >
              {t("chat.manageAgents")} →
            </Link>
          </Empty>
        ) : feed.length === 0 ? (
          <Empty>
            <p className="text-3xl">💬</p>
            <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
              {t("chat.empty.firstMessage")}
            </p>
          </Empty>
        ) : (
          feed.map((item) => {
            const a = agentList.find((x) => x.id === item.run.agentId);
            const m = a ? manifests.find((mm) => mm.kind === a.adapterKind) : undefined;
            if (item.kind === "user") {
              return (
                <UserMessage
                  key={`${item.run.id}-u`}
                  run={item.run}
                  target={a}
                  manifest={m}
                />
              );
            }
            return (
              <AgentMessage
                key={`${item.run.id}-a`}
                run={item.run}
                agent={a}
                manifest={m}
                onReply={handleReply}
                onForward={handleForward}
              />
            );
          })
        )}
      </div>

      <WorkingIndicator workingAgents={working} manifests={manifests} />

      {agentList.length > 0 ? (
        <Composer
          agents={agentList}
          manifests={manifests}
          agentId={agentId}
          onAgentChange={setAgentId}
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
  agentCount,
  runCount,
  workingCount,
}: {
  project: { id: string; name: string; path: string; description: string | null };
  agentCount: number;
  runCount: number;
  workingCount: number;
}) {
  const { t } = useI18n();
  const initial = project.name.trim()[0]?.toUpperCase() ?? "?";
  return (
    <div className="border-b border-zinc-200 dark:border-zinc-800 bg-gradient-to-r from-white via-zinc-50/40 to-white dark:from-zinc-950 dark:via-zinc-900/30 dark:to-zinc-950 px-5 py-3.5">
      <Link
        to="/projects"
        className="text-[11px] text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        {t("chat.back")}
      </Link>
      <div className="mt-1 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <span className="w-11 h-11 rounded-xl bg-gradient-to-br from-zinc-900 to-zinc-700 text-white flex items-center justify-center text-lg font-bold shrink-0 dark:from-zinc-100 dark:to-zinc-300 dark:text-zinc-900 shadow-sm">
            {initial}
          </span>
          <div className="min-w-0">
            <h1 className="font-semibold text-base truncate leading-tight text-zinc-900 dark:text-zinc-100">
              {project.name}
            </h1>
            <p
              className="text-[11px] text-zinc-500 mono truncate"
              title={project.path}
            >
              {project.path}
            </p>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
              <Stat label="agents" value={agentCount} />
              <span>·</span>
              <Stat label="messages" value={runCount} />
              {workingCount > 0 ? (
                <>
                  <span>·</span>
                  <span className="text-sky-600 dark:text-sky-400 font-medium">
                    {workingCount} working
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs shrink-0">
          <Link
            to={`/agents?projectId=${project.id}`}
            className="text-zinc-600 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            {t("chat.manageAgents")}
          </Link>
          <Link
            to="/specs"
            className="text-zinc-600 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            {t("chat.manageSkills")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span>
      <span className="font-semibold text-zinc-700 dark:text-zinc-300">
        {value}
      </span>{" "}
      <span className="uppercase tracking-wide">{label}</span>
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-center py-12 px-6 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700">
      {children}
    </div>
  );
}
