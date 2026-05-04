// VSCode 터미널 스타일 — 워크스페이스 하단에 도킹된 채팅 패널.
// - 항상 화면 하단 고정. 에디터/메인 영역과 같은 column flex 안에서 형제로.
// - 드래그 핸들로 세로 리사이즈 (180px ~ 80vh)
// - 상단 탭바: "CHAT" + 활성 thread 이름 + collapse / maximize / close 버튼
// - collapse 상태일 때는 32px 헤더만 남김. 다시 펼치면 마지막 height로 복귀.
// - 모든 상태 (open / height / maximized) localStorage 영속.

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
  X,
} from "lucide-react";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

const HEIGHT_KEY = "loom:chatDock:height";
const OPEN_KEY = "loom:chatDock:open";
const MAX_KEY = "loom:chatDock:maximized";

const HEADER_H = 32;
// 280은 composer + 최근 메시지 1~2개가 보이는 최소한의 높이. 이전 360은
// 너무 커서 에디터 영역을 잡아먹는다는 피드백이 있었음.
const MIN_HEIGHT = 160;
const DEFAULT_HEIGHT = 280;

function readHeight(): number {
  if (typeof window === "undefined") return DEFAULT_HEIGHT;
  const raw = window.localStorage.getItem(HEIGHT_KEY);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_HEIGHT;
  return Math.max(MIN_HEIGHT, n);
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
  children,
}: {
  title?: string;
  /** 제목 우측, 토글 버튼들 앞에 들어가는 슬롯 — 참여자 아바타 / 작업 중 뱃지 / 비용 등 */
  headerExtra?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<boolean>(() => readBool(OPEN_KEY, true));
  const [maximized, setMaximized] = useState<boolean>(() =>
    readBool(MAX_KEY, false),
  );
  const [height, setHeight] = useState<number>(() => readHeight());
  // ⌘J / Ctrl+J 단축키로 dock 토글 — VSCode 터미널 단축키와 동일 컨벤션.
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
    storeBool(OPEN_KEY, open);
  }, [open]);
  useEffect(() => {
    storeBool(MAX_KEY, maximized);
  }, [maximized]);
  useEffect(() => {
    try {
      window.localStorage.setItem(HEIGHT_KEY, String(height));
    } catch {
      // 무시
    }
  }, [height]);

  // 드래그 핸들 — 헤더 위에 5px 두께 hot zone. mousedown으로 글로벌 listener
  // 등록 → 드래그 중엔 cursor lock + selection 차단.
  const startResize = useCallback(
    (e: React.MouseEvent) => {
      if (!open || maximized) return;
      e.preventDefault();
      const startY = e.clientY;
      const startH = height;
      const onMove = (ev: MouseEvent) => {
        const dy = startY - ev.clientY; // 위로 끌면 + (커짐)
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
    },
    [open, maximized, height],
  );

  // dock의 실제 높이 — closed면 헤더만, maximized면 가용 영역의 80vh, 아니면 사용자 height.
  const dockH = !open
    ? HEADER_H
    : maximized
      ? Math.max(MIN_HEIGHT, window.innerHeight * 0.8)
      : height;

  return (
    <aside
      className={cn(
        "shrink-0 flex flex-col border-t border-border bg-card relative",
        // 닫혀있을 땐 hover 시 살짝 강조해서 클릭 가능하다는 신호.
        !open && "hover:bg-muted/40 transition-colors",
      )}
      style={{ height: dockH }}
    >
      {/* 드래그 핸들 — 헤더 위에 얇은 hot zone (열려있고 maximize 아닐 때만). */}
      {open && !maximized ? (
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
      ) : null}

      {/* 헤더 — VSCode terminal 탭 모방. 클릭 가능 영역이 넓도록 전체 헤더가 토글. */}
      <header
        className="flex items-center gap-2 px-3 h-8 border-b border-border/70 bg-muted/30 shrink-0 select-none"
        style={{ height: HEADER_H }}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
          aria-expanded={open}
          title={open ? t("chat.dock.collapse") : t("chat.dock.expand")}
        >
          <MessageSquare className="size-3.5" />
          <span>{t("chat.dock.label")}</span>
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
        <div className="ml-auto flex items-center gap-0.5">
          {open ? (
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

      {/* 본문 — open 일 때만 렌더. 닫혀 있을 땐 헤더만 보임 (VSCode 탭 스타일). */}
      {open ? (
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      ) : null}
    </aside>
  );
}
