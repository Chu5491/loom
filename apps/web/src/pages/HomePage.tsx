import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import NumberFlow from "@number-flow/react";
import { ArrowRight, Plus } from "lucide-react";
import type { Run } from "@loom/core";
import { api } from "../api/client.js";
import { AdapterIcon } from "../components/AdapterIcon.js";
import { LoomLogo } from "../components/LoomLogo.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { PageScroll } from "../components/PageScroll.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";
import { formatTimeAgo } from "../lib/timeAgo.js";
import { runStatusVariant } from "../lib/runStatus.js";

/**
 * Workspace landing page. Lives at `/`. Gives a quick read on the
 * day's activity and shortcuts into projects so the user doesn't have
 * to scroll the sidebar to remember what's where.
 */
export function HomePage() {
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
  });
  const agents = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.listAgents(),
  });
  const adapters = useQuery({
    queryKey: ["adapters"],
    queryFn: api.listAdapters,
  });
  const runs = useQuery({
    queryKey: ["runs", { home: true }],
    queryFn: () => api.listRuns({ limit: 30 }),
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return false;
      const hasActive = data.runs.some(
        (r) => r.status === "queued" || r.status === "running",
      );
      return hasActive ? 2500 : false;
    },
  });

  const projectList = projects.data?.projects ?? [];
  const agentList = agents.data?.agents ?? [];
  const manifests = adapters.data?.adapters ?? [];
  const runList = runs.data?.runs ?? [];

  const todayCount = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return runList.filter((r) => new Date(r.createdAt) >= today).length;
  }, [runList]);

  const workingCount = useMemo(
    () =>
      runList.filter((r) => r.status === "queued" || r.status === "running")
        .length,
    [runList],
  );

  const recentRuns = runList.slice(0, 6);

  return (
    <PageScroll className="space-y-8 max-w-5xl">
      <Hero />

      <Stats
        projects={projectList.length}
        agents={agentList.length}
        runsToday={todayCount}
        working={workingCount}
      />

      <RecentActivity
        runs={recentRuns}
        agents={agentList}
        manifests={manifests}
        projects={projectList}
      />

      <ProjectsGrid
        projects={projectList}
        agents={agentList}
      />
    </PageScroll>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function Hero() {
  const { t } = useI18n();
  const hour = new Date().getHours();
  const greeting =
    hour < 12
      ? t("home.greeting.morning")
      : hour < 18
        ? t("home.greeting.afternoon")
        : t("home.greeting.evening");
  return (
    <div>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <LoomLogo className="size-5 dark:invert" />
        loom
      </div>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        {greeting}.
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("home.subtitle")}</p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function Stats({
  projects,
  agents,
  runsToday,
  working,
}: {
  projects: number;
  agents: number;
  runsToday: number;
  working: number;
}) {
  const { t } = useI18n();
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label={t("home.stat.projects")} value={projects} />
      <StatCard label={t("home.stat.agents")} value={agents} />
      <StatCard label={t("home.stat.runsToday")} value={runsToday} />
      <StatCard
        label={t("home.stat.working")}
        value={working}
        accent={working > 0}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ duration: 0.12 }}
      className={cn(
        "relative rounded-md border bg-card px-4 py-3 overflow-hidden",
        accent &&
          "ring-1 ring-sky-300/60 dark:ring-sky-700/60 shadow-[0_0_24px_-12px_rgb(14_165_233/0.6)]",
      )}
    >
      {/* accent 카드 — 우상단 컬러 글로우. 다른 정적 카드들과 시각적 위계 분리. */}
      {accent ? (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute -top-6 -right-6 size-24 rounded-full bg-sky-400/30 blur-2xl"
          animate={{ opacity: [0.35, 0.65, 0.35] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
      ) : null}
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums inline-flex items-baseline",
          accent && "text-sky-600 dark:text-sky-400",
        )}
      >
        <NumberFlow value={value} />
        {accent ? (
          <motion.span
            aria-hidden
            className="ml-2 inline-block size-1.5 rounded-full bg-sky-500 align-middle"
            animate={{ opacity: [1, 0.4, 1], scale: [1, 1.3, 1] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
        ) : null}
      </div>
    </motion.div>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function RecentActivity({
  runs,
  agents,
  manifests,
  projects,
}: {
  runs: Run[];
  agents: { id: string; name: string; projectId: string; adapterKind: string }[];
  manifests: { kind: string }[];
  projects: { id: string; name: string }[];
}) {
  const { t } = useI18n();
  return (
    <section>
      <SectionHeader title={t("home.recent.title")}>
        <Button asChild variant="ghost" size="sm" className="text-xs h-7">
          <Link to="/projects">{t("home.recent.viewAll")}</Link>
        </Button>
      </SectionHeader>
      {runs.length === 0 ? (
        <div className="rounded-md border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          {t("home.recent.empty")}
        </div>
      ) : (
        <ul className="rounded-md border bg-card divide-y">
          {runs.map((r) => {
            const agent = agents.find((a) => a.id === r.agentId);
            const project = agent
              ? projects.find((p) => p.id === agent.projectId)
              : undefined;
            const manifest = agent
              ? manifests.find((m) => m.kind === agent.adapterKind)
              : undefined;
            return (
              <li key={r.id}>
                <Link
                  to={
                    project
                      ? `/projects/${project.id}/runs/${r.id}`
                      : `#`
                  }
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors"
                >
                  {manifest ? (
                    <AdapterIcon manifest={manifest as never} size={20} />
                  ) : (
                    <span className="size-5 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">
                        {agent?.name ?? "—"}
                      </span>
                      {project ? (
                        <span className="text-[11px] text-muted-foreground truncate">
                          {project.name}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {r.prompt.slice(0, 100)}
                    </p>
                  </div>
                  <Badge variant={runStatusVariant(r.status)} className="h-5 px-1.5 text-[10px]">
                    {r.status}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground/70 mono shrink-0 hidden sm:inline">
                    {formatTimeAgo(r.createdAt, t, "long")}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function ProjectsGrid({
  projects,
  agents,
}: {
  projects: { id: string; name: string; path: string }[];
  agents: { projectId: string }[];
}) {
  const { t } = useI18n();
  if (projects.length === 0) {
    return (
      <section>
        <SectionHeader title={t("home.projects.title")} />
        <div className="rounded-md border border-dashed bg-card/50 px-6 py-10 text-center">
          <LoomLogo className="size-16 mx-auto opacity-60 dark:invert" />
          <p className="mt-3 text-sm font-medium">
            {t("home.projects.empty.title")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("home.projects.empty.desc")}
          </p>
          <Button asChild className="mt-4" size="sm">
            <Link to="/projects">
              <Plus />
              {t("home.projects.new")}
            </Link>
          </Button>
        </div>
      </section>
    );
  }
  return (
    <section>
      <SectionHeader title={t("home.projects.title")}>
        <Button asChild variant="ghost" size="sm" className="text-xs h-7">
          <Link to="/projects">{t("home.projects.viewAll")}</Link>
        </Button>
      </SectionHeader>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.slice(0, 6).map((p) => {
          const count = agents.filter((a) => a.projectId === p.id).length;
          return (
            <Link
              key={p.id}
              to={`/projects/${p.id}`}
              className="group rounded-md border bg-card hover:border-foreground/40 transition-colors p-4"
            >
              <div className="flex items-start gap-3">
                <span className="flex size-9 items-center justify-center rounded-md bg-foreground text-background text-sm font-bold shrink-0">
                  {p.name.trim()[0]?.toUpperCase() ?? "?"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{p.name}</div>
                  <p className="text-[11px] text-muted-foreground mono truncate" title={p.path}>
                    {p.path}
                  </p>
                </div>
                <ArrowRight className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </div>
              <div className="mt-3 text-[11px] text-muted-foreground">
                {t("home.projects.agents", { count })}
              </div>
            </Link>
          );
        })}
        <Link
          to="/projects"
          className="rounded-md border border-dashed bg-card/30 hover:bg-card hover:border-foreground/40 transition-colors p-4 flex flex-col items-center justify-center text-center min-h-[110px]"
        >
          <Plus className="size-5 text-muted-foreground" />
          <span className="mt-1.5 text-xs font-medium text-muted-foreground">
            {t("home.projects.new")}
          </span>
        </Link>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function SectionHeader({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </div>
  );
}
