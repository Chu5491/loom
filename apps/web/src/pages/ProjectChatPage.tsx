import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, MessageCircle, Users } from "lucide-react";
import type { Agent, Run } from "@loom/core";
import { api } from "../api/client.js";
import { Button } from "../components/ui/button.js";
import { Separator } from "../components/ui/separator.js";
import {
  AgentMessage,
  Composer,
  MemberPanel,
  TooltipProvider,
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
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  }
  if (project.isError || !project.data) {
    return (
      <p className="text-sm text-destructive">
        {project.error?.message ?? t("common.notFound")}
      </p>
    );
  }

  const p = project.data.project;

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="flex flex-col rounded-xl border bg-card overflow-hidden shadow-sm"
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
          className="flex-1 overflow-y-auto px-6 py-6 space-y-5 bg-background"
        >
          {agentList.length === 0 ? (
            <Empty
              icon={<Users className="size-10 text-muted-foreground" />}
              title={t("chat.empty.noAgents")}
              action={
                <Button asChild variant="outline" size="sm">
                  <Link to={`/agents?projectId=${p.id}`}>
                    {t("chat.manageAgents")}
                  </Link>
                </Button>
              }
            />
          ) : feed.length === 0 ? (
            <Empty
              icon={<MessageCircle className="size-10 text-muted-foreground" />}
              title={t("chat.empty.firstMessage")}
            />
          ) : (
            feed.map((item) => {
              const a = agentList.find((x) => x.id === item.run.agentId);
              const m = a
                ? manifests.find((mm) => mm.kind === a.adapterKind)
                : undefined;
              if (item.kind === "user") {
                return (
                  <UserMessage
                    key={`${item.run.id}-u`}
                    run={item.run}
                    target={a}
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
    </TooltipProvider>
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
    <div className="border-b px-5 py-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2 h-7 px-2 text-xs text-muted-foreground">
        <Link to="/projects">
          <ArrowLeft />
          {t("chat.back")}
        </Link>
      </Button>
      <div className="mt-2 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex size-11 items-center justify-center rounded-lg bg-foreground text-background text-base font-bold shrink-0">
            {initial}
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold truncate leading-tight">
              {project.name}
            </h1>
            <p
              className="text-[11px] text-muted-foreground mono truncate"
              title={project.path}
            >
              {project.path}
            </p>
            <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
              <Stat n={agentCount} label="agents" />
              <Separator orientation="vertical" className="h-3" />
              <Stat n={runCount} label="messages" />
              {workingCount > 0 ? (
                <>
                  <Separator orientation="vertical" className="h-3" />
                  <span className="font-medium text-sky-600 dark:text-sky-400 inline-flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-sky-500 animate-pulse" />
                    {workingCount} working
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button asChild variant="ghost" size="sm" className="h-8 text-xs">
            <Link to={`/agents?projectId=${project.id}`}>
              {t("chat.manageAgents")}
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="h-8 text-xs">
            <Link to="/specs">{t("chat.manageSkills")}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-semibold text-foreground">{n}</span>
      <span className="uppercase tracking-wide">{label}</span>
    </span>
  );
}

function Empty({
  icon,
  title,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      {icon}
      <p className="mt-3 text-sm text-muted-foreground">{title}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
