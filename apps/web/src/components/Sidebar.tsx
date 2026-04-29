import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { Hash, Plus, Sparkles, Users, FileText, Activity } from "lucide-react";
import { api } from "../api/client.js";
import { useI18n } from "../context/I18nContext.js";
import { useTheme, type ThemeMode } from "../context/ThemeContext.js";
import { LANG_NAMES, SUPPORTED_LANGS, type Lang } from "../i18n/dictionaries.js";
import { Button } from "./ui/button.js";
import { Separator } from "./ui/separator.js";
import { cn } from "../lib/utils.js";

/**
 * Slack/Discord-style left rail. Always visible. Holds the workspace
 * brand, the project list (each project is a "channel"), management
 * links (Agents · Skills · Runs), and the user-level toggles at the
 * bottom (theme · language · server status).
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

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r bg-muted/30">
      <Brand />
      <Separator />

      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-5">
        <Section title={t("sidebar.projects")} action={<NewProjectButton />}>
          {list.length === 0 ? (
            <p className="px-2 text-xs text-muted-foreground/70">
              {t("sidebar.projects.empty")}
            </p>
          ) : (
            list.map((p) => (
              <SidebarLink
                key={p.id}
                to={`/projects/${p.id}`}
                icon={<Hash className="size-3.5" />}
              >
                {p.name}
              </SidebarLink>
            ))
          )}
        </Section>

        <Section title={t("sidebar.manage")}>
          <SidebarLink to="/agents" icon={<Users className="size-3.5" />}>
            {t("nav.agents")}
          </SidebarLink>
          <SidebarLink to="/specs" icon={<FileText className="size-3.5" />}>
            {t("nav.specs")}
          </SidebarLink>
          <SidebarLink to="/runs" icon={<Activity className="size-3.5" />}>
            {t("nav.runs")}
          </SidebarLink>
        </Section>
      </nav>

      <Separator />
      <FooterControls
        online={health.isSuccess}
        offline={health.isError}
      />
    </aside>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2 px-4 py-3 h-14">
      <span className="flex size-7 items-center justify-center rounded-md bg-foreground text-background">
        <Sparkles className="size-3.5" />
      </span>
      <div className="min-w-0">
        <div className="text-sm font-semibold leading-tight">loom</div>
        <div className="text-[10px] text-muted-foreground mono leading-tight">
          v0.1.0
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between px-2 mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        {action}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function SidebarLink({
  to,
  icon,
  children,
}: {
  to: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
          isActive
            ? "bg-foreground text-background font-medium"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )
      }
    >
      <span className="opacity-70">{icon}</span>
      <span className="truncate">{children}</span>
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
}: {
  online: boolean;
  offline: boolean;
}) {
  const { t } = useI18n();
  const { mode, setMode } = useTheme();
  const { lang, setLang } = useI18n();

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
