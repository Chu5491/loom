import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import type { AdapterManifest, Agent, Run } from "@loom/core";
import { AgentAvatar } from "./Chat.js";
import { Button } from "./ui/button.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";
import { agentColorFor, classesFor } from "./agentColor.js";

/**
 * Horizontal "who's online and doing what" strip that lives at the
 * top of the workspace. Replaces the old right-side MemberRail —
 * the same information, but laid out across the top so the chat
 * itself can take the full center column.
 *
 * Each agent is a small pill: avatar + name + status. Working agents
 * float to the front (with a pulsing dot and elapsed time on the
 * latest active run); idle agents trail after them, dimmed. Clicking
 * a pill selects that agent as the composer's target — the same
 * gesture the rail used to support, just relocated.
 *
 * The strip scrolls horizontally on overflow so even projects with
 * twenty agents stay one row tall.
 */
export function TopAgentsStrip({
  agents,
  manifests,
  workingIds,
  runs,
  selectedAgentId,
  onPick,
  projectId,
}: {
  agents: Agent[];
  manifests: AdapterManifest[];
  workingIds: Set<string>;
  /** Project's recent runs — used to surface "what is each working
   *  agent currently doing" via the latest active run per agent. */
  runs: Run[];
  selectedAgentId?: string;
  onPick: (agentId: string) => void;
  projectId: string;
}) {
  const { t } = useI18n();

  // Latest active run per agent — when an agent is busy, we show how
  // long they've been at it. We use the most recent createdAt so
  // hand-off chains report the freshest run.
  const latestActiveByAgent = new Map<string, Run>();
  for (const r of runs) {
    if (r.status !== "queued" && r.status !== "running") continue;
    const cur = latestActiveByAgent.get(r.agentId);
    if (!cur || r.createdAt > cur.createdAt) {
      latestActiveByAgent.set(r.agentId, r);
    }
  }

  // Working agents first, then idle. Within each group, alpha sort so
  // the strip's order is stable across renders (no jitter as runs
  // start/finish).
  const sorted = [...agents].sort((a, b) => {
    const aw = workingIds.has(a.id) ? 0 : 1;
    const bw = workingIds.has(b.id) ? 0 : 1;
    if (aw !== bw) return aw - bw;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0 bg-muted/10 overflow-x-auto">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground shrink-0 mr-1">
        {t("topStrip.title")} · {agents.length}
      </span>
      {sorted.length === 0 ? (
        <span className="text-xs text-muted-foreground/70 italic">
          {t("topStrip.empty")}
        </span>
      ) : (
        <ul className="flex items-center gap-1.5 shrink-0">
          {sorted.map((a) => (
            <li key={a.id}>
              <AgentPill
                agent={a}
                manifest={manifests.find((m) => m.kind === a.adapterKind)}
                working={workingIds.has(a.id)}
                activeRun={latestActiveByAgent.get(a.id)}
                selected={a.id === selectedAgentId}
                onPick={onPick}
              />
            </li>
          ))}
        </ul>
      )}
      <Button
        asChild
        variant="ghost"
        size="icon"
        className="size-6 shrink-0 ml-auto text-muted-foreground"
        title={t("chat.manageAgents")}
      >
        <Link
          to={`/projects/${projectId}/agents`}
          aria-label={t("chat.manageAgents")}
        >
          <Plus className="size-3.5" />
        </Link>
      </Button>
    </div>
  );
}

function AgentPill({
  agent,
  manifest,
  working,
  activeRun,
  selected,
  onPick,
}: {
  agent: Agent;
  manifest: AdapterManifest | undefined;
  working: boolean;
  activeRun: Run | undefined;
  selected: boolean;
  onPick: (id: string) => void;
}) {
  const cls = classesFor(agentColorFor(agent.id));
  const elapsed = activeRun ? elapsedSecs(activeRun) : 0;
  return (
    <button
      type="button"
      onClick={() => onPick(agent.id)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors shrink-0",
        selected
          ? "border-foreground/50 bg-foreground/5"
          : "border-border hover:bg-muted/50",
        !working && "opacity-60 hover:opacity-100",
      )}
      title={
        working
          ? `${agent.name} · running ${formatElapsed(elapsed)}`
          : agent.name
      }
    >
      <AgentAvatar
        agent={agent}
        manifest={manifest}
        size="sm"
        working={working}
      />
      <span className={cn("font-medium", cls.text)}>@{agent.name}</span>
      {working ? (
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground mono ml-0.5">
          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
          {formatElapsed(elapsed)}
        </span>
      ) : null}
    </button>
  );
}

function elapsedSecs(run: Run): number {
  const start = run.startedAt ?? run.createdAt;
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(start).getTime()) / 1000),
  );
}

function formatElapsed(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m`;
}
