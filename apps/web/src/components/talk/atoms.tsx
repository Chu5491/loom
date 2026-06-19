// Talk 워크스페이스의 작은 표시 컴포넌트 — 여러 곳이 공유한다(Avatar 는 패널·버블·작성기).

import type { ReactNode } from "react";
import { Bot, Workflow } from "lucide-react";
import type { AgentSpec } from "@loom/core";
import { AgentAvatar } from "../AgentAvatar.js";
import { useI18n } from "../../context/I18nContext.js";

export function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex h-full max-w-3xl items-center justify-center px-6">
      <p className="text-center text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

// 에이전트 아바타 = 그 CLI 의 브랜드 아이콘(Office 와 동일). 미상이면 글자 폴백.
export function Avatar({ agent, size = 32 }: { agent?: AgentSpec; size?: number }) {
  if (agent) return <AgentAvatar adapter={agent.adapter} size={size} className="rounded-lg" />;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-lg border border-border bg-muted/60 font-mono text-xs text-muted-foreground"
      style={{ width: size, height: size }}
    >
      ?
    </span>
  );
}

export function Welcome({ activeAgent }: { activeAgent?: AgentSpec }) {
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-accent text-white shadow-[var(--shadow-glow)]">
        <Bot className="size-6" />
      </span>
      <h2 className="font-display text-xl font-semibold">{t("talk.welcomeTitle")}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        {activeAgent ? t("talk.welcomeWith", { name: activeAgent.label || activeAgent.name }) : t("talk.welcomeSub")}
      </p>
    </div>
  );
}

export function HandoffDivider({ from, to }: { from: string; to: string }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-primary/40" />
      <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-0.5 text-[11px] text-muted-foreground">
        <Workflow className="size-3 text-primary" />
        <span className="font-medium text-foreground">@{from}</span>
        <span className="text-primary">→</span>
        <span className="font-medium text-foreground">@{to}</span>
      </span>
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-primary/40" />
    </div>
  );
}

export function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary/15 px-4 py-2.5 text-sm leading-relaxed">
        {text}
      </div>
    </div>
  );
}
