import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useParams } from "react-router-dom";
import { Activity, FileText, MessageCircle, Users } from "lucide-react";
import { api } from "../api/client.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

/**
 * Wrapper for everything that lives inside a project: chat, agents,
 * skills, runs. Provides a single project header + a tab strip and
 * renders the active sub-route through <Outlet />. Each project owns
 * its own scope — we deliberately do NOT expose flat top-level Agents/
 * Skills/Runs anymore. You enter a project, then manage what's in it.
 */
export function ProjectShell() {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();

  const project = useQuery({
    queryKey: ["project", id],
    queryFn: () => api.getProject(id!),
    enabled: !!id,
  });

  if (project.isLoading || !project.data) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {project.isError
          ? (project.error as Error)?.message
          : t("common.loading")}
      </div>
    );
  }

  const p = project.data.project;

  return (
    <div className="flex flex-col h-full min-h-0">
      <Header project={p} />
      <Tabs projectId={p.id} />
      <div className="flex-1 min-h-0 flex flex-col">
        <Outlet />
      </div>
    </div>
  );
}

function Header({
  project,
}: {
  project: { id: string; name: string; path: string };
}) {
  return (
    <div className="flex items-center px-5 pt-4 pb-2 shrink-0">
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
      </div>
    </div>
  );
}

function Tabs({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const items = [
    {
      to: `/projects/${projectId}`,
      end: true,
      label: t("project.tab.chat"),
      icon: <MessageCircle className="size-3.5" />,
    },
    {
      to: `/projects/${projectId}/agents`,
      label: t("project.tab.agents"),
      icon: <Users className="size-3.5" />,
    },
    {
      to: `/projects/${projectId}/skills`,
      label: t("project.tab.skills"),
      icon: <FileText className="size-3.5" />,
    },
    {
      to: `/projects/${projectId}/runs`,
      label: t("project.tab.runs"),
      icon: <Activity className="size-3.5" />,
    },
  ];

  return (
    <nav className="flex items-center gap-0.5 border-b px-3 shrink-0">
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          end={it.end}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-1.5 px-3 py-2 text-sm transition-colors border-b-2 -mb-px",
              isActive
                ? "border-foreground text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )
          }
        >
          <span className="opacity-70">{it.icon}</span>
          {it.label}
        </NavLink>
      ))}
    </nav>
  );
}
