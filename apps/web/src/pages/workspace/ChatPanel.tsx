// 채팅 본문 + composer를 묶은 패널. 스크롤 sticky-bottom 유지, 부모 점프 로직.

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, Users } from "lucide-react";
import type { AdapterManifest, Agent, Run } from "@loom/core";
import { celebrate } from "../../lib/celebrate.js";
import {
  AgentMessage,
  Composer,
  DaySeparator,
  ThreadFrame,
  UserMessage,
  WorkingIndicator,
  buildForwardQuote,
  buildReplyQuote,
  buildSelectionQuote,
  dayKey,
  findParentAgent,
  isContinuation,
  type ThreadGroup,
} from "../../components/Chat.js";
import { Button } from "../../components/ui/button.js";
import { useI18n } from "../../context/I18nContext.js";
import { ChatStartHint } from "./ChatStartHint.js";
import { Empty } from "./Empty.js";

export function ChatPanel({
  project,
  agentList,
  manifests,
  threads,
  working,
  activeThreadId,
  threadHasContext,
  onAdoptThreadId,
  agentIds,
  setAgentIds,
  draft,
  setDraft,
  draftKey,
  setDraftKey,
  pendingJumpRunId,
  onConsumedJump,
}: {
  project: { id: string; name: string };
  agentList: Agent[];
  manifests: AdapterManifest[];
  threads: ThreadGroup[];
  working: Agent[];
  /** null = 다음 전송이 새 스레드 생성. 서버가 반환한 id를 onAdoptThreadId로 받음. */
  activeThreadId: string | null;
  threadHasContext: boolean;
  onAdoptThreadId: (id: string) => void;
  agentIds: string[];
  setAgentIds: (ids: string[]) => void;
  draft: string | undefined;
  setDraft: (d: string | undefined) => void;
  draftKey: number;
  setDraftKey: (fn: (n: number) => number) => void;
  pendingJumpRunId: string | null;
  onConsumedJump: () => void;
}) {
  const { t } = useI18n();
  const bodyRef = useRef<HTMLDivElement>(null);
  const stickyBottomRef = useRef(true);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      const wasNearBottom = stickyBottomRef.current;
      stickyBottomRef.current = dist < 100;
      // 다시 바닥으로 내려오면 unread 리셋.
      if (!wasNearBottom && stickyBottomRef.current) setUnread(0);
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (stickyBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    } else {
      setUnread((n) => n + 1);
    }
  }, [threads.length, working.length]);

  const scrollToBottom = () => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setUnread(0);
  };

  // 첫 성공 run 셀러브레이션 — localStorage 기반 1회만 발사.
  useEffect(() => {
    const succeeded = threads.some((thr) =>
      thr.runs.some((r) => r.status === "succeeded"),
    );
    if (succeeded) celebrate("firstSuccessfulRun");
  }, [threads]);

  // hand-off 배지의 점프와 동일한 scroll-and-flash 처리.
  useEffect(() => {
    if (!pendingJumpRunId) return;
    const id = window.setTimeout(() => {
      const el = document.querySelector(
        `[data-run-id="${pendingJumpRunId}"][data-msg-kind="agent"]`,
      ) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.remove("flash-target");
        void el.offsetWidth;
        el.classList.add("flash-target");
        window.setTimeout(() => el.classList.remove("flash-target"), 1500);
      }
      onConsumedJump();
    }, 50);
    return () => clearTimeout(id);
  }, [pendingJumpRunId, onConsumedJump, threads.length]);

  const handleReply = (run: Run, agent: Agent | undefined) => {
    if (agent) setAgentIds([agent.id]);
    setDraft(buildReplyQuote(run, agent, t));
    setDraftKey((k) => k + 1);
  };
  const handleHandoff = async (
    run: Run,
    fromAgent: Agent | undefined,
    toAgent: Agent,
  ) => {
    setAgentIds([toAgent.id]);
    setDraft(await buildForwardQuote(run, fromAgent, t));
    setDraftKey((k) => k + 1);
  };
  const handleQuoteSelection = (
    selection: string,
    run: Run,
    agent: Agent | undefined,
  ) => {
    setDraft(buildSelectionQuote(selection, agent, run.agentId, t));
    setDraftKey((k) => k + 1);
  };

  return (
    <>
      <div
        ref={bodyRef}
        className="relative flex-1 overflow-y-auto overflow-x-hidden bg-card subtle-scrollbar"
      >
        <div className="mx-auto w-full max-w-3xl py-3 px-4">
          {agentList.length === 0 ? (
            <Empty
              icon={<Users className="size-10 text-muted-foreground" />}
              title={t("chat.empty.noAgents")}
              action={
                <Button asChild variant="outline" size="sm">
                  <Link to={`/projects/${project.id}/agents`}>
                    {t("chat.manageAgents")}
                  </Link>
                </Button>
              }
            />
          ) : threads.length === 0 ? (
            <ChatStartHint agents={agentList} manifests={manifests} />
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
                      const a = agentList.find((x) => x.id === item.run.agentId);
                      const m = a
                        ? manifests.find((mm) => mm.kind === a.adapterKind)
                        : undefined;
                      if (item.kind === "user") {
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
                          allAgents={agentList}
                          allManifests={manifests}
                          onReply={handleReply}
                          onHandoff={handleHandoff}
                          onQuoteSelection={handleQuoteSelection}
                        />
                      );
                    })}
                  </ThreadFrame>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 위로 스크롤한 상태에서 새 메시지가 도착하면 하단에 떠오르는 jump 칩.
       *  클릭 = 부드럽게 바닥으로 + unread 리셋. AnimatePresence로 enter/exit. */}
      <div className="relative pointer-events-none">
        <AnimatePresence>
          {unread > 0 ? (
            <motion.button
              key="unread-jump"
              type="button"
              onClick={scrollToBottom}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              className="pointer-events-auto absolute bottom-2 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full border bg-popover px-3 h-7 text-xs font-medium shadow-lg hover:bg-muted transition-colors z-10"
            >
              <ArrowDown className="size-3.5" />
              {t("chat.unread", { n: unread })}
            </motion.button>
          ) : null}
        </AnimatePresence>
      </div>

      <WorkingIndicator workingAgents={working} />

      {agentList.length > 0 ? (
        <div className="border-t border-border bg-card shrink-0">
          <div className="mx-auto w-full max-w-3xl px-4">
            <Composer
              agents={agentList}
              manifests={manifests}
              agentIds={agentIds}
              onAgentIdsChange={setAgentIds}
              threadId={activeThreadId}
              threadHasContext={threadHasContext}
              onThreadCreated={onAdoptThreadId}
              initialDraft={draft}
              draftKey={draftKey}
              onSent={() => {
                setDraft(undefined);
                stickyBottomRef.current = true;
              }}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
