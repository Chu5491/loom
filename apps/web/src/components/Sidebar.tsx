import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { LoomLogo } from "./LoomLogo.js";
import { api } from "../api/client.js";
import { useI18n } from "../context/I18nContext.js";
import { useTheme, type ThemeMode } from "../context/ThemeContext.js";
import { LANG_NAMES, SUPPORTED_LANGS, type Lang } from "../i18n/dictionaries.js";
import { Button } from "./ui/button.js";
import { Separator } from "./ui/separator.js";
import { cn } from "../lib/utils.js";

const COLLAPSED_KEY = "loom:sidebar:collapsed";

/**
 * Slack/Discord-style left rail. Holds the workspace brand, the project
 * list (each project is a "channel"), and the user-level toggles at
 * the bottom (theme · language · server status).
 *
 * Collapsible — when collapsed, only the brand mark + project initials
 * remain visible, freeing horizontal space for the workspace center
 * pane on small screens. State persists across reloads via
 * localStorage so the layout you set yesterday is what greets you
 * today.
 */
export function Sidebar() {
  const { t } = useI18n();
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
  });
  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 10_000,
  });
  const list = projects.data?.projects ?? [];

  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // private mode / quota — silently skip
    }
  }, [collapsed]);

  return (
    <aside
      className={cn(
        "relative flex h-full shrink-0 flex-col border-r bg-muted/30 transition-[width] duration-200",
        collapsed ? "w-14" : "w-60",
      )}
    >
      <Brand collapsed={collapsed} />
      <Separator />

      <nav className="flex-1 overflow-y-auto py-3 px-2">
        <Section
          title={collapsed ? null : t("sidebar.projects")}
          action={collapsed ? null : <NewProjectButton />}
        >
          {list.length === 0 ? (
            collapsed ? null : (
              <p className="px-2 text-xs text-muted-foreground/70">
                {t("sidebar.projects.empty")}
              </p>
            )
          ) : (
            list.map((p) => (
              <SidebarLink
                key={p.id}
                to={`/projects/${p.id}`}
                collapsed={collapsed}
                title={p.name}
              >
                {collapsed ? initialOf(p.name) : p.name}
              </SidebarLink>
            ))
          )}
        </Section>
      </nav>

      <Separator />
      <FooterControls
        online={health.isSuccess}
        offline={health.isError}
        collapsed={collapsed}
      />

      {/* Collapse toggle — sits on the rail's right edge so it's
       *  reachable in both states without taking layout space. */}
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        title={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
        aria-label={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
        className="absolute -right-3 top-16 z-10 inline-flex size-6 items-center justify-center rounded-full border bg-background text-muted-foreground hover:text-foreground hover:bg-muted shadow-sm transition-colors"
      >
        {collapsed ? (
          <ChevronRight className="size-3" />
        ) : (
          <ChevronLeft className="size-3" />
        )}
      </button>
    </aside>
  );
}

function initialOf(name: string): string {
  const trimmed = name.trim();
  return trimmed[0]?.toUpperCase() ?? "?";
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <NavLink
      to="/"
      end
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2 px-4 py-3 h-14 transition-colors",
          collapsed && "justify-center px-0",
          isActive ? "bg-muted/40" : "hover:bg-muted/30",
        )
      }
      title="loom"
    >
      <LoomLogo className="size-9 shrink-0 dark:invert" />
      {collapsed ? null : (
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight">loom</div>
          <div className="text-[10px] text-muted-foreground mono leading-tight">
            v0.1.0
          </div>
        </div>
      )}
    </NavLink>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string | null;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      {title ? (
        <div className="flex items-center justify-between px-2 mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </span>
          {action}
        </div>
      ) : null}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function SidebarLink({
  to,
  icon,
  collapsed,
  title,
  children,
}: {
  to: string;
  icon?: React.ReactNode;
  collapsed?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      title={title}
      className={({ isActive }) =>
        cn(
          "flex items-center rounded-md text-sm transition-colors",
          collapsed
            ? "justify-center size-9 mx-auto font-semibold"
            : "gap-2 px-2 py-1.5",
          isActive
            ? "bg-foreground text-background font-medium"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )
      }
    >
      {icon && !collapsed ? <span className="opacity-70">{icon}</span> : null}
      <span className={cn(!collapsed && "truncate")}>{children}</span>
    </NavLink>
  );
}

function NewProjectButton() {
  const { t } = useI18n();
  return (
    <Button
      asChild
      variant="ghost"
      size="icon"
      className="size-5 text-muted-foreground hover:text-foreground"
    >
      <NavLink to="/projects" aria-label={t("sidebar.projects.new")}>
        <Plus />
      </NavLink>
    </Button>
  );
}

function FooterControls({
  online,
  offline,
  collapsed,
}: {
  online: boolean;
  offline: boolean;
  collapsed: boolean;
}) {
  const { t } = useI18n();
  const { mode, setMode } = useTheme();
  const { lang, setLang } = useI18n();

  // In collapsed mode the language and theme selects don't fit, so we
  // hide them — the user can expand the rail for a moment to switch.
  // Health dot stays so connection status is always at-a-glance.
  if (collapsed) {
    return (
      <div className="flex items-center justify-center px-3 py-2">
        <span
          className={cn(
            "size-2 rounded-full",
            online
              ? "bg-emerald-500"
              : offline
                ? "bg-red-500"
                : "bg-zinc-400",
          )}
          title={
            online
              ? t("common.online")
              : offline
                ? t("common.offline")
                : t("common.loading")
          }
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 border-t-0 px-3 py-2 text-xs">
      <span
        className={cn(
          "size-1.5 rounded-full",
          online
            ? "bg-emerald-500"
            : offline
              ? "bg-red-500"
              : "bg-zinc-400",
        )}
        title={
          online
            ? t("common.online")
            : offline
              ? t("common.offline")
              : t("common.loading")
        }
      />
      <select
        aria-label={t("nav.lang.title")}
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
        className="h-6 cursor-pointer rounded-md border bg-transparent px-1.5 text-[11px] hover:bg-muted focus:outline-none"
      >
        {SUPPORTED_LANGS.map((l) => (
          <option key={l} value={l}>
            {LANG_NAMES[l]}
          </option>
        ))}
      </select>
      <select
        aria-label={t("nav.theme.title")}
        value={mode}
        onChange={(e) => setMode(e.target.value as ThemeMode)}
        className="h-6 cursor-pointer rounded-md border bg-transparent px-1.5 text-[11px] hover:bg-muted focus:outline-none"
      >
        <option value="system">{t("nav.theme.system")}</option>
        <option value="light">{t("nav.theme.light")}</option>
        <option value="dark">{t("nav.theme.dark")}</option>
      </select>
    </div>
  );
}
