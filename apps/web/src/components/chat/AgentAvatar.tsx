// 에이전트/사용자 아바타. 어댑터 브랜드 아이콘을 그대로 노출하고 working 표시는
// 우하단 작은 컬러 도트로.

import { User } from "lucide-react";
import type { AdapterManifest, Agent } from "@loom/core";
import { AdapterIcon } from "../AdapterIcon.js";
import { agentColorOf, classesFor } from "../agentColor.js";
import { cn } from "../../lib/utils.js";

export function AgentAvatar({
  agent,
  manifest,
  working,
  size = "md",
}: {
  agent: Agent;
  manifest: AdapterManifest | undefined;
  working?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const cls = classesFor(agentColorOf(agent));
  const dim = size === "sm" ? "size-6" : size === "lg" ? "size-10" : "size-9";
  const inner = size === "sm" ? 20 : size === "lg" ? 36 : 32;

  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", dim)}>
      {manifest ? (
        <AdapterIcon manifest={manifest} size={inner} />
      ) : (
        <span className={cn("text-xs font-semibold", cls.text)}>?</span>
      )}
      {working ? (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-background",
            cls.dot,
          )}
        />
      ) : null}
    </span>
  );
}

export function UserAvatar({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const dim = size === "sm" ? "size-6" : size === "lg" ? "size-10" : "size-9";
  const inner = size === "sm" ? "size-3.5" : size === "lg" ? "size-5" : "size-4";
  // 아바타에 "나" 글자를 쓰면 헤더의 이름과 시각적으로 중복됨. 무채색 인물 글리프 사용.
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center text-muted-foreground", dim)}>
      <User className={inner} />
    </span>
  );
}
