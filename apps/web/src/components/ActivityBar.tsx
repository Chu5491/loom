import { useEffect } from "react";
import { NavLink, useLocation, useMatch, useNavigate } from "react-router-dom";
import {
  Activity,
  ClipboardCheck,
  FileText,
  Folder,
  FolderTree,
  GitBranch,
  MessagesSquare,
  Settings as SettingsIcon,
  Users,
} from "lucide-react";
import { LoomLogo } from "./LoomLogo.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

export type ActivityKind =
  | "projects"
  | "files"
  | "threads"
  | "agents"
  | "skills"
  | "review"
  | "history"
  | "git"
  | "settings"
  | null;

/**
 * Left rail — logo, then a stack of activity buttons (icon-only with
 * hover tooltip), then settings pinned to the bottom. Project-scoped
 * activities only show when the URL is inside a project so there is no
 * empty-drawer apology.
 */
export function ActivityBar({
  active,
  onSelect,
}: {
  active: ActivityKind;
  onSelect: (next: ActivityKind) => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const projectMatch = useMatch("/projects/:id/*");
  const inProject = !!projectMatch?.params?.id;
  const projectId = projectMatch?.params?.id;

  // Each activity has a "home" route. Files / Threads belong to the
  // workspace (chat); the others are dedicated pages. Clicking the
  // icon should land on that route — otherwise the side panel opens
  // but the main content sits on the wrong page.
  const routeFor = (kind: ActivityKind): string | null => {
    if (kind === "projects") return "/projects";
    if (!projectId) return null;
    switch (kind) {
      case "files":
      case "threads":
        return `/projects/${projectId}`;
      case "agents":
        return `/projects/${projectId}/agents`;
      case "skills":
        return `/projects/${projectId}/skills`;
      case "review":
        return `/projects/${projectId}/review`;
      case "history":
        return `/projects/${projectId}/runs`;
      case "git":
        return `/projects/${projectId}`;
      default:
        return null;
    }
  };

  const handleClick = (kind: ActivityKind) => {
    const route = routeFor(kind);
    const onTargetRoute = route !== null && location.pathname === route;
    if (route !== null && !onTargetRoute) {
      // Going somewhere new — surface the panel for context too.
      navigate(route);
      onSelect(kind);
      return;
    }
    // Already on the right route, or nowhere to go (settings) — toggle.
    onSelect(active === kind ? null : kind);
  };

  // Drop a saved project-scoped activity if the user is no longer in a
  // project — otherwise the panel would open empty on first paint.
  useEffect(() => {
    if (
      !inProject &&
      (active === "files" ||
        active === "threads" ||
        active === "agents" ||
        active === "skills" ||
        active === "review" ||
        active === "history" ||
        active === "git")
    ) {
      onSelect("projects");
    }
  }, [inProject, active, onSelect]);

  const items: ReadonlyArray<{
    kind: ActivityKind;
    icon: React.ReactNode;
    label: string;
    requiresProject: boolean;
  }> = [
    {
      kind: "projects",
      icon: <Folder className="size-5" />,
      label: t("activity.projects"),
      requiresProject: false,
    },
    {
      kind: "files",
      icon: <FolderTree className="size-5" />,
      label: t("activity.files"),
      requiresProject: true,
    },
    {
      kind: "threads",
      icon: <MessagesSquare className="size-5" />,
      label: t("activity.threads"),
      requiresProject: true,
    },
    {
      kind: "agents",
      icon: <Users className="size-5" />,
      label: t("activity.agents"),
      requiresProject: true,
    },
    {
      kind: "skills",
      icon: <FileText className="size-5" />,
      label: t("activity.skills"),
      requiresProject: true,
    },
    {
      kind: "review",
      icon: <ClipboardCheck className="size-5" />,
      label: t("activity.review"),
      requiresProject: true,
    },
    {
      kind: "history",
      icon: <Activity className="size-5" />,
      label: t("activity.history"),
      requiresProject: true,
    },
    {
      kind: "git",
      icon: <GitBranch className="size-5" />,
      label: t("activity.git"),
      requiresProject: true,
    },
  ];
  const visible = items.filter((it) => !it.requiresProject || inProject);

  return (
    <aside className="flex w-12 shrink-0 flex-col items-stretch border-r border-border bg-card">
      <NavLink
        to="/"
        end
        className={({ isActive }) =>
          cn(
            "flex items-center justify-center h-12 border-b border-border transition-colors",
            isActive ? "bg-foreground/[0.06]" : "hover:bg-muted/60",
          )
        }
        title="loom"
      >
        <LoomLogo className="size-6 dark:invert" />
      </NavLink>

      <nav className="flex-1 flex flex-col items-stretch px-1.5 py-2 gap-0.5">
        {visible.map((it) => (
          <ActivityButton
            key={it.kind}
            active={active === it.kind}
            label={it.label}
            onClick={() => handleClick(it.kind)}
          >
            {it.icon}
          </ActivityButton>
        ))}
        <div className="flex-1" />
        <div className="my-1 mx-1 h-px bg-border/70" aria-hidden />
        <ActivityButton
          active={active === "settings"}
          label={t("activity.settings")}
          onClick={() => onSelect(active === "settings" ? null : "settings")}
        >
          <SettingsIcon className="size-5" />
        </ActivityButton>
      </nav>
    </aside>
  );
}

function ActivityButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          aria-pressed={active}
          className={cn(
            "relative flex items-center justify-center h-9 rounded-md transition-colors",
            active
              ? "bg-foreground/[0.08] text-foreground"
              : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
          )}
        >
          {active ? (
            <span
              aria-hidden
              className="absolute -left-1.5 top-1.5 bottom-1.5 w-[2px] rounded-r-full bg-foreground"
            />
          ) : null}
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
