// 사용자가 보낸 메시지 한 줄.

import { ArrowRight } from "lucide-react";
import type { Agent, Run } from "@loom/core";
import { useI18n } from "../../context/I18nContext.js";
import { cn } from "../../lib/utils.js";
import { agentColorOf, classesFor } from "../agentColor.js";
import { MessageRow, ParentReference } from "./MessageRow.js";
import { UserAvatar } from "./AgentAvatar.js";

export function UserMessage({
  run,
  target,
  parentAgent,
  isContinuation,
}: {
  run: Run;
  target: Agent | undefined;
  /** 이전 run에서 이어진 경우, 그 부모 run의 응답자.
   *  "↳ from @prev" 알약을 띄워 hand-off 출처를 표시 + 클릭 점프. */
  parentAgent?: Agent;
  isContinuation: boolean;
}) {
  const { t } = useI18n();
  const cls = target ? classesFor(agentColorOf(target)) : null;
  return (
    <MessageRow
      avatar={<UserAvatar />}
      name={t("chat.message.you")}
      timestamp={run.createdAt}
      isContinuation={isContinuation}
      runId={{ id: run.id, kind: "user" }}
      tag={
        target ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <ArrowRight className="size-3" />
            <span className={cn("font-medium", cls?.text)}>@{target.name}</span>
          </span>
        ) : undefined
      }
    >
      {parentAgent && run.parentRunId ? (
        <ParentReference
          parentAgent={parentAgent}
          parentRunId={run.parentRunId}
        />
      ) : null}
      <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
        {run.prompt}
      </p>
    </MessageRow>
  );
}
