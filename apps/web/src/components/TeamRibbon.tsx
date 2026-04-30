import { Hash } from "lucide-react";
import type { Agent, Project, Thread } from "@loom/core";
import { useI18n } from "../context/I18nContext.js";

/**
 * Channel banner pinned to the top of the workspace. Reads like a
 * Slack header: `#project / thread`. The agent presence row used to
 * live here too — it's gone now because the team list lives on the
 * sidebar and the right rail already shows live activity, so the
 * banner stays one quiet line.
 */
export function TeamRibbon({
  project,
  agents,
  workingIds,
  activeThread,
}: {
  project: Project;
  agents: Agent[];
  workingIds: Set<string>;
  activeThread: Thread | null;
}) {
  const { t } = useI18n();
  const workingCount = agents.filter((a) => workingIds.has(a.id)).length;

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-card shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <Hash className="size-4 text-muted-foreground/70 shrink-0" />
        <div className="flex items-baseline gap-2 min-w-0">
          <span
            className="text-[15px] font-semibold tracking-tight truncate"
            title={project.path}
          >
            {project.name}
          </span>
          {activeThread ? (
            <span
              className="text-xs text-muted-foreground/80 truncate"
              title={activeThread.name}
            >
              {activeThread.name}
            </span>
          ) : null}
        </div>
        {workingCount > 0 ? (
          <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400 mono shrink-0">
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {t("teamRibbon.workingCount", { n: workingCount })}
          </span>
        ) : null}
      </div>
    </div>
  );
}
