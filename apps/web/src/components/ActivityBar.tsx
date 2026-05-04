import { useEffect } from "react";
import { NavLink, useLocation, useMatch, useNavigate } from "react-router-dom";
import {
  Activity,
  ClipboardCheck,
  FileText,
  Folder,
  GitBranch,
  Plug,
  Settings as SettingsIcon,
  Users,
} from "lucide-react";
import { LoomLogo } from "./LoomLogo.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

export type ActivityKind =
  | "projects"
  | "skills"
  | "mcps"
  | "agents"
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
    // 시스템 레벨 — 어떤 프로젝트에 있든 같은 카탈로그.
    if (kind === "projects") return "/projects";
    if (kind === "skills") return "/skills";
    if (kind === "mcps") return "/mcps";
    // 프로젝트 스코프 — 프로젝트 안에서만 의미 있음.
    if (!projectId) return null;
    switch (kind) {
      case "agents":
        return `/projects/${projectId}/agents`;
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
  // skills / mcps는 시스템 레벨이라 프로젝트 안 들어가도 그대로 유지.
  useEffect(() => {
    if (
      !inProject &&
      (active === "agents" ||
        active === "review" ||
        active === "history" ||
        active === "git")
    ) {
      onSelect("projects");
    }
  }, [inProject, active, onSelect]);

  // group을 사용해 시각적으로 묶음 — 같은 그룹은 붙여서, 다른 그룹 사이는
  // 얇은 구분선. 1: 네비, 2: 워크스페이스 아티팩트, 3: 구성, 4: 인사이트.
  const items: ReadonlyArray<{
    kind: ActivityKind;
    icon: React.ReactNode;
    label: string;
    requiresProject: boolean;
    group: 1 | 2 | 3 | 4;
  }> = [
    {
      kind: "projects",
      icon: <Folder className="size-5" />,
      label: t("activity.projects"),
      requiresProject: false,
      group: 1,
    },
    // 시스템 레벨 카탈로그 — 어떤 프로젝트에 있든 표시. 에이전트는 여기서
    // 골라 자기 loadout을 구성한다.
    {
      kind: "skills",
      icon: <FileText className="size-5" />,
      label: t("activity.skills"),
      requiresProject: false,
      group: 1,
    },
    {
      kind: "mcps",
      icon: <Plug className="size-5" />,
      label: t("activity.mcps"),
      requiresProject: false,
      group: 1,
    },
    {
      kind: "git",
      icon: <GitBranch className="size-5" />,
      label: t("activity.git"),
      requiresProject: true,
      group: 2,
    },
    {
      kind: "agents",
      icon: <Users className="size-5" />,
      label: t("activity.agents"),
      requiresProject: true,
      group: 3,
    },
    {
      kind: "review",
      icon: <ClipboardCheck className="size-5" />,
      label: t("activity.review"),
      requiresProject: true,
      group: 4,
    },
    {
      kind: "history",
      icon: <Activity className="size-5" />,
      label: t("activity.history"),
      requiresProject: true,
      group: 4,
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
            // h-10으로 통일 — 옆 panel header(`h-10`) 및 워크스페이스 TeamRibbon
            // (`py-2` ≈ 40px)과 가로 라인을 정확히 맞춤. 이전 h-12는 8px 어긋남.
            "flex items-center justify-center h-10 border-b border-border transition-colors",
            isActive ? "bg-foreground/[0.06]" : "hover:bg-muted/60",
          )
        }
        title="loom"
      >
        <LoomLogo className="size-5 dark:invert" />
      </NavLink>

      <nav className="flex-1 flex flex-col items-stretch px-1.5 py-2 gap-0.5">
        {visible.map((it, i) => {
          const prev = visible[i - 1];
          const showDivider = prev && prev.group !== it.group;
          return (
            <div key={it.kind} className="contents">
              {showDivider ? (
                <div
                  aria-hidden
                  className="my-1 mx-1.5 h-px bg-border/60"
                />
              ) : null}
              <ActivityButton
                active={active === it.kind}
                label={it.label}
                onClick={() => handleClick(it.kind)}
              >
                {it.icon}
              </ActivityButton>
            </div>
          );
        })}
        <div className="flex-1" />
        <div className="my-1 mx-1.5 h-px bg-border/70" aria-hidden />
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
