import { useEffect } from "react";
import { NavLink, useLocation, useMatch, useNavigate } from "react-router-dom";
import {
  Activity,
  ClipboardCheck,
  FileText,
  Folder,
  FolderTree,
  MessagesSquare,
  Settings as SettingsIcon,
  Users,
} from "lucide-react";
import { LoomLogo } from "./LoomLogo.js";
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
  | "settings"
  | null;

/**
 * Left rail — logo, then a stack of activity buttons (each: icon + label),
 * then settings pinned to the bottom. Project-scoped activities only show
 * when the URL is inside a project, so there is no "open a project" empty
 * drawer to apologize for.
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
        active === "history")
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
      icon: <Folder className="size-[18px]" />,
      label: t("activity.projects"),
      requiresProject: false,
    },
    {
      kind: "files",
      icon: <FolderTree className="size-[18px]" />,
      label: t("activity.files"),
      requiresProject: true,
    },
    {
      kind: "threads",
      icon: <MessagesSquare className="size-[18px]" />,
      label: t("activity.threads"),
      requiresProject: true,
    },
    {
      kind: "agents",
      icon: <Users className="size-[18px]" />,
      label: t("activity.agents"),
      requiresProject: true,
    },
    {
      kind: "skills",
      icon: <FileText className="size-[18px]" />,
      label: t("activity.skills"),
      requiresProject: true,
    },
    {
      kind: "review",
      icon: <ClipboardCheck className="size-[18px]" />,
      label: t("activity.review"),
      requiresProject: true,
    },
    {
      kind: "history",
      icon: <Activity className="size-[18px]" />,
      label: t("activity.history"),
      requiresProject: true,
    },
  ];
  const visible = items.filter((it) => !it.requiresProject || inProject);

  return (
    <aside className="flex w-[68px] shrink-0 flex-col items-stretch border-r border-border bg-card">
      <NavLink
        to="/"
        end
        className={({ isActive }) =>
          cn(
            "flex flex-col items-center justify-center gap-0.5 py-3 transition-colors",
            isActive ? "bg-foreground/[0.04]" : "hover:bg-muted/60",
          )
        }
        title="loom"
      >
        <LoomLogo className="size-6 dark:invert" />
        <span className="text-[10px] font-medium tracking-tight text-muted-foreground">
          loom
        </span>
      </NavLink>

      <nav className="flex-1 flex flex-col gap-px px-1 pt-1 pb-1">
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
        <ActivityButton
          active={active === "settings"}
          label={t("activity.settings")}
          onClick={() => onSelect(active === "settings" ? null : "settings")}
        >
          <SettingsIcon className="size-[18px]" />
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
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "relative flex flex-col items-center justify-center gap-1 rounded-md py-2 text-[10.5px] tracking-tight transition-colors",
        active
          ? "bg-foreground/[0.06] text-foreground"
          : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
      )}
    >
      {active ? (
        <span
          aria-hidden
          className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r"
          style={{ background: "var(--accent-strong)" }}
        />
      ) : null}
      {children}
      <span className="leading-none">{label}</span>
    </button>
  );
}
