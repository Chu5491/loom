import type { Agent, Project, Thread } from "@loom/core";

export function TeamRibbon({
  project,
  activeThread,
}: {
  project: Project;
  agents?: Agent[];
  workingIds?: Set<string>;
  touchingIds?: Set<string>;
  activeThread: Thread | null;
  threadList?: Thread[];
}) {
  return (
    <div className="flex items-center px-5 h-10 border-b border-border/60 bg-card shrink-0">
      <span
        className="text-sm font-semibold tracking-tight truncate"
        title={project.path}
      >
        {project.name}
      </span>
      {activeThread ? (
        <span
          className="text-xs text-muted-foreground/50 ml-2 truncate"
          title={activeThread.name}
        >
          / {activeThread.name}
        </span>
      ) : null}
    </div>
  );
}
