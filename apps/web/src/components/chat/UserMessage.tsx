// 사용자가 보낸 메시지 한 줄.

import { ArrowRight } from "lucide-react";
import type { Agent, Run } from "@loom/core";
import { useI18n } from "../../context/I18nContext.js";
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
  return (
    <MessageRow
      avatar={<UserAvatar />}
      name={t("chat.message.you")}
      timestamp={run.createdAt}
      isContinuation={isContinuation}
      runId={{ id: run.id, kind: "user" }}
      tag={
        target ? (
          <span className="inline-flex items-center gap-1 text-[11px] opacity-70">
            <ArrowRight className="size-3" />
            <span className="font-medium">@{target.name}</span>
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
      <p className="whitespace-pre-wrap break-words">
        {run.prompt}
      </p>
    </MessageRow>
  );
}
