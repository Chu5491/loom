// VSCode 터미널 스타일 채팅 패널 — 화면 하단 *또는* 우측에 도킹.
// - placement="bottom" : 아래쪽 도킹 (기본). 가로폭 가득, 세로 리사이즈.
// - placement="right"  : 오른쪽 사이드 도킹. 세로폭 가득, 가로 리사이즈.
//
// 좁은 / 세로가 짧은 화면에선 right가 훨씬 살림 — 에디터를 압박하지 않고
// 채팅이 한 컬럼으로 흐름.
//
// 영속:
//   loom:chatDock:placement   "bottom" | "right"
//   loom:chatDock:height      bottom 모드 세로 길이
//   loom:chatDock:width       right 모드 가로 길이
//   loom:chatDock:open        토글 상태 (placement 무관 공유)
//   loom:chatDock:maximized   같음

import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Minimize2,
  Maximize2,
  PanelBottom,
  PanelRight,
  X,
} from "lucide-react";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

const HEIGHT_KEY = "loom:chatDock:height";
const WIDTH_KEY = "loom:chatDock:width";
const PLACEMENT_KEY = "loom:chatDock:placement";
const OPEN_KEY = "loom:chatDock:open";
const MAX_KEY = "loom:chatDock:maximized";

const HEADER_H = 32;
const MIN_HEIGHT = 160;
const DEFAULT_HEIGHT = 280;
// right 모드 폭 — 360은 message + composer가 답답하지 않은 최소.
const MIN_WIDTH = 280;
const DEFAULT_WIDTH = 360;

export type DockPlacement = "bottom" | "right";

export function readDockPlacement(): DockPlacement {
  if (typeof window === "undefined") return "bottom";
  const raw = window.localStorage.getItem(PLACEMENT_KEY);
  return raw === "right" ? "right" : "bottom";
}
function readSize(key: string, def: number, min: number): number {
  if (typeof window === "undefined") return def;
  const raw = window.localStorage.getItem(key);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.max(min, n);
}
function readBool(key: string, def: boolean): boolean {
  if (typeof window === "undefined") return def;
  const raw = window.localStorage.getItem(key);
  if (raw === "1") return true;
  if (raw === "0") return false;
  return def;
}
function storeBool(key: string, v: boolean): void {
  try {
    window.localStorage.setItem(key, v ? "1" : "0");
  } catch {
    // 무시
  }
}

export function ChatDock({
  title,
  headerExtra,
  placement,
  onPlacementChange,
  children,
}: {
  title?: string;
  headerExtra?: ReactNode;
  /** 외부에서 controlled — WorkspacePage가 layout을 바꿔야 해서 같이 알아야 함. */
  placement: DockPlacement;
  onPlacementChange: (next: DockPlacement) => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<boolean>(() => readBool(OPEN_KEY, true));
  const [maximized, setMaximized] = useState<boolean>(() =>
    readBool(MAX_KEY, false),
  );
  const [height, setHeight] = useState<number>(() =>
    readSize(HEIGHT_KEY, DEFAULT_HEIGHT, MIN_HEIGHT),
  );
  const [width, setWidth] = useState<number>(() =>
    readSize(WIDTH_KEY, DEFAULT_WIDTH, MIN_WIDTH),
  );

  // ⌘J / Ctrl+J 단축키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        e.key.toLowerCase() === "j"
      ) {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable)
        ) {
          return;
        }
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("loom:openChatDock", onOpen);
    return () => window.removeEventListener("loom:openChatDock", onOpen);
  }, []);

  useEffect(() => {
    storeBool(OPEN_KEY, open);
  }, [open]);
  useEffect(() => {
    storeBool(MAX_KEY, maximized);
  }, [maximized]);
  useEffect(() => {
    try {
      window.localStorage.setItem(HEIGHT_KEY, String(height));
    } catch {
      /* ignore */
    }
  }, [height]);
  useEffect(() => {
    try {
      window.localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      /* ignore */
    }
  }, [width]);

  const togglePlacement = () => {
    const next = placement === "bottom" ? "right" : "bottom";
    try {
      window.localStorage.setItem(PLACEMENT_KEY, next);
    } catch {
      /* ignore */
    }
    onPlacementChange(next);
  };

  // 드래그 — placement에 따라 세로/가로 리사이즈.
  const startResize = useCallback(
    (e: React.MouseEvent) => {
      if (!open || maximized) return;
      e.preventDefault();
      if (placement === "bottom") {
        const startY = e.clientY;
        const startH = height;
        const onMove = (ev: MouseEvent) => {
          const dy = startY - ev.clientY; // 위로 끌면 +
          const next = Math.max(
            MIN_HEIGHT,
            Math.min(window.innerHeight * 0.8, startH + dy),
          );
          setHeight(next);
        };
        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        document.body.style.cursor = "row-resize";
        document.body.style.userSelect = "none";
      } else {
        const startX = e.clientX;
        const startW = width;
        const onMove = (ev: MouseEvent) => {
          const dx = startX - ev.clientX; // 왼쪽으로 끌면 +
          const next = Math.max(
            MIN_WIDTH,
            Math.min(window.innerWidth * 0.6, startW + dx),
          );
          setWidth(next);
        };
        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }
    },
    [open, maximized, height, width, placement],
  );

  // dock의 실제 크기 — placement 별로 다른 축에 적용.
  const sizeStyle: React.CSSProperties =
    placement === "bottom"
      ? {
          height: !open
            ? HEADER_H
            : maximized
              ? Math.max(MIN_HEIGHT, window.innerHeight * 0.8)
              : height,
        }
      : {
          width: !open
            ? HEADER_H
            : maximized
              ? Math.max(MIN_WIDTH, window.innerWidth * 0.6)
              : width,
        };

  const isBottom = placement === "bottom";

  return (
    <aside
      className={cn(
        "shrink-0 flex flex-col bg-card relative",
        isBottom ? "border-t border-border" : "border-l border-border",
        !open && "hover:bg-muted/40 transition-colors",
      )}
      style={sizeStyle}
    >
      {/* 드래그 핸들 — placement 별로 위치/축이 다름. */}
      {open && !maximized ? (
        isBottom ? (
          <div
            role="separator"
            aria-orientation="horizontal"
            onMouseDown={startResize}
            className="absolute -top-0.5 left-0 right-0 z-10 h-1 cursor-row-resize group"
          >
            <span
              aria-hidden
              className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px bg-transparent group-hover:bg-foreground/30 transition-colors"
            />
          </div>
        ) : (
          <div
            role="separator"
            aria-orientation="vertical"
            onMouseDown={startResize}
            className="absolute -left-0.5 top-0 bottom-0 z-10 w-1 cursor-col-resize group"
          >
            <span
              aria-hidden
              className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-px bg-transparent group-hover:bg-foreground/30 transition-colors"
            />
          </div>
        )
      ) : null}

      {/* 헤더 — 32px 고정. 패딩 살짝 조여서 좁은 폭에서도 버튼이 안 잘림. */}
      <header
        className="flex items-center gap-1.5 px-2 h-8 border-b border-border/70 bg-muted/30 shrink-0 select-none"
        style={{ height: HEADER_H }}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors shrink-0"
          aria-expanded={open}
          title={open ? t("chat.dock.collapse") : t("chat.dock.expand")}
        >
          <MessageSquare className="size-3.5" />
          <span className="hidden sm:inline">{t("chat.dock.label")}</span>
        </button>
        {title ? (
          <span
            className="text-xs text-foreground/80 truncate min-w-0"
            title={title}
          >
            {title}
          </span>
        ) : null}
        {headerExtra && open ? (
          <div className="flex items-center gap-1 min-w-0 shrink-0">
            {headerExtra}
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-0.5 shrink-0">
          {open ? (
            <>
              {/* placement 토글 — 현재 위치의 *반대*쪽 아이콘. 클릭 시 그쪽으로 이동. */}
              <button
                type="button"
                onClick={togglePlacement}
                title={
                  isBottom
                    ? t("chat.dock.dockRight")
                    : t("chat.dock.dockBottom")
                }
                aria-label={
                  isBottom
                    ? t("chat.dock.dockRight")
                    : t("chat.dock.dockBottom")
                }
                className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                {isBottom ? (
                  <PanelRight className="size-3.5" />
                ) : (
                  <PanelBottom className="size-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setMaximized((v) => !v)}
                title={
                  maximized ? t("chat.dock.restore") : t("chat.dock.maximize")
                }
                aria-label={
                  maximized ? t("chat.dock.restore") : t("chat.dock.maximize")
                }
                className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                {maximized ? (
                  <Minimize2 className="size-3.5" />
                ) : (
                  <Maximize2 className="size-3.5" />
                )}
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            title={open ? t("chat.dock.collapse") : t("chat.dock.expand")}
            aria-label={open ? t("chat.dock.collapse") : t("chat.dock.expand")}
            className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            {open ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronUp className="size-3.5" />
            )}
          </button>
          {open ? (
            <button
              type="button"
              onClick={() => setOpen(false)}
              title={t("chat.dock.close")}
              aria-label={t("chat.dock.close")}
              className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      </header>

      {open ? (
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      ) : null}
    </aside>
  );
}
