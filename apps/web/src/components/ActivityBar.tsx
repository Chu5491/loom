import { NavLink, useLocation, useMatch, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ChevronDown,
  ClipboardCheck,
  Files as FilesIcon,
  GitBranch,
  Home,
  Users,
} from "lucide-react";
import { LoomLogo } from "./LoomLogo.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";
import { api } from "../api/client.js";
import { agentColorFor, classesFor, initialFor } from "./agentColor.js";
import { useConfirm } from "./ConfirmDialog.js";

// 프로젝트 안에서만 등장하는 항목들. lobby (/projects, /skills, /mcps) 의 nav 는
// MainSidebar 가 별도로 그림 — 모드별 모양 자체가 달라서 컴포넌트가 분리됨.
export type ActivityKind =
  | "projects"
  | "files"
  | "skills"
  | "mcps"
  | "agents"
  | "review"
  | "history"
  | "git"
  | "settings"
  | null;

interface NavItem {
  kind: NonNullable<ActivityKind>;
  icon: React.ReactNode;
  label: string;
}

/**
 * PROJECT(workshop) 모드의 좌측 narrow icon rail. /projects/:id/* 라우트에서만
 * 그려짐 — Layout 이 URL 보고 MainSidebar 와 swap.
 *
 *   ┌────┐
 *   │ ◆  │ logo
 *   │ ▌  │ ← 프로젝트 색 좌측 스트라이프
 *   │ [P]│ project chip + ▾ 드롭다운 (다른 프로젝트로 / lobby 복귀)
 *   │ 📂 │ Files
 *   │ 👥 │ Team (Agents)
 *   │ ─  │
 *   │ 🌿 │ Git
 *   │ ✓  │ Review
 *   │ 📜 │ History
 *   └────┘
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
  const projectId = projectMatch?.params?.id ?? null;

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.getProject(projectId!),
    enabled: !!projectId,
    retry: false,
  });
  const project = projectQuery.data?.project ?? null;

  const projectsList = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
    enabled: !!projectId,
  });

  const confirm = useConfirm();

  // 진행 중(queued/running) run 들 — 프로젝트 떠나기 전에 사용자가 알 수 있게.
  // 폴링 안 해도 됨 (떠나는 순간에만 정확하면 충분) — 단, 사용자가 한참 보고
  // 있던 화면이라 staletime 제로로 두면 chip 클릭 시점에 fresh 가져옴.
  const activeRuns = useQuery({
    queryKey: ["projectActiveRuns", projectId],
    queryFn: () => api.getProjectActiveRuns(projectId!),
    enabled: !!projectId,
    refetchInterval: 5_000,
    staleTime: 0,
    retry: false,
  });

  const exitToLobby = async () => {
    const count = activeRuns.data?.runs.length ?? 0;
    if (count > 0 && project) {
      const ok = await confirm({
        title: t("activity.exitConfirm.title"),
        description: t("activity.exitConfirm.description", {
          name: project.name,
          count,
        }),
        confirmLabel: t("activity.exitConfirm.confirm"),
        cancelLabel: t("common.cancel"),
      });
      if (!ok) return;
    }
    onSelect("projects");
    navigate("/projects");
  };
  const switchProject = (nextId: string) => {
    // 프로젝트 전환은 silent — runs 는 어차피 background 로 계속 돌고 사용자가
    // chip 으로 다시 돌아올 수 있음. 매 전환마다 confirm 은 noise.
    navigate(`/projects/${nextId}`);
    onSelect("files");
  };

  const routeFor = (kind: ActivityKind): string | null => {
    if (!projectId) return null;
    switch (kind) {
      case "files":
        return `/projects/${projectId}`;
      case "agents":
        return `/projects/${projectId}/agents`;
      case "review":
        return `/projects/${projectId}/review`;
      case "history":
        return `/projects/${projectId}/runs`;
      case "git":
        return `/projects/${projectId}/git`;
      default:
        return null;
    }
  };

  const handleClick = (kind: ActivityKind) => {
    const route = routeFor(kind);
    const onTargetRoute = route !== null && location.pathname === route;
    if (route !== null && !onTargetRoute) {
      navigate(route);
      onSelect(kind);
      return;
    }
    onSelect(active === kind ? null : kind);
  };

  const loadoutItems: ReadonlyArray<NavItem> = [
    {
      kind: "files",
      icon: <FilesIcon className="size-5" />,
      label: t("activity.files"),
    },
    {
      kind: "agents",
      icon: <Users className="size-5" />,
      label: t("activity.agents"),
    },
  ];

  const workItems: ReadonlyArray<NavItem> = [
    {
      kind: "git",
      icon: <GitBranch className="size-5" />,
      label: t("activity.git"),
    },
    {
      kind: "review",
      icon: <ClipboardCheck className="size-5" />,
      label: t("activity.review"),
    },
    {
      kind: "history",
      icon: <Activity className="size-5" />,
      label: t("activity.history"),
    },
  ];

  const projectAccent = project ? classesFor(agentColorFor(project.id)).dot : null;

  return (
    <aside className="relative flex w-12 shrink-0 flex-col items-stretch border-r border-border bg-card">
      {projectAccent ? (
        <span
          aria-hidden
          className={cn("absolute left-0 top-10 bottom-0 w-[3px]", projectAccent)}
        />
      ) : null}

      <NavLink
        to="/"
        end
        className={({ isActive }) =>
          cn(
            "flex items-center justify-center h-10 border-b border-border transition-colors",
            isActive ? "bg-foreground/[0.06]" : "hover:bg-muted/60",
          )
        }
        title="loom"
      >
        <LoomLogo className="size-5 dark:invert" />
      </NavLink>

      <nav className="flex-1 flex flex-col items-stretch px-1.5 py-2 gap-0.5 overflow-y-auto">
        {project ? (
          <ProjectSwitcherChip
            project={project}
            otherProjects={(projectsList.data?.projects ?? []).filter(
              (p) => p.id !== project.id,
            )}
            onSwitch={switchProject}
            onExit={exitToLobby}
            switchLabel={t("activity.switchProject")}
            backLabel={t("activity.backToMain")}
          />
        ) : null}

        {loadoutItems.map((it) => (
          <ActivityButton
            key={it.kind}
            active={active === it.kind}
            label={it.label}
            onClick={() => handleClick(it.kind)}
          >
            {it.icon}
          </ActivityButton>
        ))}

        <ZoneDivider />

        {workItems.map((it) => (
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
      </nav>
    </aside>
  );
}

function ZoneDivider() {
  return <div aria-hidden className="my-1.5 mx-1.5 h-px bg-border/50" />;
}

function ProjectSwitcherChip({
  project,
  otherProjects,
  onSwitch,
  onExit,
  switchLabel,
  backLabel,
}: {
  project: { id: string; name: string };
  otherProjects: ReadonlyArray<{ id: string; name: string }>;
  onSwitch: (id: string) => void;
  onExit: () => void;
  switchLabel: string;
  backLabel: string;
}) {
  const cls = classesFor(agentColorFor(project.id));
  const initial = initialFor(project.name);

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={project.name}
              className="relative flex items-center justify-center h-9 group rounded-md hover:bg-muted/40 transition-colors"
            >
              <span
                className={cn(
                  "inline-flex items-center justify-center size-7 rounded-md text-[11px] font-bold tracking-tight ring-1",
                  cls.bgSoft,
                  cls.text,
                  cls.ring,
                )}
              >
                {initial}
              </span>
              <ChevronDown className="absolute bottom-0.5 right-0.5 size-2.5 text-muted-foreground/80 bg-card rounded-full" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {project.name}
        </TooltipContent>
      </Tooltip>

      <DropdownMenuContent
        side="right"
        align="start"
        sideOffset={8}
        className="min-w-[14rem]"
      >
        <DropdownMenuLabel className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center justify-center size-5 rounded text-[10px] font-bold ring-1",
              cls.bgSoft,
              cls.text,
              cls.ring,
            )}
          >
            {initial}
          </span>
          <span className="truncate">{project.name}</span>
        </DropdownMenuLabel>

        {otherProjects.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {switchLabel}
            </DropdownMenuLabel>
            {otherProjects.map((p) => {
              const c = classesFor(agentColorFor(p.id));
              return (
                <DropdownMenuItem
                  key={p.id}
                  onSelect={() => onSwitch(p.id)}
                  className="gap-2"
                >
                  <span
                    className={cn(
                      "inline-flex items-center justify-center size-5 rounded text-[10px] font-bold ring-1",
                      c.bgSoft,
                      c.text,
                      c.ring,
                    )}
                  >
                    {initialFor(p.name)}
                  </span>
                  <span className="truncate">{p.name}</span>
                </DropdownMenuItem>
              );
            })}
          </>
        ) : null}

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onExit} className="gap-2">
          <Home className="size-4" />
          <span>{backLabel}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
              ? "bg-foreground/[0.10] text-foreground"
              : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
          )}
        >
          {active ? (
            <span
              aria-hidden
              className="absolute -left-1.5 top-1 bottom-1 w-[2px] rounded-r-full bg-foreground"
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
