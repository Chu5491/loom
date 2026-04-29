import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { MessageCircle, Users } from "lucide-react";
import type { Agent, Run } from "@loom/core";
import { api } from "../api/client.js";
import { Button } from "../components/ui/button.js";
import {
  AgentMessage,
  Composer,
  DaySeparator,
  MemberRail,
  ThreadFrame,
  TooltipProvider,
  UserMessage,
  WorkingIndicator,
  buildForwardQuote,
  buildReplyQuote,
  dayKey,
  findParentAgent,
  isContinuation,
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

  const { threads, working, workingIds } = useRoomDerived(projectRuns, agentList);

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
  }, [threads.length, working.length]);

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
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }
  if (project.isError || !project.data) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-destructive">
        {project.error?.message ?? t("common.notFound")}
      </div>
    );
  }

  const p = project.data.project;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full min-w-0">
        <div className="flex-1 min-w-0 flex flex-col">
          <div ref={bodyRef} className="flex-1 overflow-y-auto py-3 bg-background">
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
            ) : threads.length === 0 ? (
              <Empty
                icon={<MessageCircle className="size-10 text-muted-foreground" />}
                title={t("chat.empty.firstMessage")}
              />
            ) : (
              threads.map((thread, ti) => {
                const prevThread = threads[ti - 1];
                const showDay =
                  !prevThread ||
                  dayKey(prevThread.lastTs) !== dayKey(thread.lastTs);
                return (
                  <div key={thread.rootId}>
                    {showDay ? <DaySeparator ts={thread.lastTs} /> : null}
                    <ThreadFrame thread={thread}>
                      {thread.items.map((item, i) => {
                        const prev = thread.items[i - 1];
                        const continuation = isContinuation(item, prev);
                        const a = agentList.find(
                          (x) => x.id === item.run.agentId,
                        );
                        const m = a
                          ? manifests.find((mm) => mm.kind === a.adapterKind)
                          : undefined;
                        if (item.kind === "user") {
                          // For continuations within a thread, surface the
                          // prior agent so the hand-off is explicit.
                          const parentAgent = findParentAgent(
                            item.run,
                            thread,
                            agentList,
                          );
                          return (
                            <UserMessage
                              key={`${item.run.id}-u`}
                              run={item.run}
                              target={a}
                              parentAgent={parentAgent}
                              isContinuation={continuation}
                            />
                          );
                        }
                        return (
                          <AgentMessage
                            key={`${item.run.id}-a`}
                            run={item.run}
                            agent={a}
                            manifest={m}
                            isContinuation={continuation}
                            onReply={handleReply}
                            onForward={handleForward}
                          />
                        );
                      })}
                    </ThreadFrame>
                  </div>
                );
              })
            )}
          </div>

          <WorkingIndicator workingAgents={working} />

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

        <MemberRail
          agents={agentList}
          manifests={manifests}
          workingIds={workingIds}
          selectedAgentId={agentId}
          onPick={(id) => setAgentId(id)}
          projectId={p.id}
        />
      </div>
    </TooltipProvider>
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
    <div className="flex flex-col items-center justify-center text-center py-20 px-6">
      {icon}
      <p className="mt-3 text-sm text-muted-foreground">{title}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
