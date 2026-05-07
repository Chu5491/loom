// MAIN(lobby) 모드 전용 사이드바.
//
// PROJECT 모드의 narrow icon rail(=ActivityBar) 과는 *완전히 다른 모양*:
//   - 폭 200px
//   - 텍스트 라벨이 보이는 vertical nav
//   - 보조 패널(ActivityPanel) 을 동반하지 않음 — 각 페이지가 풀 너비로
//     자기 콘텐츠를 다 보여주는 lobby 흐름이라 sidebar→panel→page 의 3단
//     계단이 불필요.
//
// 모드 간 폭/감각 차이가 크게 벌어져 main → project 진입이 시각적으로
// 즉시 확인됨 (페이퍼클립 류 흐름).

import { NavLink } from "react-router-dom";
import {
  BarChart3,
  FileText,
  Folder,
  Plug,
  Settings as SettingsIcon,
} from "lucide-react";
import { LoomLogo } from "./LoomLogo.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

export const MAIN_SIDEBAR_WIDTH = 200;

interface NavItem {
  to: string;
  icon: React.ReactNode;
  label: string;
  /** 정확히 일치할 때만 active — Projects 가 /projects/:id 에서 켜지지 않게. */
  end: boolean;
}

export function MainSidebar({
  onSettingsClick,
  settingsActive,
}: {
  onSettingsClick: () => void;
  settingsActive: boolean;
}) {
  const { t } = useI18n();

  const items: ReadonlyArray<NavItem> = [
    {
      to: "/projects",
      icon: <Folder className="size-4" />,
      label: t("activity.projects"),
      end: true,
    },
    {
      to: "/skills",
      icon: <FileText className="size-4" />,
      label: t("activity.skills"),
      end: false,
    },
    {
      to: "/mcps",
      icon: <Plug className="size-4" />,
      label: t("activity.mcps"),
      end: false,
    },
    {
      to: "/insights",
      icon: <BarChart3 className="size-4" />,
      label: t("activity.insights"),
      end: false,
    },
  ];

  return (
    <aside
      className="shrink-0 flex flex-col border-r border-border bg-card"
      style={{ width: MAIN_SIDEBAR_WIDTH }}
    >
      {/* 헤더 — 로고 + wordmark. project rail 의 logo-only(48px h-10) 와 톤이 달라서
          "여기는 lobby 다" 가 한눈에. */}
      <NavLink
        to="/"
        end
        className={({ isActive }) =>
          cn(
            "flex items-center gap-2 h-10 px-3 border-b border-border transition-colors",
            isActive ? "bg-foreground/[0.06]" : "hover:bg-muted/60",
          )
        }
        title="loom"
      >
        <LoomLogo className="size-5 dark:invert" />
        <span className="text-sm font-semibold tracking-tight">loom</span>
      </NavLink>

      <nav className="flex-1 flex flex-col p-2 gap-0.5 overflow-y-auto">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) =>
              cn(
                "relative flex items-center gap-2.5 h-9 px-3 rounded-md text-sm transition-colors",
                isActive
                  ? "bg-foreground/[0.08] text-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive ? (
                  <span
                    aria-hidden
                    className="absolute -left-2 top-1.5 bottom-1.5 w-[2px] rounded-r-full bg-foreground"
                  />
                ) : null}
                {it.icon}
                <span className="truncate">{it.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Settings — popover 가 아니라 기존 ActivityPanel 을 그대로 재사용.
          이 버튼 = 패널 토글. */}
      <div className="p-2 border-t border-border/60">
        <button
          type="button"
          onClick={onSettingsClick}
          aria-pressed={settingsActive}
          className={cn(
            "w-full flex items-center gap-2.5 h-9 px-3 rounded-md text-sm transition-colors",
            settingsActive
              ? "bg-foreground/[0.08] text-foreground font-medium"
              : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
          )}
        >
          <SettingsIcon className="size-4" />
          <span className="truncate">{t("activity.settings")}</span>
        </button>
      </div>
    </aside>
  );
}
