import { NavLink, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client.js";
import { useI18n } from "../context/I18nContext.js";
import { useTheme, type ThemeMode } from "../context/ThemeContext.js";
import { LANG_NAMES, SUPPORTED_LANGS, type Lang } from "../i18n/dictionaries.js";

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        [
          "px-3 py-1.5 rounded-md text-sm transition-colors",
          isActive
            ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
            : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-900",
        ].join(" ")
      }
    >
      {children}
    </NavLink>
  );
}

function ThemeToggle() {
  const { mode, setMode } = useTheme();
  const { t } = useI18n();

  const labels: Record<ThemeMode, string> = {
    system: t("nav.theme.system"),
    light: t("nav.theme.light"),
    dark: t("nav.theme.dark"),
  };

  return (
    <div
      className="flex rounded-md border border-zinc-300 dark:border-zinc-800 overflow-hidden"
      aria-label={t("nav.theme.title")}
    >
      {(["system", "light", "dark"] as ThemeMode[]).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => setMode(m)}
          className={
            "px-2 py-1 text-xs transition-colors " +
            (mode === m
              ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
              : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-500 dark:hover:text-zinc-100")
          }
        >
          {labels[m]}
        </button>
      ))}
    </div>
  );
}

function LangToggle() {
  const { lang, setLang, t } = useI18n();
  return (
    <select
      aria-label={t("nav.lang.title")}
      value={lang}
      onChange={(e) => setLang(e.target.value as Lang)}
      className="h-7 rounded-md border border-zinc-300 bg-white px-2 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
    >
      {SUPPORTED_LANGS.map((l) => (
        <option key={l} value={l}>
          {LANG_NAMES[l]}
        </option>
      ))}
    </select>
  );
}

export function Layout() {
  const { t } = useI18n();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 10_000,
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b sticky top-0 z-10 backdrop-blur border-zinc-200 bg-white/95 dark:border-zinc-800 dark:bg-zinc-950/95">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="font-semibold tracking-tight">loom</span>
            <span className="text-xs text-zinc-500 mono">v0.1.0</span>
          </div>
          <nav className="flex items-center gap-1 ml-4">
            <NavItem to="/projects">{t("nav.projects")}</NavItem>
          </nav>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <LangToggle />
            <ThemeToggle />
            <div className="flex items-center gap-1.5 ml-1">
              <span
                className={[
                  "size-2 rounded-full",
                  health.isSuccess
                    ? "bg-emerald-500"
                    : health.isError
                      ? "bg-red-500"
                      : "bg-zinc-400 dark:bg-zinc-500",
                ].join(" ")}
              />
              <span className="text-zinc-500 mono">
                {health.isSuccess
                  ? t("common.online")
                  : health.isError
                    ? t("common.offline")
                    : "..."}
              </span>
            </div>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
